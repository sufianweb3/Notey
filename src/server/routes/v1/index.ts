import { createRoute, OpenAPIHono, type RouteConfig } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  completeTaskArgs,
  createPageArgs,
  createTaskArgs,
  listTasksArgs,
  moveItemArgs,
  pinItemArgs,
  readPageArgs,
  searchArgs,
  trashItemArgs,
  updatePageArgs,
  updateTaskArgs,
} from '../../../shared/agent';
import { VERSION } from '../../../shared/version';
import type { AppEnv, Deps } from '../../hono-env';
import * as agent from '../../services/agent';
import type { WsCtx } from '../../services/context';
import { createTask } from '../../services/tasks';
import { getWorkspace } from '../../services/workspace';
import { validationHook } from '../api/errors';
import { publicOrigin, requireToken } from '../bearer';

/*
 * Public REST API (PRD 6.13) at /api/v1, bearer token only. The token is
 * bound to one workspace, so no path carries a workspace id. Operations and
 * inputs match the MCP tools; /api/v1/openapi.json is generated from them.
 */

const anyJson = { 'application/json': { schema: z.unknown() } };
const ok = (description: string) => ({ 200: { description, content: anyJson } });
const errors = {
  400: { description: 'Invalid input', content: anyJson },
  401: { description: 'Missing, invalid or revoked token', content: anyJson },
  403: { description: 'Read-only token', content: anyJson },
  404: { description: 'Not found in this workspace', content: anyJson },
  429: { description: 'Rate limited (60 requests per minute per token)', content: anyJson },
};
const security = [{ bearer: [] }];
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const idParam = z.object({ id: z.string().min(1).max(64) });

const responses = { ...ok('OK'), ...errors };
function route<R extends Omit<RouteConfig, 'responses'>>(r: R) {
  return createRoute({ ...r, security, responses } as R & { responses: typeof responses });
}

/** Query strings arrive as text: coerce the numeric ones. */
const searchQuery = searchArgs.extend({ limit: z.coerce.number().int().min(1).max(50).optional() });
const tasksQuery = listTasksArgs.extend({ limit: z.coerce.number().int().min(1).max(500).default(100) });

export function v1Routes(deps: Deps) {
  const a = deps.adapter;
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook as never });
  const ctx = (c: Context<AppEnv>): WsCtx => {
    const actor = c.get('actor');
    if (actor.kind !== 'agent') throw new Error('v1 needs a token');
    return { workspaceId: actor.workspaceId, actor };
  };

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'A workspace token from Settings > AI access (ntk_…), or an OAuth access token.',
  });

  // The spec is public: it describes the API, not anything in it.
  app.get('/openapi.json', (c) =>
    c.json(
      app.getOpenAPI31Document({
        openapi: '3.1.0',
        info: { title: 'Notey API', version: VERSION, description: 'Everything is scoped to the workspace the token belongs to.' },
        servers: [{ url: `${publicOrigin(c, deps)}/api/v1` }],
      }),
    ),
  );

  app.use('*', requireToken(deps));

  app.openapi(route({ method: 'get', path: '/workspace', summary: 'The token’s workspace and scope', tags: ['Workspace'] }), async (c) => {
    const actor = c.get('actor');
    const w = await getWorkspace(deps.db, ctx(c));
    return c.json({ workspace: { id: w.id, name: w.name }, token: { name: actor.name, scope: actor.kind === 'agent' ? actor.scope : 'write' } }, 200);
  });

  app.openapi(route({ method: 'get', path: '/tree', summary: 'Projects, folders and pages', tags: ['Pages'] }), async (c) =>
    c.json(await agent.tree(a, ctx(c)), 200),
  );

  app.openapi(route({ method: 'get', path: '/search', summary: 'Full-text search across pages and tasks', tags: ['Pages'], request: { query: searchQuery } }), async (c) =>
    c.json({ results: await agent.search(a, ctx(c), c.req.valid('query')) }, 200),
  );

  app.openapi(
    route({ method: 'get', path: '/pages/{id}', summary: 'A page as Markdown (doc), outline (mindmap) or element summary (canvas)', tags: ['Pages'], request: { params: idParam } }),
    async (c) => c.json({ page: await agent.readPage(a, ctx(c), readPageArgs.parse({ pageId: c.req.valid('param').id }).pageId) }, 200),
  );

  app.openapi(route({ method: 'post', path: '/pages', summary: 'Create a page', tags: ['Pages'], request: body(createPageArgs) }), async (c) =>
    c.json({ page: await agent.createPage(a, ctx(c), c.req.valid('json')) }, 200),
  );

  app.openapi(
    route({
      method: 'patch',
      path: '/pages/{id}',
      summary: 'Rename, replace, append, or replace one section',
      tags: ['Pages'],
      request: { params: idParam, ...body(updatePageArgs.omit({ pageId: true })) },
    }),
    async (c) => c.json({ page: await agent.updatePage(a, ctx(c), { ...c.req.valid('json'), pageId: c.req.valid('param').id }) }, 200),
  );

  app.openapi(route({ method: 'get', path: '/tasks', summary: 'List tasks', tags: ['Tasks'], request: { query: tasksQuery } }), async (c) =>
    c.json({ tasks: await agent.listTasks(a, ctx(c), c.req.valid('query')) }, 200),
  );

  app.openapi(route({ method: 'post', path: '/tasks', summary: 'Create a task', tags: ['Tasks'], request: body(createTaskArgs) }), async (c) => {
    return c.json({ task: await createTask(a, ctx(c), c.req.valid('json')) }, 200);
  });

  app.openapi(
    route({ method: 'patch', path: '/tasks/{id}', summary: 'Update a task', tags: ['Tasks'], request: { params: idParam, ...body(updateTaskArgs.omit({ taskId: true })) } }),
    async (c) => c.json({ task: await agent.updateTask(a, ctx(c), { ...c.req.valid('json'), taskId: c.req.valid('param').id }) }, 200),
  );

  app.openapi(
    route({
      method: 'post',
      path: '/tasks/{id}/complete',
      summary: 'Complete a task (a repeating one moves to its next date)',
      tags: ['Tasks'],
      request: { params: idParam, body: { content: { 'application/json': { schema: completeTaskArgs.omit({ taskId: true }) } }, required: false } },
    }),
    async (c) => {
      const raw = await c.req.json().catch(() => ({}));
      const { today } = completeTaskArgs.omit({ taskId: true }).parse(raw ?? {});
      return c.json({ task: await agent.completeTask(a, ctx(c), { taskId: c.req.valid('param').id, today }) }, 200);
    },
  );

  app.openapi(route({ method: 'post', path: '/move', summary: 'Move a page or folder', tags: ['Organise'], request: body(moveItemArgs) }), async (c) => {
    await agent.moveItem(a, ctx(c), c.req.valid('json'));
    return c.json({ ok: true }, 200);
  });

  app.openapi(route({ method: 'post', path: '/pins', summary: 'Pin or unpin an item', tags: ['Organise'], request: body(pinItemArgs) }), async (c) => {
    await agent.pinItem(a, ctx(c), c.req.valid('json'));
    return c.json({ ok: true }, 200);
  });

  app.openapi(route({ method: 'post', path: '/trash', summary: 'Move an item to Trash (never a permanent delete)', tags: ['Organise'], request: body(trashItemArgs) }), async (c) => {
    await agent.trashItem(a, ctx(c), c.req.valid('json'));
    return c.json({ ok: true }, 200);
  });

  return app;
}
