import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { nowIso } from '../../shared/ids';
import type { TrashItem, TrashKind } from '../../shared/schemas';
import { folder, page, pageVersion, pin, project, task, taskCompletion } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { logChange } from './changelog';
import { assertLiveWorkspace, descendantFolderIds, liveFolder, livePage, liveProject } from './content';
import { assertCanWrite, assertOwner, ServiceError, type WsCtx } from './context';
import { indexPage, unindex } from './search';
import { indexTask } from './tasks';
import { TRASH_DAYS } from './workspace';

/*
 * Trash (PRD 6.2, 6.12). Deleting stamps the item and everything inside it
 * with one deleted_at value. Restoring brings back exactly the rows with that
 * stamp, so things deleted earlier on their own stay in trash. A project takes
 * its folders, pages and tasks with it.
 */

const inWs = (ctx: WsCtx) => ({
  project: eq(project.workspaceId, ctx.workspaceId),
  folder: eq(folder.workspaceId, ctx.workspaceId),
  page: eq(page.workspaceId, ctx.workspaceId),
  task: eq(task.workspaceId, ctx.workspaceId),
});

type Ids = { folders: string[]; pages: string[]; tasks: string[] };

/** Folder, page and task ids that belong to an item, with the given deleted_at state. */
async function subtree(a: DbAdapter, ctx: WsCtx, kind: TrashKind, id: string, deletedAt: string | null): Promise<Ids> {
  const w = inWs(ctx);
  const stamp = (col: typeof folder.deletedAt | typeof page.deletedAt | typeof task.deletedAt) =>
    deletedAt === null ? isNull(col) : eq(col, deletedAt);
  if (kind === 'task') return { folders: [], pages: [], tasks: [id] };
  if (kind === 'page') return { folders: [], pages: [id], tasks: [] };
  if (kind === 'project') {
    const [folders, pages, tasks] = await Promise.all([
      a.db.select({ id: folder.id }).from(folder).where(and(w.folder, eq(folder.projectId, id), stamp(folder.deletedAt))),
      a.db.select({ id: page.id }).from(page).where(and(w.page, eq(page.projectId, id), stamp(page.deletedAt))),
      a.db.select({ id: task.id }).from(task).where(and(w.task, eq(task.projectId, id), stamp(task.deletedAt))),
    ]);
    return { folders: folders.map((f) => f.id), pages: pages.map((p) => p.id), tasks: tasks.map((t) => t.id) };
  }
  const below = await descendantFolderIds(a, ctx, id, deletedAt);
  const folders = [id, ...below];
  const pages = await a.db.select({ id: page.id }).from(page).where(and(w.page, inArray(page.folderId, folders), stamp(page.deletedAt)));
  return { folders, pages: pages.map((p) => p.id), tasks: [] };
}

async function inChunks(ids: string[], fn: (chunk: string[]) => Promise<unknown>) {
  for (let i = 0; i < ids.length; i += 50) await fn(ids.slice(i, i + 50));
}

async function stampRows(a: DbAdapter, ctx: WsCtx, ids: Ids, value: string | null) {
  const w = inWs(ctx);
  await inChunks(ids.folders, (c) => a.db.update(folder).set({ deletedAt: value }).where(and(w.folder, inArray(folder.id, c))));
  await inChunks(ids.pages, (c) => a.db.update(page).set({ deletedAt: value }).where(and(w.page, inArray(page.id, c))));
  await inChunks(ids.tasks, (c) => a.db.update(task).set({ deletedAt: value }).where(and(w.task, inArray(task.id, c))));
}

export async function trashItem(a: DbAdapter, ctx: WsCtx, kind: TrashKind, id: string): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const at = nowIso();
  const w = inWs(ctx);
  if (kind === 'project') {
    await liveProject(a, ctx, id);
    await a.db.update(project).set({ deletedAt: at }).where(and(w.project, eq(project.id, id)));
  } else if (kind === 'folder') await liveFolder(a, ctx, id);
  else if (kind === 'page') await livePage(a, ctx, id);
  else {
    const [t] = await a.db.select({ id: task.id }).from(task).where(and(w.task, eq(task.id, id), isNull(task.deletedAt)));
    if (!t) throw new ServiceError('not_found', 'Task not found');
  }
  const ids = await subtree(a, ctx, kind, id, null);
  await stampRows(a, ctx, ids, at);
  await unindex(a, [...ids.pages, ...ids.tasks]);
  await logChange(a.db, ctx, kind, id, 'delete');
}

