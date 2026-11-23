import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Deps } from '../../hono-env';

/** Resolves the Better Auth session cookie into an owner actor, or 401. */
export function requireUser(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: 'unauthorized', message: 'Sign in to continue.' } }, 401);
    }
    c.set('actor', { kind: 'user', userId: session.user.id, name: session.user.name });
    c.set('userEmail', session.user.email);
    await next();
  };
}
