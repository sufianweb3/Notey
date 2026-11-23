import { and, asc, eq, isNotNull, isNull, lt, max } from 'drizzle-orm';
import type { CreateWorkspaceInput, UpdateWorkspaceInput, Workspace } from '../../shared/schemas';
import { nowIso, uuidv7 } from '../../shared/ids';
import * as s from '../db/schema';
import { workspace } from '../db/schema';
import type { NoteyDb } from '../db/types';
import { logChange } from './changelog';
import { assertOwner, assertWorkspaceAccess, ServiceError, type OwnerCtx, type WsCtx } from './context';

export const TRASH_DAYS = 30;

type Row = typeof workspace.$inferSelect;

function toDto(r: Row): Workspace {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    sort: r.sort,
    aiEnabled: r.aiEnabled,
    createdAt: r.createdAt,
    deletedAt: r.deletedAt,
  };
}

/** Live workspaces the actor can see. An agent sees only its own. */
export async function listWorkspaces(db: NoteyDb, ctx: OwnerCtx): Promise<Workspace[]> {
  const where =
    ctx.actor.kind === 'agent'
      ? and(isNull(workspace.deletedAt), eq(workspace.id, ctx.actor.workspaceId))
      : isNull(workspace.deletedAt);
  const rows = await db.select().from(workspace).where(where).orderBy(asc(workspace.sort), asc(workspace.createdAt));
  return rows.map(toDto);
}

export async function listTrashedWorkspaces(db: NoteyDb, ctx: OwnerCtx): Promise<Workspace[]> {
  assertOwner(ctx, 'see deleted workspaces');
  const rows = await db.select().from(workspace).where(isNotNull(workspace.deletedAt)).orderBy(asc(workspace.deletedAt));
  return rows.map(toDto);
}

async function findLive(db: NoteyDb, ctx: WsCtx): Promise<Row> {
  assertWorkspaceAccess(ctx);
  const [row] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, ctx.workspaceId), isNull(workspace.deletedAt)));
  if (!row) throw new ServiceError('not_found', 'Workspace not found');
  return row;
}

export async function getWorkspace(db: NoteyDb, ctx: WsCtx): Promise<Workspace> {
  return toDto(await findLive(db, ctx));
}

export async function createWorkspace(db: NoteyDb, ctx: OwnerCtx, input: CreateWorkspaceInput): Promise<Workspace> {
  assertOwner(ctx, 'create workspaces');
  const [last] = await db.select({ sort: max(workspace.sort) }).from(workspace);
  const row: Row = {
    id: uuidv7(),
    name: input.name,
    icon: input.icon || null,
    sort: (last?.sort ?? -1) + 1,
    aiEnabled: true,
    createdAt: nowIso(),
    deletedAt: null,
  };
  await db.insert(workspace).values(row);
  await logChange(db, { workspaceId: row.id, actor: ctx.actor }, 'workspace', row.id, 'create');
  return toDto(row);
}

export async function updateWorkspace(db: NoteyDb, ctx: WsCtx, input: UpdateWorkspaceInput): Promise<Workspace> {
  assertOwner(ctx, 'change workspace settings');
  const row = await findLive(db, ctx);
  const patch: Partial<Row> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.icon !== undefined) patch.icon = input.icon || null;
  if (input.aiEnabled !== undefined) patch.aiEnabled = input.aiEnabled;
  await db.update(workspace).set(patch).where(eq(workspace.id, row.id));
  await logChange(db, ctx, 'workspace', row.id, 'update');
  return toDto({ ...row, ...patch });
}

/** Sets the sidebar order. `ids` must list every live workspace exactly once. */
export async function reorderWorkspaces(db: NoteyDb, ctx: OwnerCtx, ids: string[]): Promise<Workspace[]> {
  assertOwner(ctx, 'reorder workspaces');
  const live = await listWorkspaces(db, ctx);
  const liveIds = new Set(live.map((w) => w.id));
  if (ids.length !== liveIds.size || new Set(ids).size !== ids.length || !ids.every((id) => liveIds.has(id))) {
    throw new ServiceError('invalid', 'The order must list every workspace once');
  }
  for (const [i, id] of ids.entries()) {
    await db.update(workspace).set({ sort: i }).where(eq(workspace.id, id));
  }
  return listWorkspaces(db, ctx);
}

/** Moves a workspace to trash. The owner must type its exact name. */
export async function deleteWorkspace(db: NoteyDb, ctx: WsCtx, confirmName: string): Promise<void> {
  assertOwner(ctx, 'delete workspaces');
  const row = await findLive(db, ctx);
  if (confirmName.trim() !== row.name) {
    throw new ServiceError('invalid', 'Type the workspace name exactly to delete it');
  }
  const live = await listWorkspaces(db, ctx);
  if (live.length <= 1) throw new ServiceError('conflict', 'You need at least one workspace. Create another one first.');
  await db.update(workspace).set({ deletedAt: nowIso() }).where(eq(workspace.id, row.id));
  await logChange(db, ctx, 'workspace', row.id, 'delete');
}

export async function restoreWorkspace(db: NoteyDb, ctx: WsCtx): Promise<Workspace> {
  assertOwner(ctx, 'restore workspaces');
  const [row] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, ctx.workspaceId), isNotNull(workspace.deletedAt)));
  if (!row) throw new ServiceError('not_found', 'Deleted workspace not found');
  const [last] = await db.select({ sort: max(workspace.sort) }).from(workspace).where(isNull(workspace.deletedAt));
  const patch = { deletedAt: null, sort: (last?.sort ?? -1) + 1 };
  await db.update(workspace).set(patch).where(eq(workspace.id, row.id));
  await logChange(db, ctx, 'workspace', row.id, 'restore');
  return toDto({ ...row, ...patch });
}

/** Children first. Deleted explicitly: libSQL over HTTP may not enforce FK cascades. */
const WORKSPACE_CHILDREN = [
  s.pageVersion,
  s.taskCompletion,
  s.aiGrant,
  s.aiMessage,
  s.aiChat,
  s.aiProvider,
  s.oauthGrant,
  s.apiToken,
  s.file,
  s.pin,
  s.task,
  s.page,
  s.folder,
  s.project,
  s.changeLog,
] as const;

/** Permanently removes workspaces that have been in trash for 30 days, with everything in them. */
export async function purgeExpiredWorkspaces(db: NoteyDb, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000).toISOString();
  const expired = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(isNotNull(workspace.deletedAt), lt(workspace.deletedAt, cutoff)));
  for (const { id } of expired) {
    for (const table of WORKSPACE_CHILDREN) {
      await db.delete(table).where(eq(table.workspaceId, id));
    }
    await db.delete(workspace).where(eq(workspace.id, id));
  }
  return expired.length;
}