export async function listTrash(a: DbAdapter, ctx: WsCtx): Promise<TrashItem[]> {
  await assertLiveWorkspace(a, ctx);
  await purgeExpiredItems(a, ctx);
  const w = inWs(ctx);
  const [projects, folders, pages, tasks, allProjects, allFolders] = await Promise.all([
    a.db.select().from(project).where(and(w.project, isNotNull(project.deletedAt))),
    a.db.select().from(folder).where(and(w.folder, isNotNull(folder.deletedAt))),
    a.db
      .select({ id: page.id, title: page.title, projectId: page.projectId, folderId: page.folderId, deletedAt: page.deletedAt })
      .from(page)
      .where(and(w.page, isNotNull(page.deletedAt))),
    a.db
      .select({ id: task.id, title: task.title, projectId: task.projectId, deletedAt: task.deletedAt })
      .from(task)
      .where(and(w.task, isNotNull(task.deletedAt))),
    a.db.select({ id: project.id, name: project.name, deletedAt: project.deletedAt }).from(project).where(w.project),
    a.db.select({ id: folder.id, name: folder.name, parentId: folder.parentId, deletedAt: folder.deletedAt }).from(folder).where(w.folder),
  ]);
  const projectById = new Map(allProjects.map((p) => [p.id, p]));
  const folderById = new Map(allFolders.map((f) => [f.id, f]));
  const path = (projectId: string | null, folderId: string | null) => {
    if (!projectId) return 'Inbox';
    const parts: string[] = [];
    for (let f = folderId ? folderById.get(folderId) : undefined; f; f = f.parentId ? folderById.get(f.parentId) : undefined) {
      parts.unshift(f.name);
    }
    return [projectById.get(projectId)?.name ?? 'Unknown project', ...parts].join(' / ');
  };
  const sameStamp = (other: string | null | undefined, at: string | null) => !!other && other === at;

  const items: TrashItem[] = [];
  for (const p of projects) {
    const n =
      folders.filter((f) => f.projectId === p.id && f.deletedAt === p.deletedAt).length +
      pages.filter((pg) => pg.projectId === p.id && pg.deletedAt === p.deletedAt).length +
      tasks.filter((t) => t.projectId === p.id && t.deletedAt === p.deletedAt).length;
    items.push({ kind: 'project', id: p.id, name: p.name, deletedAt: p.deletedAt!, contains: n, location: '' });
  }
  for (const f of folders) {
    const parentGone =
      sameStamp(projectById.get(f.projectId)?.deletedAt, f.deletedAt) ||
      (f.parentId !== null && sameStamp(folderById.get(f.parentId)?.deletedAt, f.deletedAt));
    if (parentGone) continue;
    const inside = (await descendantFolderIds(a, ctx, f.id, f.deletedAt)).length;
    const pagesInside = pages
      .filter((pg) => pg.deletedAt === f.deletedAt && pg.folderId !== null)
      .filter((pg) => {
        for (let x = folderById.get(pg.folderId!); x; x = x.parentId ? folderById.get(x.parentId) : undefined) if (x.id === f.id) return true;
        return false;
      }).length;
    items.push({ kind: 'folder', id: f.id, name: f.name, deletedAt: f.deletedAt!, contains: inside + pagesInside, location: path(f.projectId, f.parentId) });
  }
  for (const pg of pages) {
    const parentGone =
      sameStamp(projectById.get(pg.projectId)?.deletedAt, pg.deletedAt) ||
      (pg.folderId !== null && sameStamp(folderById.get(pg.folderId)?.deletedAt, pg.deletedAt));
    if (parentGone) continue;
    items.push({ kind: 'page', id: pg.id, name: pg.title, deletedAt: pg.deletedAt!, contains: 0, location: path(pg.projectId, pg.folderId) });
  }
  for (const t of tasks) {
    if (t.projectId && sameStamp(projectById.get(t.projectId)?.deletedAt, t.deletedAt)) continue;
    items.push({ kind: 'task', id: t.id, name: t.title, deletedAt: t.deletedAt!, contains: 0, location: path(t.projectId, null) });
  }
  return items.sort((x, y) => y.deletedAt.localeCompare(x.deletedAt));
}

async function trashedRow(a: DbAdapter, ctx: WsCtx, kind: TrashKind, id: string) {
  const w = inWs(ctx);
  const table = { project, folder, page, task }[kind];
  const [row] = (await a.db
    .select()
    .from(table)
    .where(and(w[kind], eq(table.id, id), isNotNull(table.deletedAt)))) as Record<string, unknown>[];
  if (!row) throw new ServiceError('not_found', 'Not in trash');
  return row as { id: string; deletedAt: string; projectId?: string | null; parentId?: string | null; folderId?: string | null };
}

