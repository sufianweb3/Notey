import type { SearchHit } from '../../shared/schemas';
import type { DbAdapter } from '../db/types';
import { assertWorkspaceAccess, type WsCtx } from './context';

/*
 * FTS5 index over page titles and Markdown (PRD 6.11). Kept in step by the
 * page and trash services; only live pages are indexed.
 */

export async function indexPage(a: DbAdapter, p: { id: string; workspaceId: string; title: string; contentMd: string }) {
  await a.batch([
    { sql: `DELETE FROM search_fts WHERE item_id = ?`, params: [p.id] },
    {
      sql: `INSERT INTO search_fts (workspace_id, kind, item_id, title, body) VALUES (?, 'page', ?, ?, ?)`,
      params: [p.workspaceId, p.id, p.title, p.contentMd],
    },
  ]);
}

export async function unindex(a: DbAdapter, ids: string[]) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    await a.run(`DELETE FROM search_fts WHERE item_id IN (${chunk.map(() => '?').join(',')})`, chunk);
  }
}

/** Turns free text into a safe FTS5 query: every word must match, as a prefix. */
export function ftsQuery(q: string): string | null {
  const words = q
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
}

type Row = { id: string; title: string; snippet: string | null; project_id: string; updated_at: string };

/**
 * Ranked by title match first, then recency. An empty query returns the most
 * recently edited pages (the command menu's default list).
 */
export async function searchPages(a: DbAdapter, ctx: WsCtx, q: string, limit = 20): Promise<SearchHit[]> {
  assertWorkspaceAccess(ctx);
  const match = ftsQuery(q);
  let rows: Row[];
  if (!match) {
    rows = (await a.all(
      `SELECT id, title, '' AS snippet, project_id, updated_at FROM page
       WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
      [ctx.workspaceId, limit],
    )) as Row[];
  } else {
    rows = (await a.all(
      `SELECT p.id, p.title, snippet(search_fts, 4, char(1), char(2), '…', 14) AS snippet, p.project_id, p.updated_at,
              (instr(lower(p.title), lower(?)) > 0) AS title_hit
       FROM search_fts f JOIN page p ON p.id = f.item_id
       WHERE search_fts MATCH ? AND f.workspace_id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL
       ORDER BY title_hit DESC, p.updated_at DESC
       LIMIT ?`,
      [q.trim(), match, ctx.workspaceId, ctx.workspaceId, limit],
    )) as Row[];
  }
  return rows.map((r) => ({
    kind: 'page',
    id: String(r.id),
    title: String(r.title ?? ''),
    snippet: String(r.snippet ?? ''),
    projectId: String(r.project_id),
    updatedAt: String(r.updated_at),
  }));
}
