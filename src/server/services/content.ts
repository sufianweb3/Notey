import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import type { Block } from '../../shared/blocks';
import { nowIso, uuidv7 } from '../../shared/ids';
import {
  MAX_CONTENT_BYTES,
  type FolderNode,
  type MoveInput,
  type PageDetail,
  type PageNode,
  type PageType,
  type ProjectNode,
  type Tree,
} from '../../shared/schemas';
import { folder, page, project, workspace } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { pageMarkdown } from './tasks';
import { logChange } from './changelog';
import { actorLabel, assertCanWrite, assertWorkspaceAccess, ServiceError, type WsCtx } from './context';
import { indexPage } from './search';
import { snapshotIfDue } from './versions';

type PageRow = typeof page.$inferSelect;
type FolderRow = typeof folder.$inferSelect;
type ProjectRow = typeof project.$inferSelect;

// ── Guards ──────────────────────────────────────────────────────────────────

/** Every workspace-scoped call starts here: access check plus "workspace is live". */
export async function assertLiveWorkspace(a: DbAdapter, ctx: WsCtx) {
  assertWorkspaceAccess(ctx);
  const [w] = await a.db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, ctx.workspaceId), isNull(workspace.deletedAt)));
  if (!w) throw new ServiceError('not_found', 'Workspace not found');
}

export async function liveProject(a: DbAdapter, ctx: WsCtx, id: string): Promise<ProjectRow> {
  const [row] = await a.db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.workspaceId, ctx.workspaceId), isNull(project.deletedAt)));
  if (!row) throw new ServiceError('not_found', 'Project not found');
  return row;
}

export async function liveFolder(a: DbAdapter, ctx: WsCtx, id: string): Promise<FolderRow> {
  const [row] = await a.db
    .select()
    .from(folder)
    .where(and(eq(folder.id, id), eq(folder.workspaceId, ctx.workspaceId), isNull(folder.deletedAt)));
  if (!row) throw new ServiceError('not_found', 'Folder not found');
  return row;
}

export async function livePage(a: DbAdapter, ctx: WsCtx, id: string): Promise<PageRow> {
  const [row] = await a.db
    .select()
    .from(page)
    .where(and(eq(page.id, id), eq(page.workspaceId, ctx.workspaceId), isNull(page.deletedAt)));
  if (!row) throw new ServiceError('not_found', 'Page not found');
  return row;
}

// ── DTOs ────────────────────────────────────────────────────────────────────

const projectDto = (r: ProjectRow): ProjectNode => ({ id: r.id, name: r.name, icon: r.icon, sort: r.sort });
const folderDto = (r: FolderRow): FolderNode => ({
  id: r.id,
  projectId: r.projectId,
  parentId: r.parentId,
  name: r.name,
  sort: r.sort,
});
const pageNodeDto = (r: Pick<PageRow, keyof PageNode>): PageNode => ({
  id: r.id,
  projectId: r.projectId,
  folderId: r.folderId,
  type: r.type,
  title: r.title,
  icon: r.icon,
  sort: r.sort,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy,
});

export function pageDetailDto(r: PageRow): PageDetail {
  return {
    ...pageNodeDto(r),
    content: r.contentJson ? (JSON.parse(r.contentJson) as unknown[]) : null,
    contentMd: r.contentMd,
    rev: r.rev,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  };
}

// ── Tree ────────────────────────────────────────────────────────────────────

