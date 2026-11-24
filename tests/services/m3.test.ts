import { describe, expect, it } from 'vitest';
import type { CanvasContent } from '../../src/shared/canvas';
import { mindNode, type MindmapContent, type MindNode } from '../../src/shared/mindmap';
import * as content from '../../src/server/services/content';
import { searchPages } from '../../src/server/services/search';
import * as versions from '../../src/server/services/versions';
import { createWorkspace } from '../../src/server/services/workspace';
import { makeDb, owner } from '../helpers';

async function setup() {
  const a = await makeDb();
  const ws = await createWorkspace(a.db, { actor: owner() }, { name: 'Fevgo' });
  const ctx = { workspaceId: ws.id, actor: owner() };
  const proj = await content.createProject(a, ctx, { name: 'Launch' });
  return { a, ctx, proj };
}

const scene = (_ws: string, fileUrl?: string): CanvasContent => ({
  kind: 'canvas',
  elements: [
    { id: 's1', type: 'rectangle', x: 0, y: 0, customData: { notey: 'sticky' } },
    { id: 't1', type: 'text', x: 4, y: 4, text: 'Zanzibar pricing', containerId: 's1' },
    ...(fileUrl ? [{ id: 'i1', type: 'image', x: 0, y: 300, fileId: 'f1' }] : []),
  ],
  files: fileUrl ? { f1: { mimeType: 'image/png', url: fileUrl } } : {},
});

const mindmap = (root: MindNode): MindmapContent => ({ kind: 'mindmap', layout: 'right', root });

describe('canvas pages', () => {
  it('saves a scene and derives searchable Markdown from its text', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'canvas', title: 'Flow' });
    expect(p.content).toBeNull();
    const saved = await content.savePageContent(a, ctx, p.id, { rev: 0, content: scene(ctx.workspaceId) });
    expect(saved.contentMd).toBe('Canvas with 1 element.\n\n- Sticky note: “Zanzibar pricing”\n');
    expect((await searchPages(a, ctx, 'zanzib')).map((h) => h.id)).toEqual([p.id]);
    const got = await content.getPage(a, ctx, p.id);
    expect((got.content as CanvasContent).elements).toHaveLength(2);
  });

  it('accepts images stored in this workspace and refuses any other URL', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'canvas', title: 'Moodboard' });
    const own = `/api/workspaces/${ctx.workspaceId}/files/0193-abc`;
    await expect(content.savePageContent(a, ctx, p.id, { rev: 0, content: scene(ctx.workspaceId, own) })).resolves.toMatchObject({ rev: 1 });
    for (const url of ['https://tracker.example/pixel.png', '/api/workspaces/other-ws/files/x', `/api/workspaces/${ctx.workspaceId}/files/../../other/files/x`]) {
      await expect(content.savePageContent(a, ctx, p.id, { rev: 1, content: scene(ctx.workspaceId, url) }), url).rejects.toMatchObject({ code: 'invalid' });
    }
  });

  it('duplicates with the scene', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'canvas', title: 'Flow' });
    await content.savePageContent(a, ctx, p.id, { rev: 0, content: scene(ctx.workspaceId) });
    const copy = await content.duplicatePage(a, ctx, p.id);
    expect(copy.type).toBe('canvas');
    expect(copy.contentMd).toContain('Zanzibar pricing');
  });
});

describe('content must fit the page type', () => {
  it('refuses blocks on a canvas, scenes on a doc, and anything on a task list', async () => {
    const { a, ctx, proj } = await setup();
    const doc = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Doc' });
    const canvas = await content.createPage(a, ctx, { projectId: proj.id, type: 'canvas', title: 'Canvas' });
    const mm = await content.createPage(a, ctx, { projectId: proj.id, type: 'mindmap', title: 'Map' });
    const list = await content.createPage(a, ctx, { projectId: proj.id, type: 'tasklist', title: 'List' });
    const blocks = [{ type: 'paragraph' }];
    await expect(content.savePageContent(a, ctx, canvas.id, { rev: 0, content: blocks })).rejects.toMatchObject({ code: 'invalid' });
    await expect(content.savePageContent(a, ctx, doc.id, { rev: 0, content: scene(ctx.workspaceId) })).rejects.toMatchObject({ code: 'invalid' });
    await expect(content.savePageContent(a, ctx, mm.id, { rev: 0, content: scene(ctx.workspaceId) })).rejects.toMatchObject({ code: 'invalid' });
    await expect(content.savePageContent(a, ctx, list.id, { rev: 0, content: blocks })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('mindmap pages', () => {
  it('keeps content_md as an outline, and history restores the tree with its outline', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'mindmap', title: 'Q1' });
    const v1 = mindmap(mindNode('Q1 plan', [mindNode('Growth'), mindNode('Hiring')]));
    const s1 = await content.savePageContent(a, ctx, p.id, { rev: 0, content: v1 });
    expect(s1.contentMd).toBe('# Q1 plan\n\n- Growth\n- Hiring\n');
    const snap = await versions.createSnapshot(a, ctx, p.id);
    await content.savePageContent(a, ctx, p.id, { rev: 1, content: mindmap(mindNode('Q1 plan', [mindNode('Growth')])) });

    const detail = await versions.getVersion(a, ctx, p.id, snap.id);
    expect(detail.type).toBe('mindmap');
    expect(detail.contentMd).toBe('# Q1 plan\n\n- Growth\n- Hiring\n');
    const restored = await versions.restoreVersion(a, ctx, p.id, snap.id);
    expect(restored.contentMd).toBe('# Q1 plan\n\n- Growth\n- Hiring\n');
    expect((restored.content as MindmapContent).root.children).toHaveLength(2);
  });

  it('refuses trees that are too big or too deep', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'mindmap', title: 'Big' });
    const wide = mindNode('root', Array.from({ length: 5_001 }, (_, i) => mindNode(`n${i}`)));
    await expect(content.savePageContent(a, ctx, p.id, { rev: 0, content: mindmap(wide) })).rejects.toMatchObject({ code: 'invalid' });
    let deep = mindNode('leaf');
    for (let i = 0; i < 45; i++) deep = mindNode(`l${i}`, [deep]);
    await expect(content.savePageContent(a, ctx, p.id, { rev: 0, content: mindmap(deep) })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('embeds in docs', () => {
  it('writes the embedded page’s live title into the doc’s Markdown', async () => {
    const { a, ctx, proj } = await setup();
    const c = await content.createPage(a, ctx, { projectId: proj.id, type: 'canvas', title: 'Launch flow' });
    const doc = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    const saved = await content.savePageContent(a, ctx, doc.id, { rev: 0, content: [{ type: 'pageEmbed', props: { pageId: c.id, kind: 'canvas' } }] });
    expect(saved.contentMd).toBe(`![Launch flow](notey://page/${c.id})\n`);
  });
});
