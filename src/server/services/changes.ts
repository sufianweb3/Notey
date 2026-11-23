import type { Change } from '../../shared/schemas';
import type { DbAdapter } from '../db/types';
import { assertLiveWorkspace } from './content';
import type { WsCtx } from './context';

/**
 * Live refresh feed (PRD §8): the client polls with the last seq it saw.
 * Without `since`, it returns only the current head so the client can start there.
 */
export async function listChanges(a: DbAdapter, ctx: WsCtx, since: number | null): Promise<{ seq: number; changes: Change[] }> {
  await assertLiveWorkspace(a, ctx);
  if (since === null) {
    const [row] = await a.all(`SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log WHERE workspace_id = ?`, [ctx.workspaceId]);
    return { seq: Number(row?.seq ?? 0), changes: [] };
  }
  const rows = await a.all(
    `SELECT seq, entity, entity_id, op, actor, at FROM change_log
     WHERE workspace_id = ? AND seq > ? ORDER BY seq ASC LIMIT 500`,
    [ctx.workspaceId, since],
  );
  const changes = rows.map((r) => ({
    seq: Number(r.seq),
    entity: String(r.entity),
    entityId: String(r.entity_id),
    op: String(r.op),
    actor: String(r.actor),
    at: String(r.at),
  }));
  return { seq: changes.at(-1)?.seq ?? since, changes };
}
