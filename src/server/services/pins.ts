import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import { uuidv7 } from '../../shared/ids';
import type { PinItem, PinType } from '../../shared/schemas';
import { folder, page, pin, project, task } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { logChange } from './changelog';
import { assertLiveWorkspace } from './content';
import { assertCanWrite, ServiceError, type WsCtx } from './context';
import { taskDto } from './tasks';

/*
 * Pins (PRD 6.6): per workspace, by item id, so they survive moves and
 * renames. A pin whose item is in Trash is hidden, and shows again on restore.
 */

const TABLES = { page, folder, project, task } as const;

async function itemExists(a: DbAdapter, ctx: WsCtx, type: PinType, id: string) {
  const t = TABLES[type];
  const [row] = await a.db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.id, id), eq(t.workspaceId, ctx.workspaceId), isNull(t.deletedAt)));
  return !!row;
}

export async function pinItem(a: DbAdapter, ctx: WsCtx, itemType: PinType, itemId: string): Promise<{ id: string }> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  if (!(await itemExists(a, ctx, itemType, itemId))) throw new ServiceError('not_found', 'Nothing to pin');
  const [existing] = await a.db
    .select({ id: pin.id })
    .from(pin)
    .where(and(eq(pin.workspaceId, ctx.workspaceId), eq(pin.itemType, itemType), eq(pin.itemId, itemId)));
  if (existing) return existing;
  const [last] = await a.db.select({ sort: max(pin.sort) }).from(pin).where(eq(pin.workspaceId, ctx.workspaceId));
  const id = uuidv7();
  await a.db.insert(pin).values({ id, workspaceId: ctx.workspaceId, itemType, itemId, sort: (last?.sort ?? -1) + 1 });
  await logChange(a.db, ctx, 'pin', id, 'create');
  return { id };
}

export async function unpinItem(a: DbAdapter, ctx: WsCtx, itemType: PinType, itemId: string): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const res = await a.run(`DELETE FROM pin WHERE workspace_id = ? AND item_type = ? AND item_id = ?`, [ctx.workspaceId, itemType, itemId]);
  if (res.changes) await logChange(a.db, ctx, 'pin', itemId, 'delete');
}

/** `ids` are pin ids in their new order; pins not listed keep their place after them. */
export async function reorderPins(a: DbAdapter, ctx: WsCtx, ids: string[]): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const rows = await a.db.select({ id: pin.id }).from(pin).where(eq(pin.workspaceId, ctx.workspaceId)).orderBy(asc(pin.sort));
  const known = new Set(rows.map((r) => r.id));
  if (!ids.every((id) => known.has(id))) throw new ServiceError('not_found', 'Pin not found');
  const order = [...ids, ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];
  for (const [i, id] of order.entries()) {
    await a.db.update(pin).set({ sort: i }).where(and(eq(pin.id, id), eq(pin.workspaceId, ctx.workspaceId)));
  }
  await logChange(a.db, ctx, 'pin', ids[0]!, 'move');
}

/** All live pins with what they point at, in the owner's order. */
export async function listPins(a: DbAdapter, ctx: WsCtx): Promise<PinItem[]> {
  await assertLiveWorkspace(a, ctx);
  const ws = ctx.workspaceId;
  const pins = await a.db.select().from(pin).where(eq(pin.workspaceId, ws)).orderBy(asc(pin.sort));
  const idsOf = (t: PinType) => pins.filter((p) => p.itemType === t).map((p) => p.itemId);
  const live = <T extends (typeof TABLES)[PinType]>(t: T, ids: string[]) => and(eq(t.workspaceId, ws), inArray(t.id, ids), isNull(t.deletedAt));

  const [pages, folders, projects, tasks] = await Promise.all([
    idsOf('page').length ? a.db.select().from(page).where(live(page, idsOf('page'))) : [],
    idsOf('folder').length ? a.db.select().from(folder).where(live(folder, idsOf('folder'))) : [],
    idsOf('project').length ? a.db.select().from(project).where(live(project, idsOf('project'))) : [],
    idsOf('task').length ? a.db.select().from(task).where(live(task, idsOf('task'))) : [],
  ]);

  // Task progress for pinned projects (the Home signal card).
  const progress = new Map<string, { done: number; total: number }>();
  if (projects.length) {
    const ids = projects.map((p) => p.id);
    const rows = await a.all(
      `SELECT project_id, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, COUNT(*) AS total
       FROM task WHERE workspace_id = ? AND deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')})
       GROUP BY project_id`,
      [ws, ...ids],
    );
    for (const r of rows) progress.set(String(r.project_id), { done: Number(r.done), total: Number(r.total) });
  }

  const byId = {
    page: new Map(pages.map((p) => [p.id, p])),
    folder: new Map(folders.map((f) => [f.id, f])),
    project: new Map(projects.map((p) => [p.id, p])),
    task: new Map(tasks.map((t) => [t.id, t])),
  };
  const out: PinItem[] = [];
  for (const p of pins) {
    const base = { id: p.id, itemType: p.itemType, itemId: p.itemId, sort: p.sort };
    if (p.itemType === 'page') {
      const it = byId.page.get(p.itemId);
      if (it) out.push({ ...base, title: it.title, icon: it.icon, pageType: it.type, projectId: it.projectId, updatedAt: it.updatedAt, updatedBy: it.updatedBy });
    } else if (p.itemType === 'folder') {
      const it = byId.folder.get(p.itemId);
      if (it) out.push({ ...base, title: it.name, icon: null, projectId: it.projectId });
    } else if (p.itemType === 'project') {
      const it = byId.project.get(p.itemId);
      if (it) out.push({ ...base, title: it.name, icon: it.icon, projectId: it.id, progress: progress.get(it.id) ?? { done: 0, total: 0 } });
    } else {
      const it = byId.task.get(p.itemId);
      if (it) out.push({ ...base, title: it.title, icon: null, projectId: it.projectId, task: taskDto(it) });
    }
  }
  return out;
}
