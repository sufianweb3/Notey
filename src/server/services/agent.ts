import { and, asc, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  AgentPage,
  completeTaskArgs,
  createPageArgs,
  listTasksArgs,
  moveItemArgs,
  pinItemArgs,
  trashItemArgs,
  updatePageArgs,
  updateTaskArgs,
} from '../../shared/agent';
import type { Block } from '../../shared/blocks';
import { insertNode, type MindmapContent, type MindNode } from '../../shared/mindmap';
import type { PageDetail, Task, Tree } from '../../shared/schemas';
import { task } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { plainText } from '../md/blocks-to-md';
import { markdownToBlocks } from '../md/md-to-blocks';
import { outlineToMindmap } from '../md/outline';
import * as content from './content';
import { ServiceError, type WsCtx } from './context';
import * as pins from './pins';
import { searchPages } from './search';
import * as tasks from './tasks';
import * as trash from './trash';

/*
 * What API tokens and MCP tools can do (PRD 6.13), on top of the same
 * workspace-scoped services the app uses. Every write goes through
 * savePageContent / the task services, which snapshot first for agents,
 * record `agent:<token name>` and write the change log.
 */

const todayUtc = () => new Date().toISOString().slice(0, 10);
type UpdateMode = z.infer<typeof updatePageArgs>['mode'];

export function toAgentPage(p: PageDetail): AgentPage {
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    projectId: p.projectId,
    folderId: p.folderId,
    rev: p.rev,
    updatedAt: p.updatedAt,
    updatedBy: p.updatedBy,
    markdown: p.contentMd,
  };
}

export async function tree(a: DbAdapter, ctx: WsCtx): Promise<Tree> {
  return content.getTree(a, ctx);
}

export async function search(a: DbAdapter, ctx: WsCtx, q: { query: string; limit?: number }) {
  return searchPages(a, ctx, q.query, q.limit ?? 20);
}

export async function readPage(a: DbAdapter, ctx: WsCtx, pageId: string): Promise<AgentPage> {
  return toAgentPage(await content.getPage(a, ctx, pageId));
}

export async function createPage(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof createPageArgs>): Promise<AgentPage> {
  const md = input.markdown?.trim() ? input.markdown : undefined;
  if (input.type === 'canvas' && md) throw new ServiceError('invalid', 'A canvas starts empty. Leave out markdown, or create a doc.');
  const body =
    md === undefined ? undefined : input.type === 'mindmap' ? outlineToMindmap(md, input.title) : (markdownToBlocks(md) as Block[]);
  const p = await content.createPage(a, ctx, {
    projectId: input.projectId,
    folderId: input.folderId ?? null,
    type: input.type,
    title: input.title,
    content: body,
  });
  return toAgentPage(p);
}

// ── Updating a page body ────────────────────────────────────────────────────

const norm = (s: string) => s.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The blocks under a heading, up to the next heading of the same or a higher level. */
function sectionRange(blocks: Block[], heading: string): { start: number; end: number; level: number } | null {
  const want = norm(heading);
  const at = blocks.findIndex((b) => b.type === 'heading' && norm(plainText(Array.isArray(b.content) ? b.content : undefined)) === want);
  if (at < 0) return null;
  const level = Number(blocks[at]!.props?.level) || 1;
  let end = at + 1;
  while (end < blocks.length && !(blocks[end]!.type === 'heading' && (Number(blocks[end]!.props?.level) || 1) <= level)) end++;
  return { start: at, end, level };
}

function editDoc(current: Block[], mode: UpdateMode, md: string, heading?: string): Block[] {
  const incoming = markdownToBlocks(md) as Block[];
  if (mode === 'replace') return incoming;
  if (mode === 'append') return [...current.filter((b) => !(b.type === 'paragraph' && !plainText(b.content as never) && !b.children?.length)), ...incoming];
  if (!heading) throw new ServiceError('invalid', 'replace_section needs a heading');
  const r = sectionRange(current, heading);
  if (!r) throw new ServiceError('invalid', `No heading “${heading}” on this page`);
  // If the new Markdown starts with that same heading, it replaces the heading too.
  const first = incoming[0];
  const keepsHeading = !(first?.type === 'heading' && norm(plainText(first.content as never)) === norm(heading));
  return [...current.slice(0, keepsHeading ? r.start + 1 : r.start), ...incoming, ...current.slice(r.end)];
}

function findByText(n: MindNode, want: string): MindNode | null {
  if (norm(n.text) === want) return n;
  for (const c of n.children) {
    const hit = findByText(c, want);
    if (hit) return hit;
  }
  return null;
}

