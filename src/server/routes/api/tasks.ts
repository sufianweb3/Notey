import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  completeTaskInput,
  createTaskInput,
  pinInput,
  reorderInput,
  taskListQuery,
  updateTaskInput,
} from '../../../shared/schemas';
import type { AppEnv, Deps } from '../../hono-env';
import type { WsCtx } from '../../services/context';
import * as pins from '../../services/pins';
import * as tasks from '../../services/tasks';
import { validationHook } from './errors';

/** Tasks and pins inside one workspace: /api/workspaces/:wsId/{tasks,pins}. */
export function taskRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const a = deps.adapter;
  const ctx = (c: Context<AppEnv>): WsCtx => ({ workspaceId: c.req.param('wsId')!, actor: c.get('actor') });
  const json = <S extends Parameters<typeof zValidator>[1]>(schema: S) => zValidator('json', schema, validationHook);

  r.get('/tasks', zValidator('query', taskListQuery, validationHook), async (c) => {
    const q = c.req.valid('query');
    return c.json({ tasks: await tasks.listTasks(a, ctx(c), { ...q, includeDone: q.includeDone === '1' }) });
  });
  r.get('/tasks/counts', zValidator('query', z.object({ today: completeTaskInput.shape.today }), validationHook), async (c) =>
    c.json(await tasks.taskCounts(a, ctx(c), c.req.valid('query').today)),
  );
  r.post('/tasks', json(createTaskInput), async (c) => c.json({ task: await tasks.createTask(a, ctx(c), c.req.valid('json')) }, 201));
  r.post('/tasks/reorder', json(reorderInput), async (c) => {
    await tasks.reorderTasks(a, ctx(c), c.req.valid('json').ids);
    return c.json({ ok: true });
  });
  r.get('/tasks/:id', async (c) => c.json({ task: await tasks.getTask(a, ctx(c), c.req.param('id')) }));
  r.patch('/tasks/:id', json(updateTaskInput), async (c) =>
    c.json({ task: await tasks.updateTask(a, ctx(c), c.req.param('id'), c.req.valid('json')) }),
  );
  r.post('/tasks/:id/complete', json(completeTaskInput), async (c) =>
    c.json({ task: await tasks.completeTask(a, ctx(c), c.req.param('id'), c.req.valid('json').today) }),
  );
  r.post('/tasks/:id/uncomplete', async (c) => c.json({ task: await tasks.uncompleteTask(a, ctx(c), c.req.param('id')) }));

  r.get('/pins', async (c) => c.json({ pins: await pins.listPins(a, ctx(c)) }));
  r.post('/pins', json(pinInput), async (c) => {
    const { itemType, itemId } = c.req.valid('json');
    return c.json(await pins.pinItem(a, ctx(c), itemType, itemId), 201);
  });
  r.post('/pins/remove', json(pinInput), async (c) => {
    const { itemType, itemId } = c.req.valid('json');
    await pins.unpinItem(a, ctx(c), itemType, itemId);
    return c.json({ ok: true });
  });
  r.post('/pins/reorder', json(reorderInput), async (c) => {
    await pins.reorderPins(a, ctx(c), c.req.valid('json').ids);
    return c.json({ ok: true });
  });

  return r;
}
