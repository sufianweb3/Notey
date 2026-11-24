import type { SearchHit } from '../../shared/schemas';
import type { DbAdapter } from '../db/types';
import { assertWorkspaceAccess, type WsCtx } from './context';

/*
 * FTS5 index over page titles and Markdown (PRD 6.11). Kept in step by the
 * page and trash services; only live pages are indexed.
 */

/** Markdown → plain words for the index, so search snippets never show Markdown syntax. */
export function indexText(md: string): string {
  return md
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '') // code fences
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '') // table rules
    .replace(/^\s{0,3}(#{1,6}|>\s*\[![A-Z]+\]|>|[-*+]|\d+[.)])\s*(\[[ xX]\]\s*)?/gm, '') // block markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images
    .replace(/\\([\\`*_{}[\]()#+\-.!|$~<>])/g, '$1') // backslash escapes
    .replace(/[*_~`|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Indexes a page (body: its Markdown) or a task (body: its notes). */
export async function indexItem(
  a: DbAdapter,
  item: { kind: 'page' | 'task'; id: string; workspaceId: string; title: string; body: string },
) {
  await a.batch([
    { sql: `DELETE FROM search_fts WHERE item_id = ?`, params: [item.id] },
    {
      sql: `INSERT INTO search_fts (workspace_id, kind, item_id, title, body) VALUES (?, ?, ?, ?, ?)`,
      params: [item.workspaceId, item.kind, item.id, item.title, indexText(item.body)],
    },
  ]);
}

export async function indexPage(a: DbAdapter, p: { id: string; workspaceId: string; title: string; contentMd: string }) {
  await indexItem(a, { kind: 'page', id: p.id, workspaceId: p.workspaceId, title: p.title, body: p.contentMd });
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

type Row = {
  kind: 'page' | 'task';
  id: string;
  title: string;
  snippet: string | null;
  project_id: string | null;
  updated_at: string;
  status: string | null;
};

/**
 * Pages and tasks, ranked by title match first, then recency. An empty query
 * returns the most recently edited pages (the command menu's default list).
 */
export async function searchPages(a: DbAdapter, ctx: WsCtx, q: string, limit = 20): Promise<SearchHit[]> {
  assertWorkspaceAccess(ctx);
  const match = ftsQuery(q);
  let rows: Row[];
  if (!match) {
    rows = (await a.all(
      `SELECT 'page' AS kind, id, title, '' AS snippet, project_id, updated_at, NULL AS status FROM page
       WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
      [ctx.workspaceId, limit],
    )) as Row[];
  } else {
    // Both joins are workspace-scoped as well as the index row (rule 2).
    rows = (await a.all(
      `SELECT f.kind AS kind, f.item_id AS id,
              COALESCE(p.title, t.title) AS title,
              snippet(search_fts, 4, char(1), char(2), '…', 14) AS snippet,
              COALESCE(p.project_id, t.project_id) AS project_id,
              COALESCE(p.updated_at, t.updated_at) AS updated_at,
              t.status AS status,
              (instr(lower(COALESCE(p.title, t.title)), lower(?)) > 0) AS title_hit
       FROM search_fts f
       LEFT JOIN page p ON f.kind = 'page' AND p.id = f.item_id AND p.workspace_id = ? AND p.deleted_at IS NULL
       LEFT JOIN task t ON f.kind = 'task' AND t.id = f.item_id AND t.workspace_id = ? AND t.deleted_at IS NULL
       WHERE search_fts MATCH ? AND f.workspace_id = ? AND (p.id IS NOT NULL OR t.id IS NOT NULL)
       ORDER BY title_hit DESC, updated_at DESC
       LIMIT ?`,
      [q.trim(), ctx.workspaceId, ctx.workspaceId, match, ctx.workspaceId, limit],
    )) as Row[];
  }
  return rows.map((r) => ({
    kind: r.kind === 'task' ? 'task' : 'page',
    id: String(r.id),
    title: String(r.title ?? ''),
    snippet: String(r.snippet ?? ''),
    projectId: r.project_id === null ? null : String(r.project_id),
    updatedAt: String(r.updated_at),
    ...(r.kind === 'task' ? { status: (r.status ?? 'todo') as SearchHit['status'] } : {}),
  }));
}
