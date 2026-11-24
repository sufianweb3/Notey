/**
 * Worker that gives the Vercel deploy a D1 database (see src/server/db/gateway.ts).
 * Deploy: pnpm deploy:gateway. Secret: wrangler secret put GATEWAY_SECRET -c wrangler.gateway.jsonc
 */
import { handleGateway, type D1Like } from '../server/db/gateway';

interface Env {
  DB: D1Database;
  GATEWAY_SECRET: string;
}

export default {
  fetch: (request, env) => handleGateway(request, { db: env.DB as unknown as D1Like, secret: env.GATEWAY_SECRET }),
} satisfies ExportedHandler<Env>;