export async function getTree(a: DbAdapter, ctx: WsCtx): Promise<Tree> {
  await assertLiveWorkspace(a, ctx);
  const ws = ctx.workspaceId;
  const [projects, folders, pages] = await Promise.all([
    a.db
      .select()
      .from(project)
      .where(and(eq(project.workspaceId, ws), isNull(project.deletedAt)))
      .orderBy(asc(project.sort), asc(project.createdAt)),
    a.db
      .select()
      .from(folder)
      .where(and(eq(folder.workspaceId, ws), isNull(folder.deletedAt)))
      .orderBy(asc(folder.sort), asc(folder.id)),
    a.db
      .select({
        id: page.id,
        projectId: page.projectId,
        folderId: page.folderId,
        type: page.type,
        title: page.title,
        icon: page.icon,
        sort: page.sort,
        updatedAt: page.updatedAt,
        updatedBy: page.updatedBy,
      })
      .from(page)
      .where(and(eq(page.workspaceId, ws), isNull(page.deletedAt)))
      .orderBy(asc(page.sort), asc(page.id)),
  ]);
  return { projects: projects.map(projectDto), folders: folders.map(folderDto), pages: pages.map(pageNodeDto) };
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function createProject(a: DbAdapter, ctx: WsCtx, input: { name: string; icon?: string }) {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const [last] = await a.db
    .select({ sort: max(project.sort) })
    .from(project)
    .where(and(eq(project.workspaceId, ctx.workspaceId), isNull(project.deletedAt)));
  const row: ProjectRow = {
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    name: input.name,
    icon: input.icon || null,
    sort: (last?.sort ?? -1) + 1,
    createdAt: nowIso(),
    deletedAt: null,
  };
  await a.db.insert(project).values(row);
  await logChange(a.db, ctx, 'project', row.id, 'create');
  return projectDto(row);
}

export async function updateProject(a: DbAdapter, ctx: WsCtx, id: string, input: { name?: string; icon?: string | null }) {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const row = await liveProject(a, ctx, id);
  const patch: Partial<ProjectRow> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.icon !== undefined) patch.icon = input.icon || null;
  await a.db.update(project).set(patch).where(and(eq(project.id, id), eq(project.workspaceId, ctx.workspaceId)));
  await logChange(a.db, ctx, 'project', id, 'update');
  return projectDto({ ...row, ...patch });
}

// ── Folders ─────────────────────────────────────────────────────────────────

async function nextSort(a: DbAdapter, table: typeof folder | typeof page, where: ReturnType<typeof and>) {
  const [last] = await a.db.select({ sort: max(table.sort) }).from(table).where(where);
  return (last?.sort ?? -1) + 1;
}

const folderSiblings = (ctx: WsCtx, projectId: string, parentId: string | null) =>
  and(
    eq(folder.workspaceId, ctx.workspaceId),
    eq(folder.projectId, projectId),
    parentId ? eq(folder.parentId, parentId) : isNull(folder.parentId),
    isNull(folder.deletedAt),
  );

const pageSiblings = (ctx: WsCtx, projectId: string, folderId: string | null) =>
  and(
    eq(page.workspaceId, ctx.workspaceId),
    eq(page.projectId, projectId),
    folderId ? eq(page.folderId, folderId) : isNull(page.folderId),
    isNull(page.deletedAt),
  );

export async function createFolder(
  a: DbAdapter,
  ctx: WsCtx,
  input: { projectId: string; parentId?: string | null; name: string },
) {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  await liveProject(a, ctx, input.projectId);
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await liveFolder(a, ctx, parentId);
    if (parent.projectId !== input.projectId) throw new ServiceError('invalid', 'The parent folder is in another project');
  }
  const row: FolderRow = {
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    projectId: input.projectId,
    parentId,
    name: input.name,
    sort: await nextSort(a, folder, folderSiblings(ctx, input.projectId, parentId)),
    deletedAt: null,
  };
  await a.db.insert(folder).values(row);
  await logChange(a.db, ctx, 'folder', row.id, 'create');
  return folderDto(row);
}

export async function renameFolder(a: DbAdapter, ctx: WsCtx, id: string, name: string) {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const row = await liveFolder(a, ctx, id);
  await a.db.update(folder).set({ name }).where(and(eq(folder.id, id), eq(folder.workspaceId, ctx.workspaceId)));
  await logChange(a.db, ctx, 'folder', id, 'update');
  return folderDto({ ...row, name });
}

// ── Pages ───────────────────────────────────────────────────────────────────

export async function createPage(
  a: DbAdapter,
  ctx: WsCtx,
  input: { projectId: string; folderId?: string | null; type: PageType; title: string; content?: Block[] },
): Promise<PageDetail> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  await liveProject(a, ctx, input.projectId);
  const folderId = input.folderId ?? null;
  if (folderId) {
    const f = await liveFolder(a, ctx, folderId);
    if (f.projectId !== input.projectId) throw new ServiceError('invalid', 'The folder is in another project');
  }
  const now = nowIso();
  const who = actorLabel(ctx.actor);
  const row: PageRow = {
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    projectId: input.projectId,
    folderId,
    sort: await nextSort(a, page, pageSiblings(ctx, input.projectId, folderId)),
    type: input.type,
    title: input.title,
    icon: null,
    contentJson: input.content ? JSON.stringify(input.content) : null,
    contentMd: input.content ? await pageMarkdown(a, ctx.workspaceId, input.content) : '',
    rev: 0,
    createdBy: who,
    updatedBy: who,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await a.db.insert(page).values(row);
  await indexPage(a, row);
  await logChange(a.db, ctx, 'page', row.id, 'create');
  return pageDetailDto(row);
}

