import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/shared/blocks';
import { page, pageVersion } from '../../src/server/db/schema';
import type { DbAdapter } from '../../src/server/db/types';
import { listChanges } from '../../src/server/services/changes';
import * as content from '../../src/server/services/content';
import { readFile, sniffMime, uploadFile } from '../../src/server/services/files';
import { searchPages } from '../../src/server/services/search';
import * as trash from '../../src/server/services/trash';
import * as versions from '../../src/server/services/versions';
import { createWorkspace } from '../../src/server/services/workspace';
import { makeDb, memoryStorage, owner } from '../helpers';

const para = (text: string): Block => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] });

async function setup() {
  const a = await makeDb();
  const ws = await createWorkspace(a.db, { actor: owner() }, { name: 'Fevgo' });
  const ctx = { workspaceId: ws.id, actor: owner() };
  const proj = await content.createProject(a, ctx, { name: 'Website' });
  return { a, ctx, proj };
}

async function backdateVersions(a: DbAdapter, pageId: string) {
  await a.db.update(pageVersion).set({ createdAt: new Date(Date.now() - 10 * 60_000).toISOString() }).where(eq(pageVersion.pageId, pageId));
}

describe('tree', () => {
  it('builds projects, nested folders and pages in order', async () => {
    const { a, ctx, proj } = await setup();
    const drafts = await content.createFolder(a, ctx, { projectId: proj.id, name: 'Drafts' });
    const old = await content.createFolder(a, ctx, { projectId: proj.id, parentId: drafts.id, name: 'Old' });
    await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Homepage brief' });
    await content.createPage(a, ctx, { projectId: proj.id, folderId: old.id, type: 'doc', title: 'v1' });
    const tree = await content.getTree(a, ctx);
    expect(tree.projects.map((p) => p.name)).toEqual(['Website']);
    expect(tree.folders.map((f) => [f.name, f.parentId])).toEqual([
      ['Drafts', null],
      ['Old', drafts.id],
    ]);
    expect(tree.pages.map((p) => [p.title, p.folderId])).toEqual([
      ['Homepage brief', null],
      ['v1', old.id],
    ]);
  });

  it('rejects a folder parent from another project', async () => {
    const { a, ctx, proj } = await setup();
    const other = await content.createProject(a, ctx, { name: 'Brand' });
    const f = await content.createFolder(a, ctx, { projectId: other.id, name: 'X' });
    await expect(content.createFolder(a, ctx, { projectId: proj.id, parentId: f.id, name: 'Y' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(content.createPage(a, ctx, { projectId: proj.id, folderId: f.id, type: 'doc', title: '' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('saving pages', () => {
  it('bumps rev, regenerates Markdown and rejects stale revs with the current rev', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    const saved = await content.savePageContent(a, ctx, p.id, { rev: 0, content: [{ type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Goals', styles: {} }] }, para('Ship it')] });
    expect(saved.rev).toBe(1);
    expect(saved.contentMd).toBe('## Goals\n\nShip it\n');
    const stored = await content.getPage(a, ctx, p.id);
    expect(stored.contentMd).toBe('## Goals\n\nShip it\n');
    const stale = content.savePageContent(a, ctx, p.id, { rev: 0, content: [para('Mine')] });
    await expect(stale).rejects.toMatchObject({ code: 'conflict', details: { rev: 1 } });
  });

  it('renames without touching content or rev, and duplicates next to the original', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Sitemap' });
    await content.savePageContent(a, ctx, p.id, { rev: 0, content: [para('Body')] });
    const renamed = await content.updatePageMeta(a, ctx, p.id, { title: 'Homepage brief', icon: '📄' });
    expect(renamed).toMatchObject({ title: 'Homepage brief', icon: '📄', rev: 1 });
    const copy = await content.duplicatePage(a, ctx, p.id);
    expect(copy.title).toBe('Homepage brief (copy)');
    expect(copy.contentMd).toBe('Body\n');
    const order = (await content.getTree(a, ctx)).pages.map((x) => x.title);
    expect(order).toEqual(['Homepage brief', 'Homepage brief (copy)', 'Sitemap']);
  });
});

describe('history', () => {
  it('snapshots after 5 minutes of activity, on demand, and restores undoably', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    await content.savePageContent(a, ctx, p.id, { rev: 0, content: [para('first')] });
    await content.savePageContent(a, ctx, p.id, { rev: 1, content: [para('second')] });
    // rev 0 had a title, so it was snapshotted once; the immediate next save is within 5 minutes.
    expect((await versions.listVersions(a, ctx, p.id)).map((v) => v.rev)).toEqual([0]);

    await backdateVersions(a, p.id);
    await content.savePageContent(a, ctx, p.id, { rev: 2, content: [para('third')] });
    const list = await versions.listVersions(a, ctx, p.id);
    expect(list.map((v) => v.rev)).toEqual([2, 0]);

    const manual = await versions.createSnapshot(a, ctx, p.id);
    expect(manual.reason).toBe('manual');

    const v2 = list[0]!;
    expect((await versions.getVersion(a, ctx, p.id, v2.id)).contentMd).toBe('second\n');
    const restored = await versions.restoreVersion(a, ctx, p.id, v2.id);
    expect(restored.contentMd).toBe('second\n');
    expect(restored.rev).toBe(4);
    const after = await versions.listVersions(a, ctx, p.id);
    expect(after[0]).toMatchObject({ reason: 'before restore', rev: 3 });
  });

  it('always snapshots before an agent write', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Brief' });
    await content.savePageContent(a, ctx, p.id, { rev: 0, content: [para('owner text')] });
    const bot = { workspaceId: ctx.workspaceId, actor: { kind: 'agent' as const, tokenId: 't', name: 'Claude', workspaceId: ctx.workspaceId, scope: 'write' as const } };
    await content.savePageContent(a, bot, p.id, { rev: 1, content: [para('agent text')] });
    const [latest] = await versions.listVersions(a, ctx, p.id);
    expect(latest).toMatchObject({ reason: 'before agent edit', rev: 1 });
    expect((await content.getPage(a, ctx, p.id)).updatedBy).toBe('agent:Claude');
  });
});

describe('moving', () => {
  it('reorders, moves into folders and across projects, and blocks cycles', async () => {
    const { a, ctx, proj } = await setup();
    const brand = await content.createProject(a, ctx, { name: 'Brand' });
    const f1 = await content.createFolder(a, ctx, { projectId: proj.id, name: 'Drafts' });
    const f2 = await content.createFolder(a, ctx, { projectId: proj.id, parentId: f1.id, name: 'Old' });
    const p1 = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'One' });
    const p2 = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Two' });
    const inside = await content.createPage(a, ctx, { projectId: proj.id, folderId: f2.id, type: 'doc', title: 'Deep' });

    await content.moveItem(a, ctx, { kind: 'page', id: p2.id, index: 0 });
    expect((await content.getTree(a, ctx)).pages.filter((p) => !p.folderId).map((p) => p.title)).toEqual(['Two', 'One']);

    await content.moveItem(a, ctx, { kind: 'page', id: p1.id, parentId: f1.id });
    expect((await content.getPage(a, ctx, p1.id)).folderId).toBe(f1.id);

    await expect(content.moveItem(a, ctx, { kind: 'folder', id: f1.id, parentId: f2.id })).rejects.toMatchObject({ code: 'invalid' });
    await expect(content.moveItem(a, ctx, { kind: 'folder', id: f1.id, parentId: f1.id })).rejects.toMatchObject({ code: 'invalid' });

    await content.moveItem(a, ctx, { kind: 'folder', id: f1.id, projectId: brand.id, parentId: null });
    const tree = await content.getTree(a, ctx);
    expect(tree.folders.find((f) => f.id === f2.id)!.projectId).toBe(brand.id);
    expect(tree.pages.find((p) => p.id === inside.id)!.projectId).toBe(brand.id);
    expect(tree.pages.find((p) => p.id === p1.id)!.projectId).toBe(brand.id);
  });
});

describe('trash', () => {
  it('trashes a folder with its contents and restores them together', async () => {
    const { a, ctx, proj } = await setup();
    const f = await content.createFolder(a, ctx, { projectId: proj.id, name: 'Drafts' });
    const sub = await content.createFolder(a, ctx, { projectId: proj.id, parentId: f.id, name: 'Old' });
    const p1 = await content.createPage(a, ctx, { projectId: proj.id, folderId: f.id, type: 'doc', title: 'Keep' });
    const p2 = await content.createPage(a, ctx, { projectId: proj.id, folderId: sub.id, type: 'doc', title: 'Deep' });
    const gone = await content.createPage(a, ctx, { projectId: proj.id, folderId: f.id, type: 'doc', title: 'Deleted first' });
    await trash.trashItem(a, ctx, 'page', gone.id);
    await new Promise((r) => setTimeout(r, 5));
    await trash.trashItem(a, ctx, 'folder', f.id);

    const tree = await content.getTree(a, ctx);
    expect(tree.folders).toEqual([]);
    expect(tree.pages).toEqual([]);
    const items = await trash.listTrash(a, ctx);
    expect(items.map((i) => [i.kind, i.name, i.contains])).toEqual([
      ['folder', 'Drafts', 3],
      ['page', 'Deleted first', 0],
    ]);

    await trash.restoreItem(a, ctx, 'folder', f.id);
    const back = await content.getTree(a, ctx);
    expect(back.folders.map((x) => x.name).sort()).toEqual(['Drafts', 'Old']);
    expect(back.pages.map((x) => x.id).sort()).toEqual([p1.id, p2.id].sort());
    expect((await trash.listTrash(a, ctx)).map((i) => i.name)).toEqual(['Deleted first']);
  });

  it('needs the project restored first, and puts orphans at the project root', async () => {
    const { a, ctx, proj } = await setup();
    const f = await content.createFolder(a, ctx, { projectId: proj.id, name: 'Drafts' });
    const p = await content.createPage(a, ctx, { projectId: proj.id, folderId: f.id, type: 'doc', title: 'Note' });
    await trash.trashItem(a, ctx, 'page', p.id);
    await new Promise((r) => setTimeout(r, 5));
    await trash.trashItem(a, ctx, 'folder', f.id);
    await trash.restoreItem(a, ctx, 'page', p.id);
    expect((await content.getPage(a, ctx, p.id)).folderId).toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    await trash.trashItem(a, ctx, 'page', p.id);
    await new Promise((r) => setTimeout(r, 5));
    await trash.trashItem(a, ctx, 'project', proj.id);
    await expect(trash.restoreItem(a, ctx, 'page', p.id)).rejects.toMatchObject({ code: 'conflict' });
    await trash.restoreItem(a, ctx, 'project', proj.id);
    await trash.restoreItem(a, ctx, 'page', p.id);
    expect((await content.getTree(a, ctx)).pages).toHaveLength(1);
  });

  it('deletes forever for the owner only and purges after 30 days', async () => {
    const { a, ctx, proj } = await setup();
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Old' });
    const q = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Older' });
    await trash.trashItem(a, ctx, 'page', p.id);
    await trash.trashItem(a, ctx, 'page', q.id);
    const bot = { workspaceId: ctx.workspaceId, actor: { kind: 'agent' as const, tokenId: 't', name: 'Claude', workspaceId: ctx.workspaceId, scope: 'write' as const } };
    await expect(trash.deleteForever(a, bot, 'page', p.id)).rejects.toMatchObject({ code: 'forbidden' });
    await trash.deleteForever(a, ctx, 'page', p.id);
    await a.db.update(page).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() }).where(eq(page.id, q.id));
    expect(await trash.listTrash(a, ctx)).toEqual([]);
    expect(await a.db.select().from(page)).toEqual([]);
  });
});

describe('search', () => {
  it('finds words by prefix, ranks title matches first, and skips trash', async () => {
    const { a, ctx, proj } = await setup();
    const body = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Notes' });
    await content.savePageContent(a, ctx, body.id, { rev: 0, content: [para('The homepage hero needs a clearer headline.')] });
    const titled = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'Homepage brief' });

    const hits = await searchPages(a, ctx, 'homep');
    expect(hits.map((h) => h.id)).toEqual([titled.id, body.id]);
    expect(hits[1]!.snippet).toContain('\u0001homepage\u0002');

    await trash.trashItem(a, ctx, 'page', titled.id);
    expect((await searchPages(a, ctx, 'homepage')).map((h) => h.id)).toEqual([body.id]);
    await trash.restoreItem(a, ctx, 'page', titled.id);
    expect(await searchPages(a, ctx, 'homepage')).toHaveLength(2);

    expect((await searchPages(a, ctx, '')).map((h) => h.title)[0]).toBe('Homepage brief');
    expect(await searchPages(a, ctx, '"; DROP TABLE page; --')).toEqual([]);
  });
});

describe('files', () => {
  it('sniffs the type from bytes, not the name', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe('image/svg+xml');
    expect(sniffMime(new Uint8Array([0, 1, 2, 3]))).toBe('application/octet-stream');
  });

  it('stores per workspace and serves with a sandboxing CSP', async () => {
    const { a, ctx } = await setup();
    const storage = memoryStorage();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const info = await uploadFile(a, storage, ctx, { name: '../../evil.png', bytes: svg });
    expect(info).toMatchObject({ name: 'evil.png', mime: 'image/svg+xml', url: `/api/workspaces/${ctx.workspaceId}/files/${info.id}` });
    const out = await readFile(a, storage, ctx, info.id);
    expect(out.headers['content-security-policy']).toContain('sandbox');
    expect(out.headers['x-content-type-options']).toBe('nosniff');
    await expect(uploadFile(a, storage, ctx, { name: 'big.bin', bytes: new Uint8Array(25 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('change feed', () => {
  it('starts at the head and then lists newer changes in order', async () => {
    const { a, ctx, proj } = await setup();
    const head = await listChanges(a, ctx, null);
    expect(head.changes).toEqual([]);
    const p = await content.createPage(a, ctx, { projectId: proj.id, type: 'doc', title: 'New' });
    const next = await listChanges(a, ctx, head.seq);
    expect(next.changes.map((c) => [c.entity, c.entityId, c.op])).toEqual([['page', p.id, 'create']]);
    expect(next.seq).toBeGreaterThan(head.seq);
    expect((await listChanges(a, ctx, next.seq)).changes).toEqual([]);
  });
});
