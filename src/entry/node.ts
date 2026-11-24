import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createClient } from '@libsql/client';
import { Hono } from 'hono';
import { libsqlAdapter } from '../adapters/db/libsql';
import { diskAdapter } from '../adapters/storage/disk';

import { createApp } from '../server/app';
import { withClientIp } from '../server/client-ip';

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const WEB_DIR = resolve(process.env.WEB_DIR ?? './dist/web');
const PORT = Number(process.env.PORT ?? 3000);

/**
 * NOTEY_SECRET from the environment, else from $DATA_DIR/.env, else generated
 * on first run and written there. It lives next to the database so a Docker
 * volume keeps both together (sessions and encrypted keys survive restarts).
 */
function loadSecret(): string {
  if (process.env.NOTEY_SECRET) return process.env.NOTEY_SECRET;
  const file = join(DATA_DIR, '.env');
  if (existsSync(file)) {
    const match = /^NOTEY_SECRET=(.+)$/m.exec(readFileSync(file, 'utf8'));
    if (match?.[1]) return match[1].trim();
  }
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  writeFileSync(file, `NOTEY_SECRET=${secret}\n`, { mode: 0o600, flag: 'a' });
  console.log(`Generated NOTEY_SECRET in ${file}`);
  return secret;
}

mkdirSync(join(DATA_DIR, 'files'), { recursive: true });

const client = createClient({ url: `file:${join(DATA_DIR, 'notey.db')}` });
await client.execute('PRAGMA journal_mode = WAL');
await client.execute('PRAGMA foreign_keys = ON');
await client.execute('PRAGMA busy_timeout = 5000');

const app = createApp({
  db: libsqlAdapter(client),
  storage: diskAdapter(join(DATA_DIR, 'files')),
  env: { NOTEY_SECRET: loadSecret(), PUBLIC_URL: process.env.PUBLIC_URL || undefined, NOTEY_TOKEN_RATE_LIMIT: process.env.NOTEY_TOKEN_RATE_LIMIT },
});

const server = new Hono();
server.route('/', app);
if (existsSync(join(WEB_DIR, 'index.html'))) {
  const root = relative(process.cwd(), WEB_DIR) || '.';
  server.use('/*', serveStatic({ root }));
  // SPA fallback for client routes.
  server.get('*', serveStatic({ root, path: 'index.html' }));
}

/**
 * Client IP for rate limiting: the socket address, or the first
 * X-Forwarded-For hop when TRUST_PROXY=1 (behind nginx, Caddy, Traefik).
 */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
type Incoming = { socket: { remoteAddress?: string } };
function clientIp(req: Request, incoming: Incoming): string | undefined {
  if (TRUST_PROXY) {
    const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  return incoming.socket.remoteAddress;
}

serve({
  port: PORT,
  fetch: (req: Request, env: { incoming: Incoming }) => server.fetch(withClientIp(req, clientIp(req, env.incoming)), env),
}, (info) => {
  console.log(`Notey listening on http://localhost:${info.port} (data: ${DATA_DIR})`);
});
