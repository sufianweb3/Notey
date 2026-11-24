/**
 * Workspace isolation for M3 content (CLAUDE.md rule 2): canvas scenes,
 * mindmaps and doc embeds can't reach another workspace's pages or files.
 */
import { describe, expect, it } from 'vitest';
import { makeApp, setupOwner } from '../helpers';

async function twoWorkspaces() {
  const { app } = await makeApp();
  const { c, workspace: a } = await setupOwner(app);
  const b = (await c.post('/api/workspaces', { name: 'Client B' })).json.workspace as { id: string };
  const A = `/api/workspaces/${a.id}`;
  const B = `/api/workspaces/${b.id}`;
  const projA = (await c.post(`${A}/projects`, { name: 'A site' })).json.project;
  const projB = (await c.post(`${B}/projects`, { name: 'B secret' })).json.project;
  const canvasB = (await c.post(`${B}/pages`, { projectId: projB.id, type: 'canvas', title: 'B confidential canvas' })).json.page;
  const mindB = (await c.post(`${B}/pages`, { projectId: projB.id, type: 'mindmap', title: 'B confidential map' })).json.page;
  return { c, A, B, b, projA, canvasB, mindB };
}

describe('HTTP: M3 content stays in its workspace', () => {
  it('B canvases and mindmaps are 404 through A', async () => {
    const { c, A, canvasB, mindB } = await twoWorkspaces();
    const scene = { kind: 'canvas', elements: [], files: {} };
    const map = { kind: 'mindmap', layout: 'right', root: { id: 'r', text: 'pwned', children: [] } };
    expect((await c.get(`${A}/pages/${canvasB.id}`)).status).toBe(404);
    expect((await c.put(`${A}/pages/${canvasB.id}/content`, { rev: 0, content: scene })).status).toBe(404);
    expect((await c.put(`${A}/pages/${mindB.id}/content`, { rev: 0, content: map })).status).toBe(404);
    expect((await c.get(`${A}/pages/${mindB.id}/markdown`)).status).toBe(404);
  });

  it('an A canvas cannot reference a B file', async () => {
    const { c, A, b, projA } = await twoWorkspaces();
    const canvasA = (await c.post(`${A}/pages`, { projectId: projA.id, type: 'canvas', title: 'Mine' })).json.page;
    const res = await c.put(`${A}/pages/${canvasA.id}/content`, {
      rev: 0,
      content: { kind: 'canvas', elements: [{ id: 'i', type: 'image', fileId: 'f' }], files: { f: { mimeType: 'image/png', url: `/api/workspaces/${b.id}/files/x` } } },
    });
    expect(res.status).toBe(400);
  });

  it('an A doc embedding a B page id never learns its title', async () => {
    const { c, A, projA, canvasB } = await twoWorkspaces();
    const doc = (await c.post(`${A}/pages`, { projectId: projA.id, type: 'doc', title: 'Brief' })).json.page;
    const saved = await c.put(`${A}/pages/${doc.id}/content`, { rev: 0, content: [{ type: 'pageEmbed', props: { pageId: canvasB.id, kind: 'canvas' } }] });
    expect(saved.status).toBe(200);
    expect(saved.json.contentMd).not.toContain('confidential');
    expect((await c.get(`${A}/search?q=confidential`)).json.results).toEqual([]);
  });
});
