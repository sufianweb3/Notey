/**
 * Vercel entry. `pnpm build:vercel` bundles this file into a Node function in
 * .vercel/output (Build Output API v3), with the SPA as static files.
 */
import { getRequestListener } from '@hono/node-server';
import { createClient } from '@libsql/client/web';
import { d1GatewayAdapter } from '../src/adapters/db/d1-gateway';
import { libsqlAdapter } from '../src/adapters/db/libsql';
import { vercelBlobAdapter } from '../src/adapters/storage/vercel-blob';
import { createApp } from '../src/server/app';
import { withClientIp } from '../src/server/client-ip';
import type { DbAdapter } from '../src/server/db/types';

const env = process.env;
const blobToken = env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) throw new Error('BLOB_READ_WRITE_TOKEN is not set');

/**
 * Database: Turso (TURSO_URL + TURSO_TOKEN), or a Cloudflare D1 database
 * through the gateway Worker (NOTEY_DB_GATEWAY_URL + NOTEY_DB_GATEWAY_SECRET).
 */
function database(): DbAdapter {
  const tursoUrl = env.TURSO_URL ?? env.TURSO_DATABASE_URL;
  if (tursoUrl) return libsqlAdapter(createClient({ url: tursoUrl, authToken: env.TURSO_TOKEN ?? env.TURSO_AUTH_TOKEN }));
  if (env.NOTEY_DB_GATEWAY_URL && env.NOTEY_DB_GATEWAY_SECRET) {
    return d1GatewayAdapter({ url: env.NOTEY_DB_GATEWAY_URL, secret: env.NOTEY_DB_GATEWAY_SECRET });
  }
  throw new Error('No database configured: set TURSO_URL, or NOTEY_DB_GATEWAY_URL and NOTEY_DB_GATEWAY_SECRET');
}

const app = createApp({
  db: database(),
  storage: vercelBlobAdapter(blobToken),
  env: { NOTEY_SECRET: env.NOTEY_SECRET ?? '', PUBLIC_URL: env.PUBLIC_URL || undefined },
});

export default getRequestListener((req) => {
  // Vercel terminates TLS at its edge; restore the public https URL so auth
  // origin checks compare like with like.
  const https = req.headers.get('x-forwarded-proto') === 'https' && req.url.startsWith('http:');
  const url = https ? `https:${req.url.slice(5)}` : req.url;
  // Vercel overwrites x-real-ip with the client address.
  return app.fetch(withClientIp(req, req.headers.get('x-real-ip'), url));
});
