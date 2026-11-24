import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm';
import type { Block } from '../../shared/blocks';
import { nowIso, uuidv7 } from '../../shared/ids';
import { addDays, formatRRule, nextOccurrence, parseRRule, RRuleError, weekday, type Rule } from '../../shared/recurrence';
import type { CreateTaskInput, Task, TaskCounts, TaskKind, TaskView, UpdateTaskInput } from '../../shared/schemas';
import { page, task, taskCompletion } from '../db/schema';
import type { DbAdapter } from '../db/types';
import { blocksToMarkdown } from '../md/blocks-to-md';
import { logChange } from './changelog';
import { assertLiveWorkspace, livePage, liveProject } from './content';
import { actorLabel, assertCanWrite, ServiceError, type WsCtx } from './context';
import { indexItem, unindex } from './search';

type TaskRow = typeof task.$inferSelect;

/** How long done tasks stay on the board's Done column. */
const BOARD_DONE_DAYS = 14;

export function taskDto(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.projectId,
    pageId: r.pageId,
    title: r.title,
    notesMd: r.notesMd,
    status: r.status,
    kind: r.kind,
    dueDate: r.dueDate,
    dueTime: r.dueTime,
    rrule: r.rrule,
    sort: r.sort,
    completedAt: r.completedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const kindOf = (rrule: string | null, dueDate: string | null): TaskKind => (rrule ? 'repeat' : dueDate ? 'dated' : 'once');

/**
 * Makes a rule independent of its anchor date: "monthly" becomes "monthly on
 * the 31st", "weekly" becomes "weekly on Tuesday". Completing a repeating task
 * moves its date forward, so the rule must not depend on the first date.
 */
export function normalizeRRule(rrule: string, dueDate: string): string {
  let rule: Rule;
  try {
    rule = parseRRule(rrule);
  } catch (e) {
    throw new ServiceError('invalid', e instanceof RRuleError ? `Repeat rule: ${e.message}` : 'Invalid repeat rule');
  }
  if (rule.freq === 'WEEKLY' && !rule.byDay?.length) rule.byDay = [{ day: weekday(dueDate) }];
  if (rule.freq === 'MONTHLY' && !rule.byDay?.length && !rule.byMonthDay?.length) rule.byMonthDay = [Number(dueDate.slice(8, 10))];
  return formatRRule(rule);
}

async function liveTask(a: DbAdapter, ctx: WsCtx, id: string): Promise<TaskRow> {
  const [row] = await a.db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.workspaceId, ctx.workspaceId), isNull(task.deletedAt)));
  if (!row) throw new ServiceError('not_found', 'Task not found');
  return row;
}

async function index(a: DbAdapter, t: TaskRow) {
  await indexItem(a, { kind: 'task', id: t.id, workspaceId: t.workspaceId, title: t.title, body: t.notesMd });
}

// ── Markdown for pages that hold task blocks (rule 6) ───────────────────────

function taskBlockIds(blocks: Block[], out: string[] = []): string[] {
  for (const b of blocks) {
    if (b.type === 'task' && typeof b.props?.taskId === 'string') out.push(b.props.taskId);
    if (b.children?.length) taskBlockIds(b.children, out);
  }
  return out;
}

/** Page Markdown with task blocks resolved to their live title and state. */
export async function pageMarkdown(a: DbAdapter, workspaceId: string, blocks: Block[] | null): Promise<string> {
  const ids = blocks ? [...new Set(taskBlockIds(blocks))] : [];
  if (!ids.length) return blocksToMarkdown(blocks);
  const rows = await a.db
    .select({ id: task.id, title: task.title, status: task.status })
    .from(task)
    .where(and(eq(task.workspaceId, workspaceId), inArray(task.id, ids), isNull(task.deletedAt)));
  return blocksToMarkdown(blocks, { tasks: new Map(rows.map((r) => [r.id, { title: r.title, done: r.status === 'done' }])) });
}

