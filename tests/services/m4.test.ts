import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/shared/blocks';
import type { MindmapContent } from '../../src/shared/mindmap';
import * as agentOps from '../../src/server/services/agent';
import * as content from '../../src/server/services/content';
import * as tasks from '../../src/server/services/tasks';
import * as tokens from '../../src/server/services/tokens';
import * as trash from '../../src/server/services/trash';
import * as versions from '../../src/server/services/versions';
import { createWorkspace, deleteWorkspace } from '../../src/server/services/workspace';
import { agent, makeDb, owner } from '../helpers';

async function setup() {
  const a = await makeDb();
  const ws = await createWorkspace(a.db, { actor: owner() }, { name: 'Fevgo' });
  const own = { workspaceId: ws.id, actor: owner() };
  const bot = { workspaceId: ws.id, actor: agent(ws.id) };
  const proj = await content.createProject(a, own, { name: 'Website' });
  return { a, ws, own, bot, proj };
}

describe('tokens', () => {
  it('are shown once, stored as a hash, listed without secrets and revocable', async () => {
    const { a, own } = await setup();
    const { token, secret } = await tokens.createToken(a, own, { name: 'Claude Code', scope: 'write' });
    expect(secret).toMatch(/^ntk_[A-Za-z0-9_-]{43}$/);
    const rows = await a.all('SELECT token_hash FROM api_token');
    expect(rows[0]!.token_hash).toBe(await tokens.hashToken(secret));
    expect(JSON.stringify(await tokens.listTokens(a, own))).not.toContain(secret);
    const ok = await tokens.authenticateToken(a, secret);
    expect(ok).toMatchObject({ ok: true, actor: { kind: 'agent', name: 'Claude Code', scope: 'write', tokenId: token.id } });
    await tokens.revokeToken(a, own, token.id);
    expect(await tokens.authenticateToken(a, secret)).toEqual({ ok: false, reason: 'invalid' });
    expect(await tokens.listTokens(a, own)).toEqual([]);
  });

  it('only the owner manages them, and agents can’t mint more', async () => {
    const { a, bot } = await setup();
    await expect(tokens.createToken(a, bot, { name: 'x', scope: 'write' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(tokens.listTokens(a, bot)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('stop working when their workspace is deleted, and reject look-alikes', async () => {
    const { a, own } = await setup();
    const { secret } = await tokens.createToken(a, own, { name: 'Script', scope: 'read' });
    expect(await tokens.authenticateToken(a, secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A'))).toMatchObject({ ok: false });
    expect(await tokens.authenticateToken(a, 'Bearer nonsense')).toMatchObject({ ok: false });
    await createWorkspace(a.db, { actor: owner() }, { name: 'Other' }); // the last workspace can't be deleted
    await deleteWorkspace(a.db, own, 'Fevgo');
    expect(await tokens.authenticateToken(a, secret)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('count requests per minute and refuse past the limit', async () => {
    const { a, own } = await setup();
    const { secret } = await tokens.createToken(a, own, { name: 'Busy', scope: 'read' });
    const t0 = Date.UTC(2030, 0, 1, 12, 0, 5);
    for (let i = 0; i < 3; i++) expect((await tokens.authenticateToken(a, secret, 3, t0)).ok).toBe(true);
    expect(await tokens.authenticateToken(a, secret, 3, t0 + 1000)).toEqual({ ok: false, reason: 'rate_limited', retryAfter: 54 });
    // A new minute starts a new count.
    expect((await tokens.authenticateToken(a, secret, 3, t0 + 60_000)).ok).toBe(true);
  });
});

const md = (p: { markdown: string }) => p.markdown;

describe('agent page edits', () => {
  it('create a doc from Markdown and a mindmap from an outline', async () => {
    const { a, bot, proj } = await setup();
    const doc = await agentOps.createPage(a, bot, { projectId: proj.id, type: 'doc', title: 'Brief', markdown: '## Goals\n\n- Ship in December\n' });
    expect(md(doc)).toBe('## Goals\n\n- Ship in December\n');
    expect(doc.updatedBy).toBe('agent:Claude');
    const map = await agentOps.createPage(a, bot, { projectId: proj.id, type: 'mindmap', title: 'Q1', markdown: '- Growth\n- Hiring' });
    expect(md(map)).toBe('# Q1\n\n- Growth\n- Hiring\n');
    await expect(agentOps.createPage(a, bot, { projectId: proj.id, type: 'canvas', title: 'x', markdown: 'hi' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('replace, append and replace one section, snapshotting before each write', async () => {
    const { a, own, bot, proj } = await setup();
    const p = await agentOps.createPage(a, own, { projectId: proj.id, type: 'doc', title: 'Plan', markdown: '# Plan\n\nIntro.\n\n## Risks\n\nNone yet.\n\n### Detail\n\nDeep.\n\n## Next\n\nShip.\n' });

    const sec = await agentOps.updatePage(a, bot, { pageId: p.id, mode: 'replace_section', heading: 'risks', markdown: 'Late copy.\n\nNo designer.' });
    expect(md(sec)).toBe('# Plan\n\nIntro.\n\n## Risks\n\nLate copy.\n\nNo designer.\n\n## Next\n\nShip.\n');
    expect(sec.updatedBy).toBe('agent:Claude');

    const app = await agentOps.updatePage(a, bot, { pageId: p.id, mode: 'append', markdown: '- [ ] Book the launch call' });
    expect(md(app).endsWith('Ship.\n\n- [ ] Book the launch call\n')).toBe(true);

    const all = await agentOps.updatePage(a, bot, { pageId: p.id, mode: 'replace', markdown: 'Fresh start.', title: 'Plan v2' });
    expect(all.title).toBe('Plan v2');
    expect(md(all)).toBe('Fresh start.\n');

    // Every agent write left the version before it in history, so each is undoable.
    const vs = await versions.listVersions(a, own, p.id);
    expect(vs.filter((v) => v.reason === 'before agent edit').length).toBe(3);
    const before = vs.find((v) => v.rev === 0)!;
    const restored = await versions.restoreVersion(a, own, p.id, before.id);
    expect(restored.contentMd).toContain('None yet.');

    await expect(agentOps.updatePage(a, bot, { pageId: p.id, mode: 'replace_section', heading: 'Missing', markdown: 'x' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('edits mindmaps as outlines: append branches, replace one idea’s branch', async () => {
    const { a, bot, proj } = await setup();
    const p = await agentOps.createPage(a, bot, { projectId: proj.id, type: 'mindmap', title: 'Launch', markdown: '# Launch\n- Website\n  - Hero\n- Press' });
    const appended = await agentOps.updatePage(a, bot, { pageId: p.id, mode: 'append', markdown: '- Newsletter\n  - Tomás' });
    expect(md(appended)).toBe('# Launch\n\n- Website\n  - Hero\n- Press\n- Newsletter\n  - Tomás\n');
    const swapped = await agentOps.updatePage(a, bot, { pageId: p.id, mode: 'replace_section', heading: 'website', markdown: '- Pricing\n- FAQ' });
    expect(md(swapped)).toBe('# Launch\n\n- Website\n  - Pricing\n  - FAQ\n- Press\n- Newsletter\n  - Tomás\n');
    const got = await content.getPage(a, bot, p.id);
    expect((got.content as MindmapContent).root.text).toBe('Launch');
  });

  it('refuses to edit a canvas as Markdown', async () => {
    const { a, bot, proj } = await setup();
    const c = await agentOps.createPage(a, bot, { projectId: proj.id, type: 'canvas', title: 'Flow' });
    await expect(agentOps.updatePage(a, bot, { pageId: c.id, mode: 'replace', markdown: 'x' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('a read token reads but never writes', async () => {
    const { a, ws, own, proj } = await setup();
    const reader = { workspaceId: ws.id, actor: agent(ws.id, 'read') };
    const p = await agentOps.createPage(a, own, { projectId: proj.id, type: 'doc', title: 'Brief', markdown: 'Hello' });
    expect(md(await agentOps.readPage(a, reader, p.id))).toBe('Hello\n');
    await expect(agentOps.updatePage(a, reader, { pageId: p.id, mode: 'append', markdown: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(agentOps.trashItem(a, reader, { kind: 'page', id: p.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('agents can trash but never delete permanently', async () => {
    const { a, bot, proj } = await setup();
    const p = await agentOps.createPage(a, bot, { projectId: proj.id, type: 'doc', title: 'Old' });
    await agentOps.trashItem(a, bot, { kind: 'page', id: p.id });
    await expect(trash.deleteForever(a, bot, 'page', p.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('agent task listing', () => {
  it('filters by project, status and due range', async () => {
    const { a, bot, proj } = await setup();
    const inbox = await tasks.createTask(a, bot, { title: 'Call Rafi', dueDate: '2030-01-10' });
    await tasks.createTask(a, bot, { title: 'Hero copy', projectId: proj.id, dueDate: '2030-01-20' });
    const done = await tasks.createTask(a, bot, { title: 'Pick photos', projectId: proj.id });
    await tasks.completeTask(a, bot, done.id, '2030-01-01');
    const titles = (ts: { title: string }[]) => ts.map((t) => t.title).sort();
    expect(titles(await agentOps.listTasks(a, bot, { status: 'open', limit: 100 }))).toEqual(['Call Rafi', 'Hero copy']);
    expect(titles(await agentOps.listTasks(a, bot, { projectId: 'inbox', status: 'open', limit: 100 }))).toEqual(['Call Rafi']);
    expect(titles(await agentOps.listTasks(a, bot, { projectId: proj.id, status: 'done', limit: 100 }))).toEqual(['Pick photos']);
    expect(titles(await agentOps.listTasks(a, bot, { status: 'any', dueFrom: '2030-01-15', dueTo: '2030-01-31', limit: 100 }))).toEqual(['Hero copy']);
    expect(titles(await agentOps.listTasks(a, bot, { view: 'today', today: '2030-01-10', status: 'open', limit: 100 }))).toEqual(['Call Rafi']);
    expect(inbox.createdBy).toBe('agent:Claude');
  });
});

describe('content written by agents', () => {
  it('blocks from Markdown are ordinary doc content the editor can open', async () => {
    const { a, bot, proj } = await setup();
    const p = await agentOps.createPage(a, bot, { projectId: proj.id, type: 'doc', title: 'T', markdown: '| A | B |\n|---|--:|\n| x | 1 |' });
    const got = await content.getPage(a, bot, p.id);
    expect((got.content as Block[])[0]!.type).toBe('table');
  });
});
