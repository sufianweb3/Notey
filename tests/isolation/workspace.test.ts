/**
 * Workspace isolation (CLAUDE.md hard rule 2). Every endpoint and service that
 * touches data gets a test here. Tokens arrive in M4; until then the agent
 * actor is exercised at the service layer, where the walls actually live.
 */
import { describe, expect, it } from 'vitest';
import * as svc from '../../src/server/services/workspace';
import { agent, client, makeApp, makeDb, owner } from '../helpers';

// The OpenAPI spec describes the API, not anything in it, so it's public too.
const PUBLIC = new Set(['GET /api/health', 'GET /api/setup', 'POST /api/setup', 'GET /api/auth/*', 'POST /api/auth/*', 'GET /api/v1/openapi.json']);

describe('HTTP: every /api endpoint needs the owner session', () => {
  it('returns 401 without a session for every non-public route', async () => {
    const { app } = await makeApp();
    const routes = app.routes.filter(
      (r) => r.path.startsWith('/api/') && r.method !== 'ALL' && !PUBLIC.has(`${r.method} ${r.path}`),
    );
    expect(routes.length).toBeGreaterThanOrEqual(9);
    const c = client(app);
    for (const r of routes) {
      const path = r.path.replace(/:\w+/g, 'some-id');
      const res =
        r.method === 'GET'
          ? await c.get(path)
          : r.method === 'PATCH'
            ? await c.patch(path, { name: 'x' })
            : await c.post(path, {});
      expect.soft(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});

describe('service: an agent bound to workspace A', () => {
  async function twoWorkspaces() {
    const { db } = await makeDb();
    const a = await svc.createWorkspace(db, { actor: owner() }, { name: 'Client A' });
    const b = await svc.createWorkspace(db, { actor: owner() }, { name: 'Client B' });
    return { db, a, b, bot: agent(a.id) };
  }

  it('lists only workspace A', async () => {
    const { db, a, bot } = await twoWorkspaces();
    expect((await svc.listWorkspaces(db, { actor: bot })).map((w) => w.id)).toEqual([a.id]);
  });

  it('cannot read B, and B looks like it does not exist', async () => {
    const { db, b, bot } = await twoWorkspaces();
    await expect(svc.getWorkspace(db, { workspaceId: b.id, actor: bot })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('can read A', async () => {
    const { db, a, bot } = await twoWorkspaces();
    expect((await svc.getWorkspace(db, { workspaceId: a.id, actor: bot })).name).toBe('Client A');
  });

  it('cannot create, rename, reorder, delete, restore or list trash in any workspace', async () => {
    const { db, a, b, bot } = await twoWorkspaces();
    const forbidden = { code: 'forbidden' };
    await expect(svc.createWorkspace(db, { actor: bot }, { name: 'X' })).rejects.toMatchObject(forbidden);
    for (const id of [a.id, b.id]) {
      const ctx = { workspaceId: id, actor: bot };
      await expect(svc.updateWorkspace(db, ctx, { name: 'Hacked' })).rejects.toMatchObject(forbidden);
      await expect(svc.deleteWorkspace(db, ctx, 'Client A')).rejects.toMatchObject(forbidden);
      await expect(svc.restoreWorkspace(db, ctx)).rejects.toMatchObject(forbidden);
    }
    await expect(svc.reorderWorkspaces(db, { actor: bot }, [b.id, a.id])).rejects.toMatchObject(forbidden);
    await expect(svc.listTrashedWorkspaces(db, { actor: bot })).rejects.toMatchObject(forbidden);
    expect((await svc.listWorkspaces(db, { actor: owner() })).map((w) => w.name)).toEqual(['Client A', 'Client B']);
  });
});