export async function restoreItem(a: DbAdapter, ctx: WsCtx, kind: TrashKind, id: string): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const row = await trashedRow(a, ctx, kind, id);
  const at = row.deletedAt;
  const w = inWs(ctx);

  if (kind === 'project') {
    await a.db.update(project).set({ deletedAt: null }).where(and(w.project, eq(project.id, id)));
  } else if (row.projectId) {
    const [proj] = await a.db.select().from(project).where(and(w.project, eq(project.id, row.projectId)));
    if (proj?.deletedAt && proj.deletedAt !== at) {
      // A task can live without a project: it comes back to the Inbox.
      if (kind === 'task') await a.db.update(task).set({ projectId: null }).where(and(w.task, eq(task.id, id)));
      else throw new ServiceError('conflict', `Restore the project "${proj.name}" first.`);
    }
    // If the folder it lived in is gone, it comes back at the top of the project.
    const parentId = kind === 'folder' ? row.parentId : kind === 'page' ? row.folderId : null;
    if (parentId) {
      const [parent] = await a.db.select({ deletedAt: folder.deletedAt }).from(folder).where(and(w.folder, eq(folder.id, parentId)));
      if (!parent || (parent.deletedAt && parent.deletedAt !== at)) {
        if (kind === 'folder') await a.db.update(folder).set({ parentId: null }).where(and(w.folder, eq(folder.id, id)));
        else await a.db.update(page).set({ folderId: null }).where(and(w.page, eq(page.id, id)));
      }
    }
  }

  const ids = await subtree(a, ctx, kind, id, at);
  await stampRows(a, ctx, ids, null);
  for (const pid of ids.pages) {
    const [p] = await a.db.select().from(page).where(and(w.page, eq(page.id, pid)));
    if (p) await indexPage(a, p);
  }
  for (const tid of ids.tasks) {
    const [t] = await a.db.select().from(task).where(and(w.task, eq(task.id, tid)));
    if (t) await indexTask(a, t);
  }
  await logChange(a.db, ctx, kind, id, 'restore');
}

/** Owner only. Agents can never permanently delete (CLAUDE.md rule 4). */
export async function deleteForever(a: DbAdapter, ctx: WsCtx, kind: TrashKind, id: string): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertOwner(ctx, 'delete permanently');
  const row = await trashedRow(a, ctx, kind, id);
  await hardDelete(a, ctx, kind, id, row.deletedAt);
  await logChange(a.db, ctx, kind, id, 'delete');
}

async function hardDelete(a: DbAdapter, ctx: WsCtx, kind: TrashKind, id: string, at: string) {
  const w = inWs(ctx);
  const ids = await subtree(a, ctx, kind, id, at);
  const wsPin = eq(pin.workspaceId, ctx.workspaceId);
  await unindex(a, [...ids.pages, ...ids.tasks]);
  await inChunks(ids.tasks, async (c) => {
    await a.db.delete(taskCompletion).where(and(eq(taskCompletion.workspaceId, ctx.workspaceId), inArray(taskCompletion.taskId, c)));
    await a.db.delete(pin).where(and(wsPin, eq(pin.itemType, 'task'), inArray(pin.itemId, c)));
    await a.db.delete(task).where(and(w.task, inArray(task.id, c)));
  });
  await inChunks(ids.pages, async (c) => {
    await a.db.delete(pageVersion).where(and(eq(pageVersion.workspaceId, ctx.workspaceId), inArray(pageVersion.pageId, c)));
    await a.db.delete(pin).where(and(wsPin, eq(pin.itemType, 'page'), inArray(pin.itemId, c)));
    await a.db.delete(page).where(and(w.page, inArray(page.id, c)));
  });
  await inChunks(ids.folders, async (c) => {
    await a.db.delete(pin).where(and(wsPin, eq(pin.itemType, 'folder'), inArray(pin.itemId, c)));
    await a.db.delete(folder).where(and(w.folder, inArray(folder.id, c)));
  });
  if (kind === 'project') {
    await a.db.delete(pin).where(and(wsPin, eq(pin.itemType, 'project'), eq(pin.itemId, id)));
    await a.db.delete(project).where(and(w.project, eq(project.id, id)));
  }
}

/** Items in trash for more than 30 days are removed for good. Runs when trash is listed. */
export async function purgeExpiredItems(a: DbAdapter, ctx: WsCtx, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000).toISOString();
  const w = inWs(ctx);
  let n = 0;
  const expired: [TrashKind, { id: string; at: string | null }[]][] = [
    ['project', await a.db.select({ id: project.id, at: project.deletedAt }).from(project).where(and(w.project, lt(project.deletedAt, cutoff)))],
    ['folder', await a.db.select({ id: folder.id, at: folder.deletedAt }).from(folder).where(and(w.folder, lt(folder.deletedAt, cutoff)))],
    ['page', await a.db.select({ id: page.id, at: page.deletedAt }).from(page).where(and(w.page, lt(page.deletedAt, cutoff)))],
    ['task', await a.db.select({ id: task.id, at: task.deletedAt }).from(task).where(and(w.task, lt(task.deletedAt, cutoff)))],
  ];
  for (const [kind, rows] of expired) {
    for (const r of rows) {
      await hardDelete(a, ctx, kind, r.id, r.at!);
      n++;
    }
  }
  return n;
}
