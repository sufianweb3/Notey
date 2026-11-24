import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { createTokenInput } from '../../../shared/schemas';
import type { AppEnv, Deps } from '../../hono-env';
import type { WsCtx } from '../../services/context';
import * as tokens from '../../services/tokens';
import { validationHook } from './errors';

/** Settings > AI access: /api/workspaces/:wsId/tokens (owner session only). */
export function tokenRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const a = deps.adapter;
  const ctx = (c: Context<AppEnv>): WsCtx => ({ workspaceId: c.req.param('wsId')!, actor: c.get('actor') });
  r.get('/tokens', async (c) => c.json({ tokens: await tokens.listTokens(a, ctx(c)) }));
  r.post('/tokens', zValidator('json', createTokenInput, validationHook), async (c) => {
    const { token, secret } = await tokens.createToken(a, ctx(c), c.req.valid('json'));
    c.header('Cache-Control', 'no-store');
    return c.json({ token, secret }, 201);
  });
  r.post('/tokens/:id/revoke', async (c) => {
    await tokens.revokeToken(a, ctx(c), c.req.param('id'));
    return c.json({ ok: true });
  });
  return r;
}
