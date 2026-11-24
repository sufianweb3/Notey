import { and, desc, eq, isNull } from 'drizzle-orm';
import { nowIso, uuidv7 } from '../../shared/ids';
import type { TokenInfo, TokenScope } from '../../shared/schemas';
import { timingSafeEqual } from '../auth/password';
import { apiToken, workspace } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { assertLiveWorkspace } from './content';
import { assertOwner, ServiceError, type Actor, type WsCtx } from './context';

/*
 * API and MCP tokens (PRD 6.13, §9): 32 random bytes prefixed `ntk_`, shown
 * once, stored only as a SHA-256 hash, bound to one workspace, revocable.
 */

type TokenRow = typeof apiToken.$inferSelect;

export const TOKEN_PREFIX = 'ntk_';
export const DEFAULT_RATE_LIMIT = 60;

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function hashToken(secret: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(secret))));
}

function newSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return TOKEN_PREFIX + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const dto = (r: TokenRow): TokenInfo => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  source: r.source,
  lastUsedAt: r.lastUsedAt,
  createdAt: r.createdAt,
});

type NewToken = { name: string; scope: TokenScope; source?: 'manual' | 'oauth'; clientId?: string | null };

/** Owner only. Returns the secret once; only its hash is kept. */
export async function createToken(a: DbAdapter, ctx: WsCtx, input: NewToken): Promise<{ token: TokenInfo; secret: string }> {
  await assertLiveWorkspace(a, ctx);
  assertOwner(ctx, 'create access tokens');
  return insertToken(a, ctx.workspaceId, input);
}

/** For OAuth: the owner already approved this on the consent screen (see oauth.ts). */
export async function insertToken(a: DbAdapter, workspaceId: string, input: NewToken): Promise<{ token: TokenInfo; secret: string }> {
  const secret = newSecret();
  const row: TokenRow = {
    id: uuidv7(),
    workspaceId,
    name: input.name,
    tokenHash: await hashToken(secret),
    scope: input.scope,
    source: input.source ?? 'manual',
    lastUsedAt: null,
    createdAt: nowIso(),
    revokedAt: null,
    rateWindow: 0,
    rateCount: 0,
    clientId: input.clientId ?? null,
  };
  await a.db.insert(apiToken).values(row);
  return { token: dto(row), secret };
}

export async function listTokens(a: DbAdapter, ctx: WsCtx): Promise<TokenInfo[]> {
  await assertLiveWorkspace(a, ctx);
  assertOwner(ctx, 'see access tokens');
  const rows = await a.db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.workspaceId, ctx.workspaceId), isNull(apiToken.revokedAt)))
    .orderBy(desc(apiToken.createdAt));
  return rows.map(dto);
}

export async function revokeToken(a: DbAdapter, ctx: WsCtx, id: string): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertOwner(ctx, 'revoke access tokens');
  const res = await a.db
    .update(apiToken)
    .set({ revokedAt: nowIso() })
    .where(and(eq(apiToken.id, id), eq(apiToken.workspaceId, ctx.workspaceId), isNull(apiToken.revokedAt)))
    .returning({ id: apiToken.id });
  if (!res.length) throw new ServiceError('not_found', 'Token not found');
}

export type TokenAuth =
  | { ok: true; actor: Extract<Actor, { kind: 'agent' }> }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'rate_limited'; retryAfter: number };

/**
 * Resolves a bearer secret into an agent actor bound to the token's
 * workspace, and counts the request against the token's per-minute limit.
 */
export async function authenticateToken(a: DbAdapter, secret: string, limit = DEFAULT_RATE_LIMIT, now = Date.now()): Promise<TokenAuth> {
  if (!secret.startsWith(TOKEN_PREFIX) || secret.length > 200) return { ok: false, reason: 'invalid' };
  const hash = await hashToken(secret);
  const [row] = await a.db
    .select({ token: apiToken, wsDeleted: workspace.deletedAt })
    .from(apiToken)
    .innerJoin(workspace, eq(workspace.id, apiToken.workspaceId))
    .where(eq(apiToken.tokenHash, hash));
  // The lookup is by hash; compare again in constant time before trusting it.
  if (!row || !timingSafeEqual(enc.encode(row.token.tokenHash), enc.encode(hash)) || row.token.revokedAt || row.wsDeleted) {
    return { ok: false, reason: 'invalid' };
  }
  const t = row.token;
  const window = Math.floor(now / 60_000);
  const counted = await a.all(
    `UPDATE api_token SET
       rate_count = CASE WHEN rate_window = ? THEN rate_count + 1 ELSE 1 END,
       rate_window = ?,
       last_used_at = ?
     WHERE id = ? RETURNING rate_count`,
    [window, window, new Date(now).toISOString(), t.id],
  );
  if (Number(counted[0]?.rate_count ?? 0) > limit) {
    return { ok: false, reason: 'rate_limited', retryAfter: 60 - Math.floor((now % 60_000) / 1000) };
  }
  return { ok: true, actor: { kind: 'agent', tokenId: t.id, name: t.name, workspaceId: t.workspaceId, scope: t.scope } };
}
