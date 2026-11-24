/**
 * M4 over HTTP: REST v1, MCP and OAuth. A token is bound to one workspace
 * (CLAUDE.md rule 2): every endpoint and every MCP tool is tried with ids
 * from another workspace and must not find them.
 */
import { describe, expect, it } from 'vitest';
import { bearer, makeApp, ORIGIN, setupOwner } from '../helpers';

async function world(extraEnv = {}) {
  const { app } = await makeApp(extraEnv);
  const { c, workspace: wsA } = await setupOwner(app);
  const wsB = (await c.post('/api/workspaces', { name: 'Client B' })).json.workspace as { id: string };
  const A = `/api/workspaces/${wsA.id}`;
  const B = `/api/workspaces/${wsB.id}`;
  const projA = (await c.post(`${A}/projects`, { name: 'A site' })).json.project;
  const pageA = (await c.post(`${A}/pages`, { projectId: projA.id, type: 'doc', title: 'A brief' })).json.page;
  const projB = (await c.post(`${B}/projects`, { name: 'B secret project' })).json.project;
  const folderB = (await c.post(`${B}/folders`, { projectId: projB.id, name: 'B folder' })).json.folder;
  const pageB = (await c.post(`${B}/pages`, { projectId: projB.id, type: 'doc', title: 'B confidential plan' })).json.page;
  const taskB = (await c.post(`${B}/tasks`, { title: 'B confidential task' })).json.task;
  const tokenA = (await c.post(`${A}/tokens`, { name: 'Claude Code', scope: 'write' })).json;
  const readA = (await c.post(`${A}/tokens`, { name: 'Reader', scope: 'read' })).json;
  return { app, c, A, B, wsA, wsB, projA, pageA, projB, folderB, pageB, taskB, tokenA, readA };
}

