import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Block } from '../../shared/blocks';
import { canvasToMarkdown, type CanvasContent } from '../../shared/canvas';
import type { MindmapContent } from '../../shared/mindmap';
import type { PageType } from '../../shared/schemas';
import { page, task } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { blocksToMarkdown } from '../md/blocks-to-md';
import { mindmapToOutline } from '../md/outline';

/*
 * content_md for every page type (PRD §7): docs as Markdown, mindmaps as an
 * outline, canvases as a text description. Search, export, MCP and the AI
 * read this, never content_json.
 */

function collect(blocks: Block[], type: string, prop: string, out: string[] = []): string[] {
  for (const b of blocks) {
    if (b.type === type && typeof b.props?.[prop] === 'string' && b.props[prop]) out.push(b.props[prop] as string);
    if (b.children?.length) collect(b.children, type, prop, out);
  }
  return out;
}

/** Doc Markdown with task blocks and page embeds resolved to live titles, inside this workspace only. */
export async function pageMarkdown(a: DbAdapter, workspaceId: string, blocks: Block[] | null): Promise<string> {
  if (!blocks?.length) return '';
  const taskIds = [...new Set(collect(blocks, 'task', 'taskId'))];
  const pageIds = [...new Set(collect(blocks, 'pageEmbed', 'pageId'))];
  const [tasks, pages] = await Promise.all([
    taskIds.length
      ? a.db
          .select({ id: task.id, title: task.title, status: task.status })
          .from(task)
          .where(and(eq(task.workspaceId, workspaceId), inArray(task.id, taskIds), isNull(task.deletedAt)))
      : [],
    pageIds.length
      ? a.db
          .select({ id: page.id, title: page.title })
          .from(page)
          .where(and(eq(page.workspaceId, workspaceId), inArray(page.id, pageIds), isNull(page.deletedAt)))
      : [],
  ]);
  return blocksToMarkdown(blocks, {
    tasks: new Map(tasks.map((r) => [r.id, { title: r.title, done: r.status === 'done' }])),
    pages: new Map(pages.map((r) => [r.id, r.title || 'Untitled'])),
  });
}

export async function contentMarkdown(a: DbAdapter, workspaceId: string, type: PageType, content: unknown): Promise<string> {
  if (content == null) return '';
  if (type === 'canvas') return canvasToMarkdown(content as CanvasContent);
  if (type === 'mindmap') return mindmapToOutline(content as MindmapContent);
  return pageMarkdown(a, workspaceId, content as Block[]);
}
