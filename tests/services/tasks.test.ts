import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/shared/blocks';
import * as content from '../../src/server/services/content';
import * as pins from '../../src/server/services/pins';
import { searchPages } from '../../src/server/services/search';
import * as tasks from '../../src/server/services/tasks';
import * as trash from '../../src/server/services/trash';
import { createWorkspace } from '../../src/server/services/workspace';
import { makeDb, owner } from '../helpers';

const TODAY = '2026-11-24'; // a Tuesday

async function setup() {
  const a = await makeDb();
  const ws = await createWorkspace(a.db, { actor: owner() }, { name: 'Fevgo' });
  const ctx = { workspaceId: ws.id, actor: owner() };
  const proj = await content.createProject(a, ctx, { name: 'Website' });
  return { a, ctx, proj };
}

const titles = (list: { title: string }[]) => list.map((t) => t.title);

describe('task views', () => {
  it('sorts tasks into Inbox, Today, Upcoming and project views', async () => {
    const { a, ctx, proj } = await setup();
    await tasks.createTask(a, ctx, { title: 'Inbox idea' });
    await tasks.createTask(a, ctx, { title: 'Overdue invoice', dueDate: '2026-11-20' });
    await tasks.createTask(a, ctx, { title: 'Call Rafi', dueDate: TODAY, dueTime: '15:00', projectId: proj.id });
    await tasks.createTask(a, ctx, { title: 'Morning check', dueDate: TODAY, dueTime: '09:00' });
    await tasks.createTask(a, ctx, { title: 'Next week', dueDate: '2026-12-01' });
    await tasks.createTask(a, ctx, { title: 'Far away', dueDate: '2027-03-01' });

    const view = (v: 'inbox' | 'today' | 'upcoming' | 'project' | 'all', projectId?: string) =>
      tasks.listTasks(a, ctx, { view: v, today: TODAY, projectId });
    expect(titles(await view('inbox'))).toEqual(['Inbox idea', 'Overdue invoice', 'Morning check', 'Next week', 'Far away']);
    expect(titles(await view('today'))).toEqual(['Overdue invoice', 'Morning check', 'Call Rafi']);
    expect(titles(await view('upcoming'))).toEqual(['Next week']);
    expect(titles(await view('project', proj.id))).toEqual(['Call Rafi']);
    expect((await tasks.taskCounts(a, ctx, TODAY))).toEqual({ today: 3, overdue: 1, inbox: 5 });
  });

  it('derives the kind and validates repeat rules', async () => {
    const { a, ctx } = await setup();
    expect((await tasks.createTask(a, ctx, { title: 'A' })).kind).toBe('once');
    expect((await tasks.createTask(a, ctx, { title: 'B', dueDate: TODAY })).kind).toBe('dated');
    const r = await tasks.createTask(a, ctx, { title: 'C', dueDate: TODAY, rrule: 'FREQ=WEEKLY' });
    expect(r).toMatchObject({ kind: 'repeat', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    await expect(tasks.createTask(a, ctx, { title: 'D', rrule: 'FREQ=DAILY' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(tasks.createTask(a, ctx, { title: 'E', dueDate: TODAY, rrule: 'FREQ=HOURLY' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('completing', () => {
  it('a one-off task is done, and undo reopens it', async () => {
    const { a, ctx } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Renew domain', dueDate: TODAY });
    const done = await tasks.completeTask(a, ctx, t.id, TODAY);
    expect(done.status).toBe('done');
    expect(titles(await tasks.listTasks(a, ctx, { view: 'today', today: TODAY }))).toEqual([]);
    expect(titles(await tasks.listTasks(a, ctx, { view: 'all', today: TODAY, includeDone: true }))).toEqual(['Renew domain']);
    expect((await tasks.uncompleteTask(a, ctx, t.id)).status).toBe('todo');
  });

  it('a repeating task logs the completion and rolls to the next date', async () => {
    const { a, ctx } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Standup', dueDate: TODAY, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const next = await tasks.completeTask(a, ctx, t.id, TODAY);
    expect(next).toMatchObject({ status: 'todo', dueDate: '2026-11-25' });
    const undone = await tasks.uncompleteTask(a, ctx, t.id);
    expect(undone.dueDate).toBe(TODAY);
  });

  it('an overdue repeating task rolls to today or later, not to another past date', async () => {
    const { a, ctx } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Review logs', dueDate: '2026-11-10', rrule: 'FREQ=DAILY' });
    expect((await tasks.completeTask(a, ctx, t.id, TODAY)).dueDate).toBe(TODAY);
    const w = await tasks.createTask(a, ctx, { title: 'Weekly report', dueDate: '2026-11-02', rrule: 'FREQ=WEEKLY' });
    expect((await tasks.completeTask(a, ctx, w.id, TODAY)).dueDate).toBe('2026-11-30');
  });

  it('COUNT runs down and the series ends as done', async () => {
    const { a, ctx } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Physio', dueDate: TODAY, rrule: 'FREQ=DAILY;COUNT=2' });
    const one = await tasks.completeTask(a, ctx, t.id, TODAY);
    expect(one).toMatchObject({ status: 'todo', dueDate: '2026-11-25', rrule: 'FREQ=DAILY;COUNT=1' });
    expect((await tasks.completeTask(a, ctx, t.id, '2026-11-25')).status).toBe('done');
  });

  it('monthly on the 31st keeps the 31st after a short month', async () => {
    const { a, ctx } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Close books', dueDate: '2027-01-31', rrule: 'FREQ=MONTHLY' });
    const feb = await tasks.completeTask(a, ctx, t.id, '2027-01-31');
    expect(feb.dueDate).toBe('2027-02-28');
    expect((await tasks.completeTask(a, ctx, t.id, '2027-02-28')).dueDate).toBe('2027-03-31');
  });
});

describe('task blocks keep page Markdown in sync (rule 6)', () => {
  it('writes the live task into content_md and refreshes it when the task changes', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Launch' });
    const t = await tasks.createTask(a, ctx, { title: 'Draft copy', projectId: proj.id, pageId: p.id });
    const blocks: Block[] = [{ type: 'paragraph', content: [{ type: 'text', text: 'Todo:', styles: {} }] }, { type: 'task', props: { taskId: t.id } }];
    const saved = await content.savePageContent(a, ctx, p.id, { rev: 0, content: blocks });
    expect(saved.contentMd).toBe('Todo:\n\n- [ ] Draft copy\n');

    await tasks.updateTask(a, ctx, t.id, { title: 'Draft homepage copy' });
    expect((await content.getPage(a, ctx, p.id)).contentMd).toBe('Todo:\n\n- [ ] Draft homepage copy\n');
    await tasks.completeTask(a, ctx, t.id, TODAY);
    expect((await content.getPage(a, ctx, p.id)).contentMd).toBe('Todo:\n\n- [x] Draft homepage copy\n');
    expect((await content.getPage(a, ctx, p.id)).rev).toBe(1); // derived Markdown, not a new revision
  });

  it('refuses a page from another project', async () => {
    const { a, ctx, proj } = await setup();
    const other = await content.createProject(a, ctx, { name: 'Brand' });
    const p = await content.createPage(a, ctx, { projectId: other.id, type: 'doc', title: 'X' });
    await expect(tasks.createTask(a, ctx, { title: 'T', projectId: proj.id, pageId: p.id })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('tasks in trash and search', () => {
  it('a project takes its tasks to trash and brings them back', async () => {
    const { a, ctx, proj } = await setup();
    await tasks.createTask(a, ctx, { title: 'Ship hero', projectId: proj.id });
    await trash.trashItem(a, ctx, 'project', proj.id);
    expect(await tasks.listTasks(a, ctx, { view: 'all', today: TODAY })).toEqual([]);
    expect((await trash.listTrash(a, ctx)).map((i) => [i.kind, i.contains])).toEqual([['project', 1]]);
    await trash.restoreItem(a, ctx, 'project', proj.id);
    expect(titles(await tasks.listTasks(a, ctx, { view: 'all', today: TODAY }))).toEqual(['Ship hero']);
  });

  it('a task whose project is gone comes back to the Inbox', async () => {
    const { a, ctx, proj } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Orphan', projectId: proj.id });
    await trash.trashItem(a, ctx, 'task', t.id);
    await new Promise((r) => setTimeout(r, 5));
    await trash.trashItem(a, ctx, 'project', proj.id);
    expect((await trash.listTrash(a, ctx)).map((i) => i.kind).sort()).toEqual(['project', 'task']);
    await trash.restoreItem(a, ctx, 'task', t.id);
    expect(titles(await tasks.listTasks(a, ctx, { view: 'inbox', today: TODAY }))).toEqual(['Orphan']);
  });

  it('search finds tasks by title and notes, and drops trashed ones', async () => {
    const { a, ctx } = await setup();
    const t = await tasks.createTask(a, ctx, { title: 'Invoice CRG Attire', notesMd: 'Include the quokka shoot' });
    expect((await searchPages(a, ctx, 'invoic')).map((h) => [h.kind, h.id])).toEqual([['task', t.id]]);
    expect((await searchPages(a, ctx, 'quokka'))[0]).toMatchObject({ kind: 'task', status: 'todo', projectId: null });
    await trash.trashItem(a, ctx, 'task', t.id);
    expect(await searchPages(a, ctx, 'invoice')).toEqual([]);
  });
});

describe('pins', () => {
  it('pins once, lists in order with details, reorders, unpins', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    const t = await tasks.createTask(a, ctx, { title: 'Call Rafi', projectId: proj.id });
    await tasks.createTask(a, ctx, { title: 'Done one', projectId: proj.id, status: 'done' });
    const p1 = await pins.pinItem(a, ctx, 'page', p.id);
    expect(await pins.pinItem(a, ctx, 'page', p.id)).toEqual(p1);
    const p2 = await pins.pinItem(a, ctx, 'task', t.id);
    const p3 = await pins.pinItem(a, ctx, 'project', proj.id);
    let list = await pins.listPins(a, ctx);
    expect(list.map((x) => [x.itemType, x.title])).toEqual([['page', 'Brief'], ['task', 'Call Rafi'], ['project', 'Website']]);
    expect(list[2]!.progress).toEqual({ done: 1, total: 2 });
    await pins.reorderPins(a, ctx, [p3.id, p1.id]);
    list = await pins.listPins(a, ctx);
    expect(list.map((x) => x.id)).toEqual([p3.id, p1.id, p2.id]);
    await pins.unpinItem(a, ctx, 'task', t.id);
    expect((await pins.listPins(a, ctx)).map((x) => x.itemType)).toEqual(['project', 'page']);
  });

  it('survives rename and move, hides while in trash, goes when deleted forever', async () => {
    const { a, ctx, proj } = await setup();
    const other = await content.createProject(a, ctx, { name: 'Brand' });
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    await pins.pinItem(a, ctx, 'page', p.id);
    await content.updatePageMeta(a, ctx, p.id, { title: 'Homepage brief' });
    await content.moveItem(a, ctx, { kind: 'page', id: p.id, projectId: other.id, parentId: null });
    expect((await pins.listPins(a, ctx)).map((x) => [x.title, x.projectId])).toEqual([['Homepage brief', other.id]]);
    await trash.trashItem(a, ctx, 'page', p.id);
    expect(await pins.listPins(a, ctx)).toEqual([]);
    await trash.restoreItem(a, ctx, 'page', p.id);
    expect(await pins.listPins(a, ctx)).toHaveLength(1);
    await trash.trashItem(a, ctx, 'page', p.id);
    await trash.deleteForever(a, ctx, 'page', p.id);
    await expect(pins.pinItem(a, ctx, 'page', p.id)).rejects.toMatchObject({ code: 'not_found' });
    const rows = await a.all('SELECT COUNT(*) AS n FROM pin');
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