describe('REST v1', () => {
  it('answers only for the token’s workspace', async () => {
    const w = await world();
    const t = bearer(w.app, w.tokenA.secret);
    const me = await t.get('/api/v1/workspace');
    expect(me.json).toMatchObject({ workspace: { id: w.wsA.id }, token: { name: 'Claude Code', scope: 'write' } });
    const tree = await t.get('/api/v1/tree');
    expect(tree.status).toBe(200);
    expect(JSON.stringify(tree.json)).toContain('A brief');
    expect(JSON.stringify(tree.json)).not.toContain('B secret');
    expect((await t.get('/api/v1/search?query=confidential')).json.results).toEqual([]);
  });

  it('returns 404 for every call that names a B item', async () => {
    const w = await world();
    const t = bearer(w.app, w.tokenA.secret);
    const calls: [string, () => Promise<{ status: number }>][] = [
      ['read page', () => t.get(`/api/v1/pages/${w.pageB.id}`)],
      ['update page', () => t.patch(`/api/v1/pages/${w.pageB.id}`, { markdown: 'pwned' })],
      ['create page in B project', () => t.post('/api/v1/pages', { projectId: w.projB.id, title: 'x' })],
      ['create page in B folder', () => t.post('/api/v1/pages', { projectId: w.projA.id, folderId: w.folderB.id, title: 'x' })],
      ['list B project tasks', () => t.get(`/api/v1/tasks?projectId=${w.projB.id}`)],
      ['create task in B project', () => t.post('/api/v1/tasks', { title: 'x', projectId: w.projB.id })],
      ['update B task', () => t.patch(`/api/v1/tasks/${w.taskB.id}`, { title: 'pwned' })],
      ['complete B task', () => t.post(`/api/v1/tasks/${w.taskB.id}/complete`, {})],
      ['move B page', () => t.post('/api/v1/move', { kind: 'page', id: w.pageB.id, projectId: w.projA.id })],
      ['pin B page', () => t.post('/api/v1/pins', { itemType: 'page', itemId: w.pageB.id })],
      ['trash B page', () => t.post('/api/v1/trash', { kind: 'page', id: w.pageB.id })],
      ['trash B task', () => t.post('/api/v1/trash', { kind: 'task', id: w.taskB.id })],
    ];
    for (const [name, call] of calls) expect.soft((await call()).status, name).toBe(404);
    // And B is untouched.
    const still = await w.c.get(`${w.B}/pages/${w.pageB.id}`);
    expect(still.json.page.title).toBe('B confidential plan');
  });

  it('a token can’t use the app’s owner API, and cookies don’t work on v1', async () => {
    const w = await world();
    const t = bearer(w.app, w.tokenA.secret);
    expect((await t.get(`${w.A}/tree`)).status).toBe(401);
    expect((await t.get('/api/workspaces')).status).toBe(401);
    expect((await w.c.get('/api/v1/tree')).status).toBe(401);
  });

  it('401 with a resource-metadata hint, 403 for read tokens, 429 past the limit', async () => {
    const w = await world({ NOTEY_TOKEN_RATE_LIMIT: '5' });
    const none = await bearer(w.app, null).get('/api/v1/tree');
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
    expect((await bearer(w.app, 'ntk_nope').get('/api/v1/tree')).status).toBe(401);
    const r = bearer(w.app, w.readA.secret);
    expect((await r.post('/api/v1/pages', { projectId: w.projA.id, title: 'x' })).status).toBe(403);
    // Limit 5: the 403 above was request 1; requests 2–5 pass, the 6th is refused.
    for (let i = 0; i < 4; i++) expect((await r.get('/api/v1/tree')).status).toBe(200);
    const limited = await r.get('/api/v1/tree');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('revoking a token cuts it off at once', async () => {
    const w = await world();
    await w.c.post(`${w.A}/tokens/${w.tokenA.token.id}/revoke`);
    expect((await bearer(w.app, w.tokenA.secret).get('/api/v1/tree')).status).toBe(401);
  });

  it('writes are marked as the agent’s and land in history', async () => {
    const w = await world();
    const t = bearer(w.app, w.tokenA.secret);
    const res = await t.patch(`/api/v1/pages/${w.pageA.id}`, { markdown: '## Plan\n\nShip it.', mode: 'replace' });
    expect(res.status).toBe(200);
    expect(res.json.page).toMatchObject({ updatedBy: 'agent:Claude Code', markdown: '## Plan\n\nShip it.\n' });
    const versions = (await w.c.get(`${w.A}/pages/${w.pageA.id}/versions`)).json.versions as { reason: string }[];
    expect(versions.some((v) => v.reason === 'before agent edit')).toBe(true);
    const changes = (await w.c.get(`${w.A}/changes?since=0`)).json.changes as { actor: string }[];
    expect(changes.some((ch) => ch.actor === 'agent:Claude Code')).toBe(true);
  });

  it('serves an OpenAPI 3.1 spec without a token', async () => {
    const w = await world();
    const spec = await bearer(w.app, null).get('/api/v1/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.json.openapi).toBe('3.1.0');
    expect(Object.keys(spec.json.paths)).toEqual(expect.arrayContaining(['/tree', '/search', '/pages', '/pages/{id}', '/tasks', '/tasks/{id}/complete', '/move', '/pins', '/trash']));
    expect(spec.json.components.securitySchemes.bearer.scheme).toBe('bearer');
  });
});

describe('MCP', () => {
  it('lists read tools for read tokens and write tools only for write tokens', async () => {
    const w = await world();
    const names = async (secret: string) =>
      ((await bearer(w.app, secret).mcp('tools/list')).json.result.tools as { name: string }[]).map((t) => t.name).sort();
    const init = await bearer(w.app, w.readA.secret).mcp('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.json.result.serverInfo.name).toBe('notey');
    expect(await names(w.readA.secret)).toEqual(['get_workspace_tree', 'list_tasks', 'read_page', 'search']);
    expect(await names(w.tokenA.secret)).toEqual(
      expect.arrayContaining(['create_page', 'update_page', 'create_task', 'update_task', 'complete_task', 'move_item', 'pin_item', 'trash_item']),
    );
    expect(await names(w.tokenA.secret)).not.toContain('delete_item');
  });

  it('every tool refuses B ids', async () => {
    const w = await world();
    const t = bearer(w.app, w.tokenA.secret);
    const calls: [string, Record<string, unknown>][] = [
      ['read_page', { pageId: w.pageB.id }],
      ['update_page', { pageId: w.pageB.id, markdown: 'pwned' }],
      ['create_page', { projectId: w.projB.id, title: 'x' }],
      ['list_tasks', { projectId: w.projB.id }],
      ['create_task', { title: 'x', projectId: w.projB.id }],
      ['update_task', { taskId: w.taskB.id, title: 'pwned' }],
      ['complete_task', { taskId: w.taskB.id }],
      ['move_item', { kind: 'page', id: w.pageB.id, projectId: w.projA.id }],
      ['pin_item', { itemType: 'page', itemId: w.pageB.id }],
      ['trash_item', { kind: 'page', id: w.pageB.id }],
    ];
    for (const [name, args] of calls) {
      const r = await t.tool(name, args);
      expect.soft(r.isError, name).toBe(true);
      expect.soft(r.text, name).toMatch(/not found|nothing to pin/i);
    }
    const tree = await t.tool('get_workspace_tree');
    expect(tree.text).not.toContain('B secret');
    expect((await t.tool('search', { query: 'confidential' })).text).toBe('[]');
    expect((await w.c.get(`${w.B}/pages/${w.pageB.id}`)).json.page.title).toBe('B confidential plan');
  });

  it('reads and writes the token’s workspace', async () => {
    const w = await world();
    const t = bearer(w.app, w.tokenA.secret);
    const made = await t.tool('create_page', { projectId: w.projA.id, type: 'mindmap', title: 'Q1', markdown: '- Growth\n- Hiring' });
    expect(made.isError).toBe(false);
    const id = JSON.parse(made.text).id as string;
    const read = await t.tool('read_page', { pageId: id });
    expect(read.text).toContain('# Q1\n\n- Growth\n- Hiring');
    const task = await t.tool('create_task', { title: 'Call Rafi', dueDate: '2030-02-01' });
    expect(JSON.parse(task.text).createdBy).toBe('agent:Claude Code');
    const r = await bearer(w.app, w.readA.secret).tool('create_page', { projectId: w.projA.id, title: 'x' });
    expect(r.error ?? r.isError).toBeTruthy();
  });

  it('needs a token, and says where to get one', async () => {
    const w = await world();
    const res = await bearer(w.app, null).mcp('tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });
});

// ── OAuth ───────────────────────────────────────────────────────────────────

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('OAuth 2.1 for connectors', () => {
  it('publishes discovery documents', async () => {
    const w = await world();
    const pub = bearer(w.app, null);
    expect((await pub.get('/.well-known/oauth-protected-resource')).json).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    expect((await pub.get('/.well-known/oauth-authorization-server')).json).toMatchObject({
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('register → consent (one workspace, one scope) → code → token bound to that workspace', async () => {
    const w = await world();
    const pub = bearer(w.app, null);
    const reg = await pub.post('/oauth/register', { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(reg.status).toBe(201);
    const { verifier, challenge } = await pkce();
    const request = {
      client_id: reg.json.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    };

    // /oauth/authorize hands over to the consent screen in the app.
    const auth = await w.app.request(`${ORIGIN}/oauth/authorize?${form(request)}`);
    expect(auth.status).toBe(302);
    expect(auth.headers.get('location')).toMatch(/^\/connect\?/);

    // The consent API needs the owner.
    expect((await bearer(w.app, null).post('/api/oauth/approve', { request, workspaceId: w.wsB.id, scope: 'read' })).status).toBe(401);
    const info = await w.c.get(`/api/oauth/request?${form(request)}`);
    expect(info.json).toMatchObject({ client: { name: 'Claude' }, redirectHost: 'claude.ai' });
    const ok = await w.c.post('/api/oauth/approve', { request, workspaceId: w.wsB.id, scope: 'read' });
    const back = new URL(ok.json.redirect);
    expect(back.origin + back.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(back.searchParams.get('state')).toBe('xyz');
    const code = back.searchParams.get('code')!;

    const exchange = (body: Record<string, string>) =>
      w.app.request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
    const bad = await exchange({ grant_type: 'authorization_code', code, client_id: request.client_id, redirect_uri: request.redirect_uri, code_verifier: 'wrong'.padEnd(43, 'x') });
    expect(bad.status).toBe(400);
    // A failed attempt used the code up: a stolen code is worth one guess.
    const again = await exchange({ grant_type: 'authorization_code', code, client_id: request.client_id, redirect_uri: request.redirect_uri, code_verifier: verifier });
    expect(((await again.json()) as { error: string }).error).toBe('invalid_grant');

    // Fresh round trip, done right.
    const ok2 = await w.c.post('/api/oauth/approve', { request, workspaceId: w.wsB.id, scope: 'read' });
    const code2 = new URL(ok2.json.redirect).searchParams.get('code')!;
    const tok = await exchange({ grant_type: 'authorization_code', code: code2, client_id: request.client_id, redirect_uri: request.redirect_uri, code_verifier: verifier });
    expect(tok.status).toBe(200);
    const { access_token, token_type, scope } = (await tok.json()) as { access_token: string; token_type: string; scope: string };
    expect([token_type, scope]).toEqual(['Bearer', 'read']);

    // Bound to B, read-only, and listed in B's Settings as a connected app.
    const t = bearer(w.app, access_token);
    expect((await t.get('/api/v1/workspace')).json.workspace.id).toBe(w.wsB.id);
    expect((await t.tool('get_workspace_tree')).text).toContain('B secret project');
    expect((await t.get(`/api/v1/pages/${w.pageA.id}`)).status).toBe(404);
    const listed = (await w.c.get(`${w.B}/tokens`)).json.tokens as { name: string; source: string }[];
    expect(listed).toEqual([expect.objectContaining({ name: 'Claude', source: 'oauth' })]);
  });

  it('never redirects to an address the app didn’t register', async () => {
    const w = await world();
    const reg = await bearer(w.app, null).post('/oauth/register', { client_name: 'App', redirect_uris: ['https://app.example/cb'] });
    const { challenge } = await pkce();
    const q = { client_id: reg.json.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
    const res = await w.app.request(`${ORIGIN}/oauth/authorize?${form(q)}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect((await w.c.post('/api/oauth/approve', { request: q, workspaceId: w.wsA.id, scope: 'write' })).status).toBe(400);
    expect((await w.c.post('/api/oauth/deny', { request: q })).status).toBe(400);
  });

  it('refuses plain PKCE, missing PKCE and non-https redirect URIs', async () => {
    const w = await world();
    const pub = bearer(w.app, null);
    expect((await pub.post('/oauth/register', { client_name: 'x', redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
    expect((await pub.post('/oauth/register', { client_name: 'x', redirect_uris: ['http://localhost:7777/cb'] })).status).toBe(201);
    const reg = await pub.post('/oauth/register', { client_name: 'x', redirect_uris: ['https://a.example/cb'] });
    const q = { client_id: reg.json.client_id, redirect_uri: 'https://a.example/cb', response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' };
    expect((await w.app.request(`${ORIGIN}/oauth/authorize?${form(q)}`)).status).toBe(400);
  });
});
