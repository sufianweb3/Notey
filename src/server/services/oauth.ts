import { count, eq, lt } from 'drizzle-orm';
import { nowIso, uuidv7 } from '../../shared/ids';
import type { TokenScope } from '../../shared/schemas';
import { timingSafeEqual } from '../auth/password';
import { oauthClient, oauthGrant } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { assertLiveWorkspace } from './content';
import { assertOwner, type WsCtx } from './context';
import { hashToken, insertToken } from './tokens';

/*
 * OAuth 2.1 for MCP connectors (PRD 6.13): dynamic client registration,
 * authorization code with PKCE (S256 only), and a consent screen where the
 * owner picks one workspace and a scope. The access token is an ordinary
 * workspace token (source "oauth"), revocable in Settings > AI access.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CLIENTS = 200;

/** OAuth's own error format (RFC 6749 §5.2), not the app's. */
export class OAuthError extends Error {
  constructor(
    readonly error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_redirect_uri' | 'invalid_client_metadata' | 'access_denied',
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function okRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 500) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  // https anywhere; http only back to this machine (CLI tools). Custom schemes for native apps.
  return u.protocol === 'https:' || (u.protocol === 'http:' && loopback) || /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(u.protocol);
}

export type ClientInfo = { id: string; name: string; redirectUris: string[] };

export async function registerClient(a: DbAdapter, body: Record<string, unknown>): Promise<ClientInfo> {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(okRedirectUri)) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1 to 10 https URLs (http only for localhost), without fragments.');
  }
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'An app';
  const [{ n }] = (await a.db.select({ n: count() }).from(oauthClient)) as [{ n: number }];
  if (n >= MAX_CLIENTS) throw new OAuthError('invalid_client_metadata', 'Too many apps are registered with this Notey.');
  const row = { id: uuidv7(), name, redirectUris: JSON.stringify(uris), createdAt: nowIso() };
  await a.db.insert(oauthClient).values(row);
  return { id: row.id, name, redirectUris: uris as string[] };
}

async function getClient(a: DbAdapter, id: string): Promise<ClientInfo | null> {
  const [row] = await a.db.select().from(oauthClient).where(eq(oauthClient.id, id));
  return row ? { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirectUris) as string[] } : null;
}

export type AuthRequest = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
  scope?: string;
  resource?: string;
};

/**
 * Checks an authorization request. Client and redirect URI are checked first:
 * until both match, errors are shown to the person, never sent to the URI.
 */
export async function checkAuthRequest(a: DbAdapter, q: Partial<AuthRequest>): Promise<{ client: ClientInfo; req: AuthRequest }> {
  const client = q.client_id ? await getClient(a, q.client_id) : null;
  if (!client) throw new OAuthError('invalid_client', 'This app isn’t registered with this Notey. Connect it again from the app.');
  if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
    throw new OAuthError('invalid_redirect_uri', 'The app sent a return address it didn’t register.');
  }
  if (q.response_type !== 'code') throw new OAuthError('invalid_request', 'Only response_type=code is supported.');
  if (!q.code_challenge || q.code_challenge.length < 43 || q.code_challenge.length > 128 || q.code_challenge_method !== 'S256') {
    throw new OAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  return { client, req: q as AuthRequest };
}

/** "read" unless the app asked for write; the owner can still choose on the consent screen. */
export const requestedScope = (scope?: string): TokenScope => (/\b(write|notey:write)\b/.test(scope ?? '') ? 'write' : 'read');

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** Owner approved: issue a one-time code for this workspace and scope. */
export async function approve(a: DbAdapter, ctx: WsCtx, q: Partial<AuthRequest>, scope: TokenScope, issuer: string): Promise<string> {
  assertOwner(ctx, 'connect apps');
  await assertLiveWorkspace(a, ctx);
  const { req } = await checkAuthRequest(a, q);
  // Codes nobody exchanged expire; clear them out as new ones are made.
  await a.db.delete(oauthGrant).where(lt(oauthGrant.expiresAt, nowIso()));
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await a.db.insert(oauthGrant).values({
    id: uuidv7(),
    clientId: req.client_id,
    workspaceId: ctx.workspaceId,
    scope,
    codeHash: await hashToken(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    redirectUri: req.redirect_uri,
    codeChallenge: req.code_challenge,
  });
  return withParams(req.redirect_uri, { code, state: req.state, iss: issuer });
}

export async function deny(a: DbAdapter, q: Partial<AuthRequest>, issuer: string): Promise<string> {
  const { req } = await checkAuthRequest(a, q);
  return withParams(req.redirect_uri, { error: 'access_denied', error_description: 'The owner declined.', state: req.state, iss: issuer });
}

/** Code → token. Codes are single use, expire in 10 minutes and need the PKCE verifier. */
export async function exchangeCode(
  a: DbAdapter,
  p: { grant_type?: string; code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string },
): Promise<{ access_token: string; token_type: 'Bearer'; scope: string }> {
  if (p.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
  if (!p.code || !p.code_verifier || !p.client_id) throw new OAuthError('invalid_request', 'code, code_verifier and client_id are required.');
  const [grant] = await a.db.select().from(oauthGrant).where(eq(oauthGrant.codeHash, await hashToken(p.code)));
  if (!grant) throw new OAuthError('invalid_grant', 'This code is invalid or was already used.');
  // Single use: gone before anything else is checked.
  await a.db.delete(oauthGrant).where(eq(oauthGrant.id, grant.id));
  if (Date.parse(grant.expiresAt) < Date.now()) throw new OAuthError('invalid_grant', 'This code expired. Connect again.');
  if (grant.clientId !== p.client_id) throw new OAuthError('invalid_grant', 'This code belongs to another app.');
  if (p.redirect_uri !== undefined && p.redirect_uri !== grant.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri doesn’t match.');
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(p.code_verifier))));
  if (!timingSafeEqual(enc.encode(challenge), enc.encode(grant.codeChallenge))) throw new OAuthError('invalid_grant', 'code_verifier doesn’t match.');
  const client = await getClient(a, grant.clientId);
  const { secret } = await insertToken(a, grant.workspaceId, { name: client?.name ?? 'Connected app', scope: grant.scope, source: 'oauth', clientId: grant.clientId });
  return { access_token: secret, token_type: 'Bearer', scope: grant.scope };
}
