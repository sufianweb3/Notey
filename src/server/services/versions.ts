import { and, desc, eq } from 'drizzle-orm';
import type { Block } from '../../shared/blocks';
import { nowIso, uuidv7 } from '../../shared/ids';
import type { VersionDetail, VersionSummary } from '../../shared/schemas';
import { page, pageVersion } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { pageMarkdown } from './tasks';
import { logChange } from './changelog';
import { assertLiveWorkspace, livePage, pageDetailDto } from './content';
import { actorLabel, assertCanWrite, ServiceError, type WsCtx } from './context';
import { indexPage } from './search';

/** Page history (PRD 6.12): every 5 minutes of activity, before agent writes, on demand. */
export const SNAPSHOT_EVERY_MS = 5 * 60_000;

type PageRow = typeof page.$inferSelect;
type VersionRow = typeof pageVersion.$inferSelect;

const summary = (v: VersionRow): VersionSummary => ({
  id: v.id,
  rev: v.rev,
  title: v.title,
  author: v.author,
  reason: v.reason,
  createdAt: v.createdAt,
});

export async function snapshot(a: DbAdapter, ctx: WsCtx, p: PageRow, reason: string): Promise<VersionSummary> {
  const row: VersionRow = {
    id: uuidv7(),
    pageId: p.id,
    workspaceId: ctx.workspaceId,
    rev: p.rev,
    title: p.title,
    contentJson: p.contentJson,
    // The version belongs to whoever wrote that content, not whoever triggered the snapshot.
    author: p.updatedBy,
    reason,
    createdAt: nowIso(),
  };
  await a.db.insert(pageVersion).values(row);
  return summary(row);
}

/** Snapshots the page's current state if the last snapshot is older than 5 minutes (or `force`). */
export async function snapshotIfDue(a: DbAdapter, ctx: WsCtx, p: PageRow, reason: string, force = false) {
  if (!p.contentJson && !p.title) return; // nothing worth keeping yet
  if (!force) {
    const [last] = await a.db
      .select({ createdAt: pageVersion.createdAt, rev: pageVersion.rev })
      .from(pageVersion)
      .where(and(eq(pageVersion.pageId, p.id), eq(pageVersion.workspaceId, ctx.workspaceId)))
      .orderBy(desc(pageVersion.createdAt))
      .limit(1);
    if (last && (last.rev === p.rev || Date.now() - Date.parse(last.createdAt) < SNAPSHOT_EVERY_MS)) return;
  }
  await snapshot(a, ctx, p, reason);
}

export async function listVersions(a: DbAdapter, ctx: WsCtx, pageId: string): Promise<VersionSummary[]> {
  await assertLiveWorkspace(a, ctx);
  await livePage(a, ctx, pageId);
  const rows = await a.db
    .select()
    .from(pageVersion)
    .where(and(eq(pageVersion.pageId, pageId), eq(pageVersion.workspaceId, ctx.workspaceId)))
    .orderBy(desc(pageVersion.createdAt))
    .limit(200);
  return rows.map(summary);
}

async function findVersion(a: DbAdapter, ctx: WsCtx, pageId: string, versionId: string) {
  const [row] = await a.db
    .select()
    .from(pageVersion)
    .where(and(eq(pageVersion.id, versionId), eq(pageVersion.pageId, pageId), eq(pageVersion.workspaceId, ctx.workspaceId)));
  if (!row) throw new ServiceError('not_found', 'Version not found');
  return row;
}

export async function getVersion(a: DbAdapter, ctx: WsCtx, pageId: string, versionId: string): Promise<VersionDetail> {
  await assertLiveWorkspace(a, ctx);
  await livePage(a, ctx, pageId);
  const row = await findVersion(a, ctx, pageId, versionId);
  const content = row.contentJson ? (JSON.parse(row.contentJson) as Block[]) : null;
  return { ...summary(row), content, contentMd: await pageMarkdown(a, ctx.workspaceId, content) };
}

export async function createSnapshot(a: DbAdapter, ctx: WsCtx, pageId: string): Promise<VersionSummary> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  return snapshot(a, ctx, await livePage(a, ctx, pageId), 'manual');
}

/** Restores a version as a new rev; the current state is snapshotted first, so restore is undoable. */
export async function restoreVersion(a: DbAdapter, ctx: WsCtx, pageId: string, versionId: string) {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const current = await livePage(a, ctx, pageId);
  const v = await findVersion(a, ctx, pageId, versionId);
  await snapshot(a, ctx, current, 'before restore');
  const contentMd = v.contentJson ? await pageMarkdown(a, ctx.workspaceId, JSON.parse(v.contentJson) as Block[]) : '';
  const patch = {
    title: v.title,
    contentJson: v.contentJson,
    contentMd,
    rev: current.rev + 1,
    updatedAt: nowIso(),
    updatedBy: actorLabel(ctx.actor),
  };
  await a.db.update(page).set(patch).where(and(eq(page.id, pageId), eq(page.workspaceId, ctx.workspaceId)));
  await indexPage(a, { id: pageId, workspaceId: ctx.workspaceId, title: v.title, contentMd });
  await logChange(a.db, ctx, 'page', pageId, 'update');
  return pageDetailDto({ ...current, ...patch });
}