/** After a task changes, the page showing it as a block gets fresh Markdown (no new rev). */
async function refreshHostPage(a: DbAdapter, ctx: WsCtx, pageId: string | null) {
  if (!pageId) return;
  const [p] = await a.db
    .select()
    .from(page)
    .where(and(eq(page.id, pageId), eq(page.workspaceId, ctx.workspaceId), isNull(page.deletedAt)));
  if (!p?.contentJson) return;
  const contentMd = await pageMarkdown(a, ctx.workspaceId, JSON.parse(p.contentJson) as Block[]);
  if (contentMd === p.contentMd) return;
  await a.db.update(page).set({ contentMd }).where(and(eq(page.id, p.id), eq(page.workspaceId, ctx.workspaceId)));
  await indexItem(a, { kind: 'page', id: p.id, workspaceId: ctx.workspaceId, title: p.title, body: contentMd });
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getTask(a: DbAdapter, ctx: WsCtx, id: string): Promise<Task> {
  await assertLiveWorkspace(a, ctx);
  return taskDto(await liveTask(a, ctx, id));
}

/**
 * Inbox: no project. Today: due today or overdue. Upcoming: the next 14 days.
 * Project: one project. All: everything open. Done tasks are left out unless
 * `includeDone` (the board's Done column), which adds those done recently.
 */
export async function listTasks(
  a: DbAdapter,
  ctx: WsCtx,
  q: { view: TaskView; today: string; projectId?: string; includeDone?: boolean },
): Promise<Task[]> {
  await assertLiveWorkspace(a, ctx);
  const live = and(eq(task.workspaceId, ctx.workspaceId), isNull(task.deletedAt));
  const recentDone = and(eq(task.status, 'done'), gte(task.completedAt, `${addDays(q.today, -BOARD_DONE_DAYS)}T00:00:00`));
  const open = q.includeDone ? or(ne(task.status, 'done'), recentDone) : ne(task.status, 'done');

  let scope;
  switch (q.view) {
    case 'inbox':
      scope = isNull(task.projectId);
      break;
    case 'today':
      scope = and(isNotNull(task.dueDate), lte(task.dueDate, q.today));
      break;
    case 'upcoming':
      scope = and(gt(task.dueDate, q.today), lte(task.dueDate, addDays(q.today, 14)));
      break;
    case 'project':
      if (!q.projectId) throw new ServiceError('invalid', 'Pick a project');
      await liveProject(a, ctx, q.projectId);
      scope = eq(task.projectId, q.projectId);
      break;
    case 'all':
      scope = undefined;
      break;
  }
  const byDate = q.view === 'today' || q.view === 'upcoming';
  const rows = await a.db
    .select()
    .from(task)
    .where(and(live, open, scope))
    .orderBy(
      ...(byDate ? [asc(task.dueDate), sql`${task.dueTime} IS NULL`, asc(task.dueTime)] : []),
      asc(task.sort),
      asc(task.createdAt),
    )
    .limit(1000);
  return rows.map(taskDto);
}

export async function taskCounts(a: DbAdapter, ctx: WsCtx, today: string): Promise<TaskCounts> {
  await assertLiveWorkspace(a, ctx);
  const rows = await a.all(
    `SELECT
       SUM(CASE WHEN due_date IS NOT NULL AND due_date <= ? THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN project_id IS NULL THEN 1 ELSE 0 END) AS inbox
     FROM task WHERE workspace_id = ? AND deleted_at IS NULL AND status != 'done'`,
    [today, today, ctx.workspaceId],
  );
  const r = rows[0] ?? {};
  return { today: Number(r.today ?? 0), overdue: Number(r.overdue ?? 0), inbox: Number(r.inbox ?? 0) };
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function checkLinks(a: DbAdapter, ctx: WsCtx, projectId: string | null | undefined, pageId: string | null | undefined) {
  if (projectId) await liveProject(a, ctx, projectId);
  if (pageId) {
    const p = await livePage(a, ctx, pageId);
    if (projectId && p.projectId !== projectId) throw new ServiceError('invalid', 'That page is in another project');
  }
}

export async function createTask(a: DbAdapter, ctx: WsCtx, input: CreateTaskInput): Promise<Task> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  await checkLinks(a, ctx, input.projectId, input.pageId);
  const dueDate = input.dueDate ?? null;
  if (input.rrule && !dueDate) throw new ServiceError('invalid', 'A repeating task needs a start date');
  const rrule = input.rrule ? normalizeRRule(input.rrule, dueDate!) : null;
  const [last] = await a.db
    .select({ sort: max(task.sort) })
    .from(task)
    .where(and(eq(task.workspaceId, ctx.workspaceId), isNull(task.deletedAt)));
  const now = nowIso();
  const who = actorLabel(ctx.actor);
  const status = input.status ?? 'todo';
  const row: TaskRow = {
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    projectId: input.projectId ?? null,
    pageId: input.pageId ?? null,
    title: input.title,
    notesMd: input.notesMd ?? '',
    status,
    kind: kindOf(rrule, dueDate),
    dueDate,
    dueTime: input.dueTime ?? null,
    rrule,
    sort: (last?.sort ?? -1) + 1,
    completedAt: status === 'done' ? now : null,
    createdBy: who,
    updatedBy: who,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await a.db.insert(task).values(row);
  await index(a, row);
  await logChange(a.db, ctx, 'task', row.id, 'create');
  await refreshHostPage(a, ctx, row.pageId);
  return taskDto(row);
}

export async function updateTask(a: DbAdapter, ctx: WsCtx, id: string, input: UpdateTaskInput): Promise<Task> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const cur = await liveTask(a, ctx, id);
  await checkLinks(a, ctx, input.projectId, input.pageId);
  const next: TaskRow = { ...cur };
  if (input.title !== undefined) next.title = input.title;
  if (input.notesMd !== undefined) next.notesMd = input.notesMd;
  if (input.projectId !== undefined) next.projectId = input.projectId;
  if (input.pageId !== undefined) next.pageId = input.pageId;
  if (input.dueDate !== undefined) next.dueDate = input.dueDate;
  if (input.dueTime !== undefined) next.dueTime = input.dueTime;
  if (input.rrule !== undefined) next.rrule = input.rrule;
  if (!next.dueDate) next.dueTime = null;
  if (next.rrule) {
    if (!next.dueDate) throw new ServiceError('invalid', 'A repeating task needs a start date');
    next.rrule = normalizeRRule(next.rrule, next.dueDate);
  }
  if (input.status !== undefined && input.status !== cur.status) {
    next.status = input.status;
    next.completedAt = input.status === 'done' ? nowIso() : null;
  }
  next.kind = kindOf(next.rrule, next.dueDate);
  next.updatedAt = nowIso();
  next.updatedBy = actorLabel(ctx.actor);
  const { id: _id, workspaceId: _ws, createdAt: _c, createdBy: _cb, ...patch } = next;
  await a.db.update(task).set(patch).where(and(eq(task.id, id), eq(task.workspaceId, ctx.workspaceId)));
  await index(a, next);
  await logChange(a.db, ctx, 'task', id, 'update');
  await refreshHostPage(a, ctx, next.pageId);
  if (cur.pageId !== next.pageId) await refreshHostPage(a, ctx, cur.pageId);
  return taskDto(next);
}

/**
 * Completes a task. Once and dated tasks become done. A repeating task logs
 * the completion and moves to its next occurrence on or after `today`, so an
 * overdue daily task doesn't stay overdue; when the series has ended it's done.
 */
export async function completeTask(a: DbAdapter, ctx: WsCtx, id: string, today: string): Promise<Task> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const cur = await liveTask(a, ctx, id);
  if (cur.status === 'done') return taskDto(cur);
  const now = nowIso();
  await a.db.insert(taskCompletion).values({
    id: uuidv7(),
    taskId: id,
    workspaceId: ctx.workspaceId,
    occurrenceDate: cur.dueDate ?? today,
    completedAt: now,
  });

  const patch: Partial<TaskRow> = { updatedAt: now, updatedBy: actorLabel(ctx.actor) };
  let ended = true;
  if (cur.rrule && cur.dueDate) {
    const rule = parseRRule(cur.rrule);
    const remaining = rule.count ? rule.count - 1 : undefined;
    if (remaining !== 0) {
      const after = cur.dueDate >= today ? cur.dueDate : addDays(today, -1);
      const nextDate = nextOccurrence({ ...rule, count: undefined }, cur.dueDate, after);
      if (nextDate) {
        ended = false;
        patch.dueDate = nextDate;
        patch.status = 'todo';
        patch.completedAt = null;
        patch.rrule = formatRRule({ ...rule, count: remaining });
      }
    }
  }
  if (ended) {
    patch.status = 'done';
    patch.completedAt = now;
  }
  await a.db.update(task).set(patch).where(and(eq(task.id, id), eq(task.workspaceId, ctx.workspaceId)));
  await logChange(a.db, ctx, 'task', id, 'update');
  await refreshHostPage(a, ctx, cur.pageId);
  return taskDto({ ...cur, ...patch });
}

