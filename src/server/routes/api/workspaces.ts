import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  createWorkspaceInput,
  deleteWorkspaceInput,
  reorderWorkspacesInput,
  updateWorkspaceInput,
} from '../../../shared/schemas';
import type { AppEnv, Deps } from '../../hono-env';
import * as svc from '../../services/workspace';
import { validationHook } from './errors';

export function workspaceRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const ctx = (c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) => ({ actor: c.get('actor') });

  r.get('/', async (c) => {
    await svc.purgeExpiredWorkspaces(deps.db);
    return c.json({ workspaces: await svc.listWorkspaces(deps.db, ctx(c)) });
  });

  r.get('/trash', async (c) => c.json({ workspaces: await svc.listTrashedWorkspaces(deps.db, ctx(c)) }));

  r.post('/', zValidator('json', createWorkspaceInput, validationHook), async (c) => {
    const ws = await svc.createWorkspace(deps.db, ctx(c), c.req.valid('json'));
    return c.json({ workspace: ws }, 201);
  });

  r.post('/reorder', zValidator('json', reorderWorkspacesInput, validationHook), async (c) => {
    return c.json({ workspaces: await svc.reorderWorkspaces(deps.db, ctx(c), c.req.valid('json').ids) });
  });

  r.get('/:id', async (c) => {
    const ws = await svc.getWorkspace(deps.db, { workspaceId: c.req.param('id'), actor: c.get('actor') });
    return c.json({ workspace: ws });
  });

  r.patch('/:id', zValidator('json', updateWorkspaceInput, validationHook), async (c) => {
    const ws = await svc.updateWorkspace(
      deps.db,
      { workspaceId: c.req.param('id'), actor: c.get('actor') },
      c.req.valid('json'),
    );
    return c.json({ workspace: ws });
  });

  r.post('/:id/delete', zValidator('json', deleteWorkspaceInput, validationHook), async (c) => {
    await svc.deleteWorkspace(
      deps.db,
      { workspaceId: c.req.param('id'), actor: c.get('actor') },
      c.req.valid('json').confirmName,
    );
    return c.json({ ok: true });
  });

  r.post('/:id/restore', async (c) => {
    const ws = await svc.restoreWorkspace(deps.db, { workspaceId: c.req.param('id'), actor: c.get('actor') });
    return c.json({ workspace: ws });
  });

  return r;
}
