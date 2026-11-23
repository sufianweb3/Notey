import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Block } from '../../../shared/blocks';
import {
  createFolderInput,
  createPageInput,
  createProjectInput,
  itemRefInput,
  MAX_UPLOAD_BYTES,
  moveInput,
  renameFolderInput,
  saveContentInput,
  updatePageInput,
  updateProjectInput,
} from '../../../shared/schemas';
import type { AppEnv, Deps } from '../../hono-env';
import { listChanges } from '../../services/changes';
import * as content from '../../services/content';
import type { WsCtx } from '../../services/context';
import { readFile, uploadFile } from '../../services/files';
import { searchPages } from '../../services/search';
import * as trash from '../../services/trash';
import * as versions from '../../services/versions';
import { errorJson, validationHook } from './errors';

/**
 * Everything inside one workspace: /api/workspaces/:wsId/*. The workspace id
 * always comes from the path, never from a body (CLAUDE.md rule 2).
 */
export function contentRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const a = deps.adapter;
  const ctx = (c: Context<AppEnv>): WsCtx => ({ workspaceId: c.req.param('wsId')!, actor: c.get('actor') });
  const json = <S extends Parameters<typeof zValidator>[1]>(schema: S) => zValidator('json', schema, validationHook);

  r.get('/tree', async (c) => c.json(await content.getTree(a, ctx(c))));

  // Projects
  r.post('/projects', json(createProjectInput), async (c) => c.json({ project: await content.createProject(a, ctx(c), c.req.valid('json')) }, 201));
  r.patch('/projects/:id', json(updateProjectInput), async (c) =>
    c.json({ project: await content.updateProject(a, ctx(c), c.req.param('id'), c.req.valid('json')) }),
  );

  // Folders
  r.post('/folders', json(createFolderInput), async (c) => c.json({ folder: await content.createFolder(a, ctx(c), c.req.valid('json')) }, 201));
  r.patch('/folders/:id', json(renameFolderInput), async (c) =>
    c.json({ folder: await content.renameFolder(a, ctx(c), c.req.param('id'), c.req.valid('json').name) }),
  );

  // Pages
  r.post('/pages', json(createPageInput), async (c) => c.json({ page: await content.createPage(a, ctx(c), c.req.valid('json')) }, 201));
  r.get('/pages/:id', async (c) => c.json({ page: await content.getPage(a, ctx(c), c.req.param('id')) }));
  r.patch('/pages/:id', json(updatePageInput), async (c) =>
    c.json({ page: await content.updatePageMeta(a, ctx(c), c.req.param('id'), c.req.valid('json')) }),
  );
  r.put('/pages/:id/content', bodyLimit({ maxSize: 2_500_000 }), json(saveContentInput), async (c) => {
    const body = c.req.valid('json');
    return c.json(await content.savePageContent(a, ctx(c), c.req.param('id'), { rev: body.rev, content: body.content as Block[] }));
  });
  r.post('/pages/:id/duplicate', async (c) => c.json({ page: await content.duplicatePage(a, ctx(c), c.req.param('id')) }, 201));
  r.get('/pages/:id/markdown', async (c) => {
    const p = await content.getPage(a, ctx(c), c.req.param('id'));
    const name = (p.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-');
    const md = `# ${p.title || 'Untitled'}\n\n${p.contentMd}`;
    return c.body(md, 200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.md`,
    });
  });

  // History
  r.get('/pages/:id/versions', async (c) => c.json({ versions: await versions.listVersions(a, ctx(c), c.req.param('id')) }));
  r.post('/pages/:id/versions', async (c) => c.json({ version: await versions.createSnapshot(a, ctx(c), c.req.param('id')) }, 201));
  r.get('/pages/:id/versions/:vid', async (c) =>
    c.json({ version: await versions.getVersion(a, ctx(c), c.req.param('id'), c.req.param('vid')) }),
  );
  r.post('/pages/:id/versions/:vid/restore', async (c) =>
    c.json({ page: await versions.restoreVersion(a, ctx(c), c.req.param('id'), c.req.param('vid')) }),
  );

  // Move, trash
  r.post('/move', json(moveInput), async (c) => {
    await content.moveItem(a, ctx(c), c.req.valid('json'));
    return c.json({ ok: true });
  });
  r.get('/trash', async (c) => c.json({ items: await trash.listTrash(a, ctx(c)) }));
  r.post('/trash', json(itemRefInput), async (c) => {
    const { kind, id } = c.req.valid('json');
    await trash.trashItem(a, ctx(c), kind, id);
    return c.json({ ok: true });
  });
  r.post('/trash/restore', json(itemRefInput), async (c) => {
    const { kind, id } = c.req.valid('json');
    await trash.restoreItem(a, ctx(c), kind, id);
    return c.json({ ok: true });
  });
  r.post('/trash/delete', json(itemRefInput), async (c) => {
    const { kind, id } = c.req.valid('json');
    await trash.deleteForever(a, ctx(c), kind, id);
    return c.json({ ok: true });
  });

  // Search and live refresh
  r.get('/search', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 50);
    return c.json({ results: await searchPages(a, ctx(c), c.req.query('q') ?? '', limit) });
  });
  r.get('/changes', async (c) => {
    const since = c.req.query('since');
    const n = since === undefined ? null : Number(since);
    return c.json(await listChanges(a, ctx(c), n === null || Number.isFinite(n) ? n : null));
  });

  // Files
  r.post('/files', bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 64 * 1024, onError: (c) => errorJson(c, 'invalid', 'Files can be up to 25 MB.', 413) }), async (c) => {
    const form = await c.req.parseBody();
    const f = form.file;
    if (!(f instanceof File)) return errorJson(c, 'invalid', 'Attach a file in the "file" field.', 400);
    const info = await uploadFile(a, deps.storage, ctx(c), { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return c.json({ file: info }, 201);
  });
  r.get('/files/:id', async (c) => {
    const { object, headers } = await readFile(a, deps.storage, ctx(c), c.req.param('id'));
    return new Response(object.body, { headers });
  });

  return r;
}
