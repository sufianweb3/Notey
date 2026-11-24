import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth } from './auth/auth';
import { migrate } from './db/migrate';
import { assertEnv } from './env';
import type { Adapters, AppEnv, Deps } from './hono-env';
import { apiRoutes } from './routes/api/index';
import { errorJson, onError } from './routes/api/errors';
import { mcpRoutes } from './routes/mcp';
import { oauthRoutes, wellKnownRoutes } from './routes/oauth';
import { v1Routes } from './routes/v1/index';

/**
 * Builds the whole server. Every entry (Workers, Vercel, Node) calls this with
 * its own adapters, so features never branch on the host.
 */
export function createApp({ db, storage, env }: Adapters) {
  assertEnv(env);
  const deps: Deps = { adapter: db, db: db.db, storage, env, auth: createAuth(db.db, env) };

  // Migrations run once per isolate/process, on the first request (PRD §8).
  let ready: Promise<unknown> | null = null;
  const ensureMigrated = () => {
    ready ??= migrate(db).catch((err) => {
      ready = null;
      throw err;
    });
    return ready;
  };

  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.use('*', secureHeaders({ crossOriginEmbedderPolicy: false }));
  const migrated = async (_c: unknown, next: () => Promise<void>) => {
    await ensureMigrated();
    await next();
  };
  for (const path of ['/api/*', '/mcp', '/mcp/*', '/oauth/*', '/.well-known/*']) app.use(path, migrated);

  // Agent-facing endpoints take bearer tokens, never cookies, so any origin may call them
  // (browser-based MCP clients and inspectors).
  const open = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
    exposeHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Retry-After'],
    maxAge: 600,
  });
  for (const path of ['/api/v1/*', '/mcp', '/mcp/*', '/oauth/register', '/oauth/token', '/.well-known/*']) app.use(path, open);
  // JSON bodies already require a CORS preflight cross-origin; csrf() also
  // rejects cross-origin form posts. Better Auth checks Origin on its own routes.
  app.use('/api/*', csrf());

  app.route('/api/v1', v1Routes(deps));
  app.route('/api', apiRoutes(deps));
  app.route('/mcp', mcpRoutes(deps));
  app.route('/oauth', oauthRoutes(deps));
  app.route('/.well-known', wellKnownRoutes(deps));
  app.all('/api/*', (c) => errorJson(c, 'not_found', 'No such endpoint', 404));

  return app;
}

export type NoteyApp = ReturnType<typeof createApp>;
