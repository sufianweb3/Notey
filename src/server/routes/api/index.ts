import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { setupInput } from '../../../shared/schemas';
import { VERSION } from '../../../shared/version';
import type { AppEnv, Deps } from '../../hono-env';
import { needsSetup, runSetup } from '../../services/setup';
import { errorJson, validationHook } from './errors';
import { requireUser } from './middleware';
import { contentRoutes } from './content';
import { consentRoutes } from '../oauth';
import { taskRoutes } from './tasks';
import { tokenRoutes } from './tokens';
import { workspaceRoutes } from './workspaces';

export function apiRoutes(deps: Deps) {
  const api = new Hono<AppEnv>();

  // ── Public ────────────────────────────────────────────────────────────────
  api.get('/health', async (c) => {
    const rows = await deps.adapter.all('SELECT COUNT(*) AS n FROM __notey_migrations');
    return c.json({
      ok: true,
      version: VERSION,
      db: deps.adapter.kind,
      storage: deps.storage.kind,
      migrations: Number(rows[0]?.n ?? 0),
    });
  });

  api.get('/setup', async (c) => c.json({ needsSetup: await needsSetup(deps.adapter) }));

  api.post('/setup', zValidator('json', setupInput, validationHook), async (c) => {
    const { response, workspace } = await runSetup(deps.adapter, deps.auth, c.req.valid('json'), c.req.raw.headers);
    const out = c.json({ workspace }, 201);
    for (const cookie of response.headers.getSetCookie()) out.headers.append('set-cookie', cookie);
    return out;
  });

  // Better Auth. Public sign-up is closed: the owner is created by /setup only.
  api.on(['GET', 'POST'], '/auth/*', (c) => {
    if (new URL(c.req.url).pathname.startsWith('/api/auth/sign-up')) {
      return errorJson(c, 'forbidden', 'Sign-up is closed. This Notey has an owner.', 403);
    }
    return deps.auth.handler(c.req.raw);
  });

  // ── Owner session required ────────────────────────────────────────────────
  const authed = new Hono<AppEnv>();
  authed.use('*', requireUser(deps));

  authed.get('/me', (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'user') return errorJson(c, 'forbidden', 'Owner only', 403);
    return c.json({ user: { id: actor.userId, name: actor.name, email: c.get('userEmail') } });
  });

  authed.route('/workspaces/:wsId', contentRoutes(deps));
  authed.route('/workspaces/:wsId', taskRoutes(deps));
  authed.route('/workspaces/:wsId', tokenRoutes(deps));
  authed.route('/oauth', consentRoutes(deps));
  authed.route('/workspaces', workspaceRoutes(deps));

  // Smoke test for the storage adapter on each host: write, read back, delete.
  authed.post('/selftest/storage', async (c) => {
    const key = `selftest/${crypto.randomUUID()}.txt`;
    const payload = `notey selftest ${new Date().toISOString()}`;
    await deps.storage.put(key, new TextEncoder().encode(payload), { contentType: 'text/plain' });
    const obj = await deps.storage.get(key);
    const text = obj ? await new Response(obj.body).text() : null;
    await deps.storage.delete(key);
    const gone = (await deps.storage.get(key)) === null;
    const ok = text === payload && gone;
    return c.json({ ok, storage: deps.storage.kind, roundTrip: text === payload, deleted: gone }, ok ? 200 : 500);
  });

  api.route('/', authed);
  return api;
}
