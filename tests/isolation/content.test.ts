/**
 * Workspace isolation for M1 content endpoints (CLAUDE.md rule 2). Item ids
 * from workspace B, sent through workspace A's URL, must never resolve.
 */
import { describe, expect, it } from 'vitest';
import * as content from '../../src/server/services/content';
import { getTree } from '../../src/server/services/content';
import { searchPages } from '../../src/server/services/search';
import { agent, client, makeApp, makeDb, owner, setupOwner } from '../helpers';
import { createWorkspace } from '../../src/server/services/workspace';

async function twoWorkspacesOverHttp() {
  const { app } = await makeApp();
  const { c, workspace: a } = await setupOwner(app);
  const b = (await c.post('/api/workspaces', { name: 'Client B' })).json.workspace as { id: string };
  const A = `/api/workspaces/${a.id}`;
  const B = `/api/workspaces/${b.id}`;
  const projA = (await c.post(`${A}/projects`, { name: 'A site' })).json.project;
  const projB = (await c.post(`${B}/projects`, { name: 'B secret project' })).json.project;
  const folderB = (await c.post(`${B}/folders`, { projectId: projB.id, name: 'B folder' })).json.folder;
  const pageB = (await c.post(`${B}/pages`, { projectId: projB.id, type: 'doc', title: 'B confidential plan' })).json.page;
  await c.patch(`${B}/pages/${pageB.id}`, { title: 'B confidential plan' });
  const put = await (async () => {
    const res = await app.request(`http://localhost${B}/pages/${pageB.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: '{}',
    });
    return res.status;
  })();
  expect(put).toBe(401); // no cookie on this raw request
  return { app, c, A, B, projA, projB, folderB, pageB };
}

describe('HTTP: ids from another workspace never resolve', () => {
  it('returns 404 for every A-scoped call that names a B item', async () => {
    const { c, A, projA, projB, folderB, pageB } = await twoWorkspacesOverHttp();
    const calls: [string, () => Promise<{ status: number }>][] = [
      ['GET page', () => c.get(`${A}/pages/${pageB.id}`)],
      ['PATCH page', () => c.patch(`${A}/pages/${pageB.id}`, { title: 'pwned' })],
      ['duplicate page', () => c.post(`${A}/pages/${pageB.id}/duplicate`)],
      ['page markdown', () => c.get(`${A}/pages/${pageB.id}/markdown`)],
      ['list versions', () => c.get(`${A}/pages/${pageB.id}/versions`)],
      ['snapshot', () => c.post(`${A}/pages/${pageB.id}/versions`)],
      ['PATCH project', () => c.patch(`${A}/projects/${projB.id}`, { name: 'pwned' })],
      ['PATCH folder', () => c.patch(`${A}/folders/${folderB.id}`, { name: 'pwned' })],
      ['create page in B project', () => c.post(`${A}/pages`, { projectId: projB.id, type: 'doc', title: 'x' })],
      ['create folder in B project', () => c.post(`${A}/folders`, { projectId: projB.id, name: 'x' })],
      ['create page in B folder', () => c.post(`${A}/pages`, { projectId: projA.id, folderId: folderB.id, type: 'doc', title: 'x' })],
      ['move B page', () => c.post(`${A}/move`, { kind: 'page', id: pageB.id, projectId: projA.id })],
      ['move A-ward into B project', () => c.post(`${A}/move`, { kind: 'folder', id: folderB.id })],
      ['trash B page', () => c.post(`${A}/trash`, { kind: 'page', id: pageB.id })],
      ['trash B project', () => c.post(`${A}/trash`, { kind: 'project', id: projB.id })],
      ['restore B page', () => c.post(`${A}/trash/restore`, { kind: 'page', id: pageB.id })],
      ['delete B page forever', () => c.post(`${A}/trash/delete`, { kind: 'page', id: pageB.id })],
      ['B file via A', () => c.get(`${A}/files/${pageB.id}`)],
    ];
    for (const [name, call] of calls) {
      expect.soft((await call()).status, name).toBe(404);
    }
  });

  it('keeps tree, search, trash and the change feed to one workspace', async () => {
    const { c, A, B, pageB } = await twoWorkspacesOverHttp();
    const tree = (await c.get(`${A}/tree`)).json;
    expect(JSON.stringify(tree)).not.toContain('B secret project');
    expect((await c.get(`${A}/search?q=confidential`)).json.results).toEqual([]);
    expect((await c.get(`${B}/search?q=confidential`)).json.results.map((r: { id: string }) => r.id)).toEqual([pageB.id]);
    const changes = (await c.get(`${A}/changes?since=0`)).json.changes as { entityId: string }[];
    expect(changes.some((ch) => ch.entityId === pageB.id)).toBe(false);
    await c.post(`${B}/trash`, { kind: 'page', id: pageB.id });
    expect((await c.get(`${A}/trash`)).json.items).toEqual([]);
  });

  it('closes a workspace that is in trash', async () => {
    const { c, B, projB } = await twoWorkspacesOverHttp();
    const id = B.split('/').pop();
    await c.post(`/api/workspaces/${id}/delete`, { confirmName: 'Client B' });
    expect((await c.get(`${B}/tree`)).status).toBe(404);
    expect((await c.post(`${B}/pages`, { projectId: projB.id, type: 'doc', title: 'x' })).status).toBe(404);
  });
});

describe('service: agents', () => {
  it('an agent bound to A sees nothing in B and a read token cannot write', async () => {
    const a = await makeDb();
    const wsA = await createWorkspace(a.db, { actor: owner() }, { name: 'A' });
    const wsB = await createWorkspace(a.db, { actor: owner() }, { name: 'B' });
    const ownerB = { workspaceId: wsB.id, actor: owner() };
    const projB = await content.createProject(a, ownerB, { name: 'B project' });
    await content.createPage(a, ownerB, { projectId: projB.id, type: 'doc', title: 'B plan' });

    const botInB = { workspaceId: wsB.id, actor: agent(wsA.id) };
    await expect(getTree(a, botInB)).rejects.toMatchObject({ code: 'not_found' });
    await expect(searchPages(a, botInB, 'plan')).rejects.toMatchObject({ code: 'not_found' });

    const reader = { workspaceId: wsA.id, actor: agent(wsA.id, 'read') };
    expect((await getTree(a, reader)).projects).toEqual([]);
    await expect(content.createProject(a, reader, { name: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('client sanity', () => {
  it('signed-out callers get 401 on content routes', async () => {
    const { app } = await makeApp();
    const { workspace } = await setupOwner(app);
    expect((await client(app).get(`/api/workspaces/${workspace.id}/tree`)).status).toBe(401);
  });
});
