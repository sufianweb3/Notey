import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { tokenScopes } from '../../shared/schemas';
import type { AppEnv, Deps } from '../hono-env';
import { approve, checkAuthRequest, deny, exchangeCode, OAuthError, registerClient, requestedScope, type AuthRequest } from '../services/oauth';
import { validationHook } from './api/errors';
import { publicOrigin, resourceMetadataUrl } from './bearer';

function oauthError(c: Context, e: unknown) {
  if (e instanceof OAuthError) return c.json({ error: e.error, error_description: e.description }, e.status as 400);
  throw e;
}

/** Discovery documents (RFC 9728 and RFC 8414), mounted at the site root. */
export function wellKnownRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const resource = (c: Context) => {
    const origin = publicOrigin(c, deps);
    return c.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
      resource_name: 'Notey',
    });
  };
  r.get('/oauth-protected-resource', resource);
  r.get('/oauth-protected-resource/mcp', resource);
  r.get('/oauth-authorization-server', (c) => {
    const origin = publicOrigin(c, deps);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
      service_documentation: `${origin}/api/v1/openapi.json`,
    });
  });
  return r;
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1c1c1e;background:#fafaf7"><h1 style="font-size:20px">${title}</h1><p>${body}</p></body></html>`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** /oauth/*: registration, authorize (hands over to the consent screen), token. */
export function oauthRoutes(deps: Deps) {
  const a = deps.adapter;
  const r = new Hono<AppEnv>();

  r.post('/register', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) throw new OAuthError('invalid_client_metadata', 'Send client metadata as JSON.');
      const client = await registerClient(a, body);
      return c.json(
        {
          client_id: client.id,
          client_name: client.name,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          client_id_issued_at: Math.floor(Date.now() / 1000),
        },
        201,
      );
    } catch (e) {
      return oauthError(c, e);
    }
  });

  r.get('/authorize', async (c) => {
    try {
      await checkAuthRequest(a, c.req.query() as Partial<AuthRequest>);
    } catch (e) {
      if (e instanceof OAuthError) return c.html(page('This connection link doesn’t work', escapeHtml(e.description)), 400);
      throw e;
    }
    // The consent screen is part of the app (it needs the owner's session).
    return c.redirect(`/connect?${new URL(c.req.url).searchParams.toString()}`, 302);
  });

  r.post('/token', async (c) => {
    try {
      const type = c.req.header('content-type') ?? '';
      const params = type.includes('application/json')
        ? ((await c.req.json().catch(() => ({}))) as Record<string, string>)
        : (Object.fromEntries(new URLSearchParams(await c.req.text())) as Record<string, string>);
      const res = await exchangeCode(a, params);
      c.header('Cache-Control', 'no-store');
      return c.json(res);
    } catch (e) {
      return oauthError(c, e);
    }
  });

  return r;
}

const consentInput = z.object({
  request: z.record(z.string(), z.string()),
  workspaceId: z.string().min(1).optional(),
  scope: z.enum(tokenScopes).optional(),
});

/** /api/oauth/*: the consent screen's calls, behind the owner session. */
export function consentRoutes(deps: Deps) {
  const a = deps.adapter;
  const r = new Hono<AppEnv>();

  r.get('/request', async (c) => {
    try {
      const { client, req } = await checkAuthRequest(a, c.req.query() as Partial<AuthRequest>);
      return c.json({ client: { name: client.name }, redirectHost: new URL(req.redirect_uri).host, scope: requestedScope(req.scope) });
    } catch (e) {
      if (e instanceof OAuthError) return c.json({ error: { code: 'invalid', message: e.description } }, 400);
      throw e;
    }
  });

  r.post('/approve', zValidator('json', consentInput, validationHook), async (c) => {
    const { request, workspaceId, scope } = c.req.valid('json');
    if (!workspaceId || !scope) return c.json({ error: { code: 'invalid', message: 'Pick a workspace and what the app may do.' } }, 400);
    try {
      const redirect = await approve(a, { workspaceId, actor: c.get('actor') }, request, scope, publicOrigin(c, deps));
      return c.json({ redirect });
    } catch (e) {
      if (e instanceof OAuthError) return c.json({ error: { code: 'invalid', message: e.description } }, 400);
      throw e;
    }
  });

  r.post('/deny', zValidator('json', consentInput, validationHook), async (c) => {
    try {
      return c.json({ redirect: await deny(a, c.req.valid('json').request, publicOrigin(c, deps)) });
    } catch (e) {
      if (e instanceof OAuthError) return c.json({ error: { code: 'invalid', message: e.description } }, 400);
      throw e;
    }
  });

  return r;
}

export { resourceMetadataUrl };
