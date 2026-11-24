import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { Hono } from 'hono';
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
} from '../../shared/agent';
import { VERSION } from '../../shared/version';
import type { AppEnv, Deps } from '../hono-env';
import * as agent from '../services/agent';
import { ServiceError, type Actor, type WsCtx } from '../services/context';
import { createTask } from '../services/tasks';
import { getWorkspace } from '../services/workspace';
import { requireToken } from './bearer';

/*
 * MCP over Streamable HTTP (PRD 6.13), stateless: each POST builds a server
 * for the token's workspace, answers, and is done. Works the same on
 * Workers, Vercel and Node. Write tools are listed only for write tokens.
 */

type AgentActor = Extract<Actor, { kind: 'agent' }>;
type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (s: string): Text => ({ content: [{ type: 'text', text: s }] });
const json = (v: unknown): Text => text(JSON.stringify(v, null, 2));

/** Service errors become tool errors the model can read and act on. */
async function run(fn: () => Promise<Text>): Promise<Text> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ServiceError) return { ...text(e.message), isError: true };
    console.error(e);
    return { ...text('Something went wrong on the server. Try again.'), isError: true };
  }
}

export function buildMcpServer(deps: Deps, actor: AgentActor, workspaceName: string) {
  const a = deps.adapter;
  const ctx: WsCtx = { workspaceId: actor.workspaceId, actor };
  const server = new McpServer(
    { name: 'notey', title: `Notey: ${workspaceName}`, version: VERSION },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        `You are connected to the Notey workspace "${workspaceName}" with ${actor.scope === 'write' ? 'read and write' : 'read-only'} access. ` +
        'Start with get_workspace_tree or search to find ids. Pages read and write as Markdown; mindmaps as an outline (# Central idea, then nested - bullets). ' +
        'Every write is saved in page history and can be undone by the owner. Nothing can be deleted permanently.',
    },
  );

  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const tool = <S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    annotations: typeof read | typeof write,
    fn: (args: z.infer<S>) => Promise<Text>,
  ) =>
    server.registerTool(name, { description, inputSchema: schema.shape, annotations }, ((args: z.infer<S>) => run(() => fn(args))) as never);

  // ── Read ──────────────────────────────────────────────────────────────────
  tool('get_workspace_tree', 'Projects, folders and pages in this workspace, with ids, titles and page types.', z.object({}), read, async () => {
    const t = await agent.tree(a, ctx);
    return json({
      projects: t.projects.map((p) => ({ id: p.id, name: p.name })),
      folders: t.folders.map((f) => ({ id: f.id, name: f.name, projectId: f.projectId, parentId: f.parentId })),
      pages: t.pages.map((p) => ({ id: p.id, title: p.title || 'Untitled', type: p.type, projectId: p.projectId, folderId: p.folderId, updatedAt: p.updatedAt })),
    });
  });
  tool('search', 'Full-text search across page titles, page text and task titles.', searchArgs, read, async (q) => json(await agent.search(a, ctx, q)));
  tool(
    'read_page',
    'A page as Markdown (doc), as an outline (mindmap) or as a list of its elements (canvas).',
    readPageArgs,
    read,
    async ({ pageId }) => {
      const p = await agent.readPage(a, ctx, pageId);
      return text(`---\nid: ${p.id}\ntitle: ${p.title || 'Untitled'}\ntype: ${p.type}\nupdated: ${p.updatedAt} by ${p.updatedBy}\n---\n\n${p.markdown}`);
    },
  );
  tool('list_tasks', 'Tasks by view (inbox, today, upcoming, project, all), or filtered by project, status and due dates.', listTasksArgs, read, async (q) =>
    json(await agent.listTasks(a, ctx, q)),
  );

  if (actor.scope !== 'write') return server;

  // ── Write ─────────────────────────────────────────────────────────────────
  tool('create_page', 'Create a doc (from Markdown), a mindmap (from an outline) or an empty canvas.', createPageArgs, write, async (input) =>
    json(await agent.createPage(a, ctx, input)),
  );
  tool(
    'update_page',
    'Rename a page or change its body: replace it, append to it, or replace one section by heading (docs) or one idea’s branch (mindmaps). The previous version stays in history.',
    updatePageArgs,
    write,
    async (input) => json(await agent.updatePage(a, ctx, input)),
  );
  tool('create_task', 'Create a task. Leave projectId out for the Inbox. rrule repeats it, e.g. FREQ=WEEKLY;BYDAY=MO.', createTaskArgs, write, async (input) =>
    json(await createTask(a, ctx, input)),
  );
  tool('update_task', 'Change a task’s title, notes, status, due date, time, repeat or project.', updateTaskArgs, write, async (input) =>
    json(await agent.updateTask(a, ctx, input)),
  );
  tool('complete_task', 'Complete a task. A repeating task moves to its next date instead.', completeTaskArgs, write, async (input) =>
    json(await agent.completeTask(a, ctx, input)),
  );
  tool('move_item', 'Move a page or folder to another folder or project.', moveItemArgs, write, async (input) => {
    await agent.moveItem(a, ctx, input);
    return text('Moved.');
  });
  tool('pin_item', 'Pin an item to Important, or unpin it with pinned: false.', pinItemArgs, write, async (input) => {
    await agent.pinItem(a, ctx, input);
    return text(input.pinned === false ? 'Unpinned.' : 'Pinned to Important.');
  });
  tool('trash_item', 'Move a project, folder, page or task to Trash. The owner can restore it for 30 days. Nothing is deleted permanently.', trashItemArgs, write, async (input) => {
    await agent.trashItem(a, ctx, input);
    return text('Moved to Trash.');
  });

  return server;
}

export function mcpRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('*', requireToken(deps));
  r.post('/', async (c) => {
    const actor = c.get('actor') as AgentActor;
    const ws = await getWorkspace(deps.db, { workspaceId: actor.workspaceId, actor });
    const server = buildMcpServer(deps, actor, ws.name);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  // Stateless: no server-initiated stream and no sessions to end.
  r.on(['GET', 'DELETE'], '/', (c) => c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, 405));
  return r;
}
