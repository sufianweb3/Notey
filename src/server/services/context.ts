/**
 * Who is acting. Agents (API/MCP tokens) are always bound to exactly one
 * workspace; the owner can act on any workspace they own.
 */
export type Actor =
  | { kind: 'user'; userId: string; name: string }
  | { kind: 'agent'; tokenId: string; name: string; workspaceId: string; scope: 'read' | 'write' };

/** Account-level operations (list or create workspaces). */
export type OwnerCtx = { actor: Actor };
/** Everything inside a workspace. Required by every workspace-scoped service. */
export type WsCtx = { workspaceId: string; actor: Actor };

export type ServiceErrorCode = 'not_found' | 'forbidden' | 'conflict' | 'invalid' | 'unauthorized';

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    /** Extra JSON for the client, e.g. the current rev on a save conflict. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** Stored in created_by / updated_by / change_log.actor. */
export function actorLabel(actor: Actor): string {
  return actor.kind === 'user' ? `user:${actor.userId}` : `agent:${actor.name}`;
}

/**
 * Agents bound to another workspace get not_found rather than forbidden, so a
 * token can't even learn that other workspaces exist.
 */
export function assertWorkspaceAccess(ctx: WsCtx): void {
  if (ctx.actor.kind === 'agent' && ctx.actor.workspaceId !== ctx.workspaceId) {
    throw new ServiceError('not_found', 'Workspace not found');
  }
}

/** Read-scoped agent tokens can't write anything. */
export function assertCanWrite(ctx: OwnerCtx): void {
  if (ctx.actor.kind === 'agent' && ctx.actor.scope !== 'write') {
    throw new ServiceError('forbidden', 'This token is read-only');
  }
}

export function assertOwner(ctx: OwnerCtx, what: string): asserts ctx is { actor: Extract<Actor, { kind: 'user' }> } {
  if (ctx.actor.kind !== 'user') throw new ServiceError('forbidden', `Only the owner can ${what}`);
}
