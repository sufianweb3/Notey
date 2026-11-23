import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth } from './auth/auth';
import { migrate } from './db/migrate';
import { assertEnv } from './env';
import type { Adapters, AppEnv, Deps } from './hono-env';
import { apiRoutes } from './routes/api/index';
import { errorJson, onError } from './routes/api/errors';

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
  app.use('/api/*', async (_c, next) => {
    await ensureMigrated();
    await next();
  });
  // JSON bodies already require a CORS preflight cross-origin; csrf() also
  // rejects cross-origin form posts. Better Auth checks Origin on its own routes.
  app.use('/api/*', csrf());

  app.route('/api', apiRoutes(deps));
  app.all('/api/*', (c) => errorJson(c, 'not_found', 'No such endpoint', 404));

  return app;
}

export type NoteyApp = ReturnType<typeof createApp>;