function editMindmap(current: MindmapContent, mode: UpdateMode, md: string, heading?: string, title = ''): MindmapContent {
  const parsed = outlineToMindmap(md, current.root.text || title, current.layout);
  if (mode === 'replace') return parsed;
  // A single top item becomes one branch; several stay separate branches.
  const branches = parsed.root.text === (current.root.text || title) && parsed.root.children.length ? parsed.root.children : [parsed.root];
  if (mode === 'replace_section') {
    if (!heading) throw new ServiceError('invalid', 'replace_section needs the text of an idea');
    const hit = findByText(current.root, norm(heading));
    if (!hit) throw new ServiceError('invalid', `No idea “${heading}” in this mindmap`);
    let root = current.root;
    const cleared = { ...hit, children: [] as MindNode[] };
    const swap = (n: MindNode): MindNode => (n.id === hit.id ? cleared : { ...n, children: n.children.map(swap) });
    root = swap(root);
    const inner = parsed.root.children.length && norm(parsed.root.text) === norm(hit.text) ? parsed.root.children : branches;
    for (const b of inner) root = insertNode(root, hit.id, b);
    return { ...current, root };
  }
  let root = current.root;
  for (const b of branches) root = insertNode(root, current.root.id, b);
  return { ...current, root };
}

export async function updatePage(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof updatePageArgs>): Promise<AgentPage> {
  if (input.title === undefined && input.markdown === undefined) throw new ServiceError('invalid', 'Send a title, markdown or both');
  if (input.title !== undefined) await content.updatePageMeta(a, ctx, input.pageId, { title: input.title });
  if (input.markdown !== undefined) {
    // Read, edit, save with the rev we read; one retry if the page moved on meanwhile.
    for (let attempt = 0; ; attempt++) {
      const p = await content.getPage(a, ctx, input.pageId);
      let next: unknown;
      if (p.type === 'doc') next = editDoc((p.content as Block[] | null) ?? [], input.mode, input.markdown, input.heading);
      else if (p.type === 'mindmap')
        next = editMindmap((p.content as MindmapContent | null) ?? outlineToMindmap('', p.title), input.mode, input.markdown, input.heading, p.title);
      else throw new ServiceError('invalid', `A ${p.type} page can't be edited as Markdown. Docs and mindmaps can.`);
      try {
        await content.savePageContent(a, ctx, p.id, { rev: p.rev, content: next });
        break;
      } catch (e) {
        if (!(e instanceof ServiceError && e.code === 'conflict') || attempt > 0) throw e;
      }
    }
  }
  return readPage(a, ctx, input.pageId);
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export async function listTasks(a: DbAdapter, ctx: WsCtx, q: z.infer<typeof listTasksArgs>): Promise<Task[]> {
  const today = q.today ?? todayUtc();
  let rows: Task[];
  if (q.view) {
    rows = await tasks.listTasks(a, ctx, {
      view: q.view,
      today,
      projectId: q.view === 'project' ? q.projectId : undefined,
      includeDone: q.status === 'done' || q.status === 'any',
    });
  } else {
    await content.assertLiveWorkspace(a, ctx);
    if (q.projectId && q.projectId !== 'inbox') await content.liveProject(a, ctx, q.projectId);
    const found = await a.db
      .select()
      .from(task)
      .where(
        and(
          eq(task.workspaceId, ctx.workspaceId),
          isNull(task.deletedAt),
          q.projectId === 'inbox' ? isNull(task.projectId) : q.projectId ? eq(task.projectId, q.projectId) : undefined,
          q.status === 'open' ? ne(task.status, 'done') : q.status === 'any' ? undefined : eq(task.status, q.status),
          q.dueFrom ? gte(task.dueDate, q.dueFrom) : undefined,
          q.dueTo ? lte(task.dueDate, q.dueTo) : undefined,
        ),
      )
      .orderBy(asc(task.dueDate), asc(task.sort), asc(task.createdAt))
      .limit(q.limit);
    rows = found.map(tasks.taskDto);
  }
  return rows
    .filter((t) => (q.status === 'open' ? t.status !== 'done' : q.status === 'any' ? true : t.status === q.status))
    .filter((t) => (!q.dueFrom || (t.dueDate ?? '') >= q.dueFrom) && (!q.dueTo || (t.dueDate !== null && t.dueDate <= q.dueTo)))
    .slice(0, q.limit);
}

export async function updateTask(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof updateTaskArgs>): Promise<Task> {
  const { taskId, ...patch } = input;
  if (!Object.keys(patch).length) throw new ServiceError('invalid', 'Nothing to update');
  return tasks.updateTask(a, ctx, taskId, patch);
}

export async function completeTask(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof completeTaskArgs>): Promise<Task> {
  return tasks.completeTask(a, ctx, input.taskId, input.today ?? todayUtc());
}

// ── Organising ──────────────────────────────────────────────────────────────

export async function moveItem(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof moveItemArgs>): Promise<void> {
  await content.moveItem(a, ctx, input);
}

export async function pinItem(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof pinItemArgs>): Promise<void> {
  if (input.pinned === false) await pins.unpinItem(a, ctx, input.itemType, input.itemId);
  else await pins.pinItem(a, ctx, input.itemType, input.itemId);
}

/** Soft delete only: agents can never empty Trash or delete permanently. */
export async function trashItem(a: DbAdapter, ctx: WsCtx, input: z.infer<typeof trashItemArgs>): Promise<void> {
  await trash.trashItem(a, ctx, input.kind, input.id);
}
