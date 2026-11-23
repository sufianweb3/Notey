/**
 * Vercel entry. `pnpm build:vercel` bundles this file into a Node function in
 * .vercel/output (Build Output API v3), with the SPA as static files.
 */
import { getRequestListener } from '@hono/node-server';
import { createClient } from '@libsql/client/web';
import { libsqlAdapter } from '../src/adapters/db/libsql';
import { vercelBlobAdapter } from '../src/adapters/storage/vercel-blob';
import { createApp } from '../src/server/app';
import { withClientIp } from '../src/server/client-ip';

const env = process.env;
const url = env.TURSO_URL ?? env.TURSO_DATABASE_URL;
const authToken = env.TURSO_TOKEN ?? env.TURSO_AUTH_TOKEN;
const blobToken = env.BLOB_READ_WRITE_TOKEN;
if (!url) throw new Error('TURSO_URL is not set');
if (!blobToken) throw new Error('BLOB_READ_WRITE_TOKEN is not set');

const app = createApp({
  db: libsqlAdapter(createClient({ url, authToken })),
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