export async function getPage(a: DbAdapter, ctx: WsCtx, id: string): Promise<PageDetail> {
  await assertLiveWorkspace(a, ctx);
  return pageDetailDto(await livePage(a, ctx, id));
}

export async function updatePageMeta(
  a: DbAdapter,
  ctx: WsCtx,
  id: string,
  input: { title?: string; icon?: string | null },
): Promise<PageDetail> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const row = await livePage(a, ctx, id);
  const patch: Partial<PageRow> = { updatedAt: nowIso(), updatedBy: actorLabel(ctx.actor) };
  if (input.title !== undefined) patch.title = input.title;
  if (input.icon !== undefined) patch.icon = input.icon || null;
  await a.db.update(page).set(patch).where(and(eq(page.id, id), eq(page.workspaceId, ctx.workspaceId)));
  const next = { ...row, ...patch };
  if (input.title !== undefined) await indexPage(a, next);
  await logChange(a.db, ctx, 'page', id, 'update');
  return pageDetailDto(next);
}

/**
 * Saves the document. `rev` must match the stored rev or the save is
 * rejected with 409 and the current rev (PRD §8 conflict rule).
 * content_md is regenerated here, on the server, on every save.
 */
export async function savePageContent(
  a: DbAdapter,
  ctx: WsCtx,
  id: string,
  input: { rev: number; content: Block[] },
): Promise<{ rev: number; updatedAt: string; contentMd: string }> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const json = JSON.stringify(input.content);
  if (json.length > MAX_CONTENT_BYTES) throw new ServiceError('invalid', 'This page is too large to save (over 2 MB).');
  const current = await livePage(a, ctx, id);
  if (current.rev !== input.rev) {
    throw new ServiceError('conflict', 'This page changed somewhere else.', {
      rev: current.rev,
      updatedBy: current.updatedBy,
      updatedAt: current.updatedAt,
    });
  }
  // Agents always snapshot first (rule 4); the owner every 5 minutes of activity.
  await snapshotIfDue(a, ctx, current, ctx.actor.kind === 'agent' ? 'before agent edit' : 'autosave', ctx.actor.kind === 'agent');
  const contentMd = await pageMarkdown(a, ctx.workspaceId, input.content);
  const updatedAt = nowIso();
  const res = await a.run(
    `UPDATE page SET content_json = ?, content_md = ?, rev = rev + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND workspace_id = ? AND rev = ? AND deleted_at IS NULL`,
    [json, contentMd, updatedAt, actorLabel(ctx.actor), id, ctx.workspaceId, input.rev],
  );
  if (res.changes === 0) {
    const latest = await livePage(a, ctx, id);
    throw new ServiceError('conflict', 'This page changed somewhere else.', { rev: latest.rev, updatedBy: latest.updatedBy });
  }
  await indexPage(a, { id, workspaceId: ctx.workspaceId, title: current.title, contentMd });
  await logChange(a.db, ctx, 'page', id, 'update');
  return { rev: input.rev + 1, updatedAt, contentMd };
}

export async function duplicatePage(a: DbAdapter, ctx: WsCtx, id: string): Promise<PageDetail> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const src = await livePage(a, ctx, id);
  const copy = await createPage(a, ctx, {
    projectId: src.projectId,
    folderId: src.folderId,
    type: src.type,
    title: src.title ? `${src.title} (copy)` : '',
    content: src.contentJson ? (JSON.parse(src.contentJson) as Block[]) : undefined,
  });
  // Place the copy right after the original.
  await moveItem(a, ctx, {
    kind: 'page',
    id: copy.id,
    projectId: src.projectId,
    parentId: src.folderId,
    index: (await siblingIds(a, ctx, 'page', src.projectId, src.folderId)).indexOf(src.id) + 1,
  });
  return getPage(a, ctx, copy.id);
}

// ── Move and reorder ────────────────────────────────────────────────────────

