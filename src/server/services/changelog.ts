import { changeLog } from '../db/schema';
import type { NoteyDb } from '../db/types';
import { actorLabel, type WsCtx } from './context';

type Op = (typeof changeLog.$inferInsert)['op'];

/** Every write records a change_log row; clients poll it for live refresh. */
export async function logChange(db: NoteyDb, ctx: WsCtx, entity: string, entityId: string, op: Op) {
  await db.insert(changeLog).values({
    workspaceId: ctx.workspaceId,
    entity,
    entityId,
    op,
    actor: actorLabel(ctx.actor),
    at: new Date().toISOString(),
  });
}
