/** Workspace isolation for M2 task and pin endpoints (CLAUDE.md rule 2). */
import { describe, expect, it } from 'vitest';
import * as tasks from '../../src/server/services/tasks';
import * as pins from '../../src/server/services/pins';
import { createWorkspace } from '../../src/server/services/workspace';
import { agent, makeApp, makeDb, owner, setupOwner } from '../helpers';

const TODAY = '2026-11-24';

async function twoWorkspaces() {
  const { app } = await makeApp();
  const { c, workspace: a } = await setupOwner(app);
  const b = (await c.post('/api/workspaces', { name: 'Client B' })).json.workspace as { id: string };
  const A = `/api/workspaces/${a.id}`;
  const B = `/api/workspaces/${b.id}`;
  const projA = (await c.post(`${A}/projects`, { name: 'A site' })).json.project;
  const projB = (await c.post(`${B}/projects`, { name: 'B project' })).json.project;
  const pageB = (await c.post(`${B}/pages`, { projectId: projB.id, type: 'doc', title: 'B plan' })).json.page;
  const taskB = (await c.post(`${B}/tasks`, { title: 'B secret task', dueDate: TODAY, projectId: projB.id })).json.task;
  const pinB = (await c.post(`${B}/pins`, { itemType: 'task', itemId: taskB.id })).json;
  return { c, A, B, projA, projB, pageB, taskB, pinB };
}

describe('HTTP: task and pin ids from another workspace never resolve', () => {
  it('returns 404 for every A-scoped call that names a B item', async () => {
    const { c, A, projA, projB, pageB, taskB, pinB } = await twoWorkspaces();
    const calls: [string, () => Promise<{ status: number }>][] = [
      ['GET task', () => c.get(`${A}/tasks/${taskB.id}`)],
      ['PATCH task', () => c.patch(`${A}/tasks/${taskB.id}`, { title: 'pwned' })],
      ['complete task', () => c.post(`${A}/tasks/${taskB.id}/complete`, { today: TODAY })],
      ['uncomplete task', () => c.post(`${A}/tasks/${taskB.id}/uncomplete`)],
      ['reorder with B task', () => c.post(`${A}/tasks/reorder`, { ids: [taskB.id] })],
      ['create task in B project', () => c.post(`${A}/tasks`, { title: 'x', projectId: projB.id })],
      ['create task on B page', () => c.post(`${A}/tasks`, { title: 'x', projectId: projA.id, pageId: pageB.id })],
      ['move A task into B project', async () => {
        const t = (await c.post(`${A}/tasks`, { title: 'mine' })).json.task;
        return c.patch(`${A}/tasks/${t.id}`, { projectId: projB.id });
      }],
      ['project view of B project', () => c.get(`${A}/tasks?view=project&projectId=${projB.id}&today=${TODAY}`)],
      ['pin B task', () => c.post(`${A}/pins`, { itemType: 'task', itemId: taskB.id })],
      ['pin B page', () => c.post(`${A}/pins`, { itemType: 'page', itemId: pageB.id })],
      ['reorder B pin', () => c.post(`${A}/pins/reorder`, { ids: [pinB.id] })],
      ['trash B task', () => c.post(`${A}/trash`, { kind: 'task', id: taskB.id })],
    ];
    for (const [name, call] of calls) expect.soft((await call()).status, name).toBe(404);
  });

  it('views, counts, pins and search stay inside one workspace', async () => {
    const { c, A, B, taskB } = await twoWorkspaces();
    for (const view of ['inbox', 'today', 'upcoming', 'all']) {
      expect((await c.get(`${A}/tasks?view=${view}&today=${TODAY}`)).json.tasks, view).toEqual([]);
    }
    expect((await c.get(`${A}/tasks/counts?today=${TODAY}`)).json).toEqual({ today: 0, overdue: 0, inbox: 0 });
    expect((await c.get(`${A}/pins`)).json.pins).toEqual([]);
    expect((await c.get(`${A}/search?q=secret`)).json.results).toEqual([]);
    expect((await c.get(`${B}/search?q=secret`)).json.results.map((r: { id: string }) => r.id)).toEqual([taskB.id]);
    // B's task is untouched by any of the attempts above.
    expect((await c.get(`${B}/tasks/${taskB.id}`)).json.task).toMatchObject({ title: 'B secret task', status: 'todo' });
  });
});

describe('service: agents', () => {
  it('an agent bound to A cannot see or touch B tasks and pins; a read token cannot write', async () => {
    const a = await makeDb();
    const wsA = await createWorkspace(a.db, { actor: owner() }, { name: 'A' });
    const wsB = await createWorkspace(a.db, { actor: owner() }, { name: 'B' });
    const ownerB = { workspaceId: wsB.id, actor: owner() };
    const t = await tasks.createTask(a, ownerB, { title: 'B task' });

    const botInB = { workspaceId: wsB.id, actor: agent(wsA.id) };
    await expect(tasks.listTasks(a, botInB, { view: 'all', today: TODAY })).rejects.toMatchObject({ code: 'not_found' });
    await expect(tasks.completeTask(a, botInB, t.id, TODAY)).rejects.toMatchObject({ code: 'not_found' });
    await expect(pins.listPins(a, botInB)).rejects.toMatchObject({ code: 'not_found' });

    const botInA = { workspaceId: wsA.id, actor: agent(wsA.id) };
    await expect(tasks.getTask(a, botInA, t.id)).rejects.toMatchObject({ code: 'not_found' });

    const reader = { workspaceId: wsA.id, actor: agent(wsA.id, 'read') };
    await expect(tasks.createTask(a, reader, { title: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    const mine = await tasks.createTask(a, { workspaceId: wsA.id, actor: owner() }, { title: 'A task' });
    await expect(tasks.completeTask(a, reader, mine.id, TODAY)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(pins.pinItem(a, reader, 'task', mine.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
