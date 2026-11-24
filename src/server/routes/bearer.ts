import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Deps } from '../hono-env';
import { authenticateToken, DEFAULT_RATE_LIMIT } from '../services/tokens';

/** The instance's public origin: PUBLIC_URL when set, else the request's own. */
export function publicOrigin(c: Context, deps: Deps): string {
  return (deps.env.PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
}

export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;

/**
 * Bearer token auth for /api/v1 and /mcp (PRD 6.13). The token decides the
 * workspace; nothing in the request can point it at another one.
 */
export function requireToken(deps: Deps): MiddlewareHandler<AppEnv> {
  const limit = Number(deps.env.NOTEY_TOKEN_RATE_LIMIT) || DEFAULT_RATE_LIMIT;
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const res = m ? await authenticateToken(deps.adapter, m[1]!, limit) : ({ ok: false, reason: 'invalid' } as const);
    if (!res.ok && res.reason === 'rate_limited') {
      c.header('Retry-After', String(res.retryAfter));
      return c.json({ error: { code: 'rate_limited', message: `Too many requests for this token. Try again in ${res.retryAfter} s.` } }, 429);
    }
    if (!res.ok) {
      c.header('WWW-Authenticate', `Bearer realm="Notey", resource_metadata="${resourceMetadataUrl(publicOrigin(c, deps))}"`);
      return c.json(
        { error: { code: 'unauthorized', message: m ? 'This token is invalid or was revoked.' : 'Send an access token: Authorization: Bearer ntk_…' } },
        401,
      );
    }
    c.set('actor', res.actor);
    await next();
  };
}