async function siblingIds(
  a: DbAdapter,
  ctx: WsCtx,
  kind: 'folder' | 'page',
  projectId: string,
  parentId: string | null,
): Promise<string[]> {
  if (kind === 'folder') {
    const rows = await a.db
      .select({ id: folder.id })
      .from(folder)
      .where(folderSiblings(ctx, projectId, parentId))
      .orderBy(asc(folder.sort), asc(folder.id));
    return rows.map((r) => r.id);
  }
  const rows = await a.db
    .select({ id: page.id })
    .from(page)
    .where(pageSiblings(ctx, projectId, parentId))
    .orderBy(asc(page.sort), asc(page.id));
  return rows.map((r) => r.id);
}

/** All live folders below `rootId` (not including it). */
export async function descendantFolderIds(a: DbAdapter, ctx: WsCtx, rootId: string, deletedAt: string | null = null) {
  const all = await a.db
    .select({ id: folder.id, parentId: folder.parentId, deletedAt: folder.deletedAt })
    .from(folder)
    .where(eq(folder.workspaceId, ctx.workspaceId));
  const out: string[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    const next = all.filter((f) => f.parentId && frontier.includes(f.parentId) && f.deletedAt === deletedAt).map((f) => f.id);
    out.push(...next);
    frontier = next;
  }
  return out;
}

export async function moveItem(a: DbAdapter, ctx: WsCtx, input: MoveInput): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const where = (t: typeof folder | typeof page | typeof project, id: string) => and(eq(t.id, id), eq(t.workspaceId, ctx.workspaceId));

  if (input.kind === 'project') {
    await liveProject(a, ctx, input.id);
    const rows = await a.db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.workspaceId, ctx.workspaceId), isNull(project.deletedAt)))
      .orderBy(asc(project.sort), asc(project.createdAt));
    const ids = rows.map((r) => r.id).filter((id) => id !== input.id);
    ids.splice(Math.min(input.index ?? ids.length, ids.length), 0, input.id);
    for (const [i, id] of ids.entries()) await a.db.update(project).set({ sort: i }).where(where(project, id));
    await logChange(a.db, ctx, 'project', input.id, 'move');
    return;
  }

  const item = input.kind === 'folder' ? await liveFolder(a, ctx, input.id) : await livePage(a, ctx, input.id);
  const projectId = input.projectId ?? item.projectId;
  await liveProject(a, ctx, projectId);
  const parentId = input.parentId === undefined ? (input.kind === 'folder' ? (item as FolderRow).parentId : (item as PageRow).folderId) : input.parentId;

  if (parentId) {
    const parent = await liveFolder(a, ctx, parentId);
    if (parent.projectId !== projectId) throw new ServiceError('invalid', 'That folder is in another project');
    if (input.kind === 'folder') {
      if (parentId === input.id) throw new ServiceError('invalid', "A folder can't go inside itself");
      const below = await descendantFolderIds(a, ctx, input.id);
      if (below.includes(parentId)) throw new ServiceError('invalid', "A folder can't go inside one of its own folders");
    }
  }

  const ids = (await siblingIds(a, ctx, input.kind, projectId, parentId)).filter((id) => id !== input.id);
  ids.splice(Math.min(input.index ?? ids.length, ids.length), 0, input.id);

  if (input.kind === 'folder') {
    await a.db.update(folder).set({ projectId, parentId }).where(where(folder, input.id));
    for (const [i, id] of ids.entries()) await a.db.update(folder).set({ sort: i }).where(where(folder, id));
    if (projectId !== item.projectId) {
      // Everything inside follows the folder into the new project.
      const below = await descendantFolderIds(a, ctx, input.id);
      const all = [input.id, ...below];
      if (below.length) await a.db.update(folder).set({ projectId }).where(and(eq(folder.workspaceId, ctx.workspaceId), inArray(folder.id, below)));
      await a.db.update(page).set({ projectId }).where(and(eq(page.workspaceId, ctx.workspaceId), inArray(page.folderId, all)));
    }
  } else {
    await a.db.update(page).set({ projectId, folderId: parentId }).where(where(page, input.id));
    for (const [i, id] of ids.entries()) await a.db.update(page).set({ sort: i }).where(where(page, id));
  }
  await logChange(a.db, ctx, input.kind, input.id, 'move');
}