/** Undoes the last completion: reopens the task, or moves a repeating task back to that date. */
export async function uncompleteTask(a: DbAdapter, ctx: WsCtx, id: string): Promise<Task> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const cur = await liveTask(a, ctx, id);
  const [last] = await a.db
    .select()
    .from(taskCompletion)
    .where(and(eq(taskCompletion.taskId, id), eq(taskCompletion.workspaceId, ctx.workspaceId)))
    .orderBy(desc(taskCompletion.completedAt), desc(taskCompletion.id))
    .limit(1);
  const patch: Partial<TaskRow> = { status: 'todo', completedAt: null, updatedAt: nowIso(), updatedBy: actorLabel(ctx.actor) };
  if (cur.rrule && last) {
    patch.dueDate = last.occurrenceDate;
    const rule = parseRRule(cur.rrule);
    // Give back the occurrence that completing used up (a done series has its COUNT left as is).
    if (rule.count && cur.status !== 'done') patch.rrule = formatRRule({ ...rule, count: rule.count + 1 });
  }
  if (last) await a.db.delete(taskCompletion).where(eq(taskCompletion.id, last.id));
  await a.db.update(task).set(patch).where(and(eq(task.id, id), eq(task.workspaceId, ctx.workspaceId)));
  await logChange(a.db, ctx, 'task', id, 'update');
  await refreshHostPage(a, ctx, cur.pageId);
  return taskDto({ ...cur, ...patch });
}

/** Saves a manual order for the given tasks (one list or board column). */
export async function reorderTasks(a: DbAdapter, ctx: WsCtx, ids: string[]): Promise<void> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  const rows = await a.db
    .select({ id: task.id, sort: task.sort })
    .from(task)
    .where(and(eq(task.workspaceId, ctx.workspaceId), inArray(task.id, ids), isNull(task.deletedAt)));
  if (rows.length !== new Set(ids).size) throw new ServiceError('not_found', 'Task not found');
  // Reuse the positions these tasks already hold, so other lists keep their order.
  const slots = rows.map((r) => r.sort).sort((x, y) => x - y);
  for (const [i, tid] of ids.entries()) {
    await a.db.update(task).set({ sort: slots[i]! }).where(and(eq(task.id, tid), eq(task.workspaceId, ctx.workspaceId)));
  }
  await logChange(a.db, ctx, 'task', ids[0]!, 'move');
}

export async function unindexTasks(a: DbAdapter, ids: string[]) {
  await unindex(a, ids);
}

export { index as indexTask, refreshHostPage };
