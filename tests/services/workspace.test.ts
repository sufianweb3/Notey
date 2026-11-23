import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changeLog, project, workspace } from '../../src/server/db/schema';
import * as svc from '../../src/server/services/workspace';
import { makeDb, owner } from '../helpers';

const ctx = { actor: owner() };
const wsCtx = (workspaceId: string) => ({ workspaceId, actor: owner() });

describe('workspace service', () => {
  it('creates workspaces in order and logs the change', async () => {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, ctx, { name: 'Personal', icon: 'P' });
    const b = await svc.createWorkspace(db, ctx, { name: 'Fevgo' });
    expect((await svc.listWorkspaces(db, ctx)).map((w) => w.name)).toEqual(['Personal', 'Fevgo']);
    expect(b.sort).toBeGreaterThan(a.sort);
    const log = await db.select().from(changeLog).where(eq(changeLog.workspaceId, a.id));
    expect(log).toMatchObject([{ entity: 'workspace', op: 'create', actor: 'user:owner-1' }]);
  });

  it('renames, sets and clears the icon', async () => {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, ctx, { name: 'Personal' });
    const renamed = await svc.updateWorkspace(db, wsCtx(a.id), { name: 'Home', icon: '🏡' });
    expect(renamed).toMatchObject({ name: 'Home', icon: '🏡' });
    const cleared = await svc.updateWorkspace(db, wsCtx(a.id), { icon: null });
    expect(cleared.icon).toBeNull();
  });

  it('reorders only with a complete, unique list', async () => {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, ctx, { name: 'A' });
    const b = await svc.createWorkspace(db, ctx, { name: 'B' });
    const c = await svc.createWorkspace(db, ctx, { name: 'C' });
    const out = await svc.reorderWorkspaces(db, ctx, [c.id, a.id, b.id]);
    expect(out.map((w) => w.name)).toEqual(['C', 'A', 'B']);
    await expect(svc.reorderWorkspaces(db, ctx, [a.id, b.id])).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.reorderWorkspaces(db, ctx, [a.id, a.id, b.id])).rejects.toMatchObject({ code: 'invalid' });
  });

  it('deletes to trash only when the name is typed exactly, and keeps one workspace', async () => {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, ctx, { name: 'Client A' });
    await expect(svc.deleteWorkspace(db, wsCtx(a.id), 'Client A')).rejects.toMatchObject({ code: 'conflict' });
    await svc.createWorkspace(db, ctx, { name: 'Client B' });
    await expect(svc.deleteWorkspace(db, wsCtx(a.id), 'client a')).rejects.toMatchObject({ code: 'invalid' });
    await svc.deleteWorkspace(db, wsCtx(a.id), 'Client A');
    expect((await svc.listWorkspaces(db, ctx)).map((w) => w.name)).toEqual(['Client B']);
    expect((await svc.listTrashedWorkspaces(db, ctx)).map((w) => w.name)).toEqual(['Client A']);
    await expect(svc.getWorkspace(db, wsCtx(a.id))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('restores from trash to the end of the list', async () => {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, ctx, { name: 'A' });
    await svc.createWorkspace(db, ctx, { name: 'B' });
    await svc.deleteWorkspace(db, wsCtx(a.id), 'A');
    await svc.restoreWorkspace(db, wsCtx(a.id));
    expect((await svc.listWorkspaces(db, ctx)).map((w) => w.name)).toEqual(['B', 'A']);
    await expect(svc.restoreWorkspace(db, wsCtx(a.id))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('purges workspaces after 30 days in trash, with their contents', async () => {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, ctx, { name: 'Old' });
    const b = await svc.createWorkspace(db, ctx, { name: 'Recent' });
    await svc.createWorkspace(db, ctx, { name: 'Keep' });
    await db.insert(project).values({ id: 'p1', workspaceId: a.id, name: 'Site', createdAt: new Date().toISOString() });
    await svc.deleteWorkspace(db, wsCtx(a.id), 'Old');
    await svc.deleteWorkspace(db, wsCtx(b.id), 'Recent');
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await db.update(workspace).set({ deletedAt: old }).where(eq(workspace.id, a.id));

    expect(await svc.purgeExpiredWorkspaces(db)).toBe(1);
    expect((await svc.listTrashedWorkspaces(db, ctx)).map((w) => w.name)).toEqual(['Recent']);
    expect(await db.select().from(project).where(eq(project.workspaceId, a.id))).toEqual([]);
    expect(await db.select().from(changeLog).where(eq(changeLog.workspaceId, a.id))).toEqual([]);
  });
});
