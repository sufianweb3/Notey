import { d1Adapter } from '../adapters/db/d1';
import { r2Adapter } from '../adapters/storage/r2';
import { createApp, type NoteyApp } from '../server/app';
import { withClientIp } from '../server/client-ip';

interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  NOTEY_SECRET: string;
  PUBLIC_URL?: string;
  NOTEY_TOKEN_RATE_LIMIT?: string;
}

// Static assets (the SPA) are served by Workers Assets before this runs; see
// `assets.run_worker_first` in wrangler.jsonc for the paths that reach the app.
let app: NoteyApp | undefined;

export default {
  fetch(request, env, ctx) {
    app ??= createApp({
      db: d1Adapter(env.DB),
      storage: r2Adapter(env.FILES),
      env: { NOTEY_SECRET: env.NOTEY_SECRET, PUBLIC_URL: env.PUBLIC_URL || undefined, NOTEY_TOKEN_RATE_LIMIT: env.NOTEY_TOKEN_RATE_LIMIT },
    });
    // Cloudflare sets cf-connecting-ip itself; clients can't override it.
    return app.fetch(withClientIp(request, request.headers.get('cf-connecting-ip')), env, ctx);
  },
} satisfies ExportedHandler<Env>;
