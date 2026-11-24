/**
 * Smoke test a running Notey: `pnpm smoke <url> [--full]`.
 *
 * Without --full it only reads (safe on any instance). With --full it also
 * claims a fresh instance with a throwaway owner and exercises auth, workspace
 * CRUD and the storage adapter. Reset the database afterwards so the real
 * owner can run /setup (see scripts/reset-instance.sql).
 */
export {};

const base = process.argv[2]?.replace(/\/$/, '');
const full = process.argv.includes('--full');
if (!base) {
  console.error('Usage: pnpm smoke <url> [--full]');
  process.exit(2);
}

let cookie = '';
let failures = 0;

async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { origin: base! };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = res.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: json as any, text, type: res.headers.get('content-type') ?? '' };
}

async function check(name: string, fn: () => Promise<string | void>) {
  const t = performance.now();
  try {
    const note = await fn();
    console.log(`  ok   ${name}${note ? ` (${note})` : ''} ${Math.round(performance.now() - t)}ms`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

console.log(`Smoke testing ${base}${full ? ' (full)' : ''}`);
let needsSetup = false;

await check('SPA shell at /', async () => {
  const r = await call('GET', '/');
  expect(r.status === 200 && r.text.includes('id="root"'), `status ${r.status}`);
});
await check('SPA fallback for a client route', async () => {
  const r = await call('GET', '/settings/workspaces');
  expect(r.status === 200 && r.text.includes('id="root"'), `status ${r.status}`);
});
await check('health, migrations applied', async () => {
  const r = await call('GET', '/api/health');
  expect(r.status === 200 && r.json.ok === true && r.json.migrations >= 1, JSON.stringify(r.json));
  return `db=${r.json.db} storage=${r.json.storage} migrations=${r.json.migrations} v${r.json.version}`;
});
await check('setup status', async () => {
  const r = await call('GET', '/api/setup');
  expect(r.status === 200 && typeof r.json.needsSetup === 'boolean', JSON.stringify(r.json));
  needsSetup = r.json.needsSetup;
  return `needsSetup=${needsSetup}`;
});
await check('public sign-up is closed', async () => {
  const r = await call('POST', '/api/auth/sign-up/email', { name: 'x', email: 'x@example.com', password: 'xxxxxxxxxxxx' });
  expect(r.status === 403, `status ${r.status}`);
});
await check('owner routes need a session', async () => {
  const r = await call('GET', '/api/workspaces');
  expect(r.status === 401, `status ${r.status}`);
});
await check('unknown API path is a JSON error, not the SPA', async () => {
  // Signed out, unknown paths answer 401 so route names don't leak.
  const r = await call('GET', '/api/does-not-exist');
  expect([401, 404].includes(r.status) && r.json?.error?.code, `status ${r.status}`);
});

if (full) {
  if (!needsSetup) {
    console.log('  skip full flow: instance already has an owner');
  } else {
    const email = `smoke-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const password = crypto.randomUUID();
    let wsId = '';
    let secondId = '';
    await check('setup creates owner, workspace, session', async () => {
      const r = await call('POST', '/api/setup', { name: 'Smoke Test', email, password, workspaceName: 'Smoke' });
      expect(r.status === 201, `status ${r.status} ${r.text.slice(0, 200)}`);
      wsId = r.json.workspace.id;
    });
    await check('session works', async () => {
      const r = await call('GET', '/api/me');
      expect(r.status === 200 && r.json.user.email === email, `status ${r.status}`);
    });
    await check('setup cannot run twice', async () => {
      const saved = cookie;
      cookie = '';
      const r = await call('POST', '/api/setup', { name: 'M', email: 'm@example.com', password: 'mmmmmmmmmmmm', workspaceName: 'M' });
      cookie = saved;
      expect(r.status === 409, `status ${r.status}`);
    });
    await check('create, rename, reorder workspaces', async () => {
      const c = await call('POST', '/api/workspaces', { name: 'Second', icon: 'S' });
      expect(c.status === 201, `create ${c.status}`);
      secondId = c.json.workspace.id;
      const u = await call('PATCH', `/api/workspaces/${secondId}`, { name: 'Second renamed' });
      expect(u.json.workspace?.name === 'Second renamed', `rename ${u.status}`);
      const o = await call('POST', '/api/workspaces/reorder', { ids: [secondId, wsId] });
      expect(o.json.workspaces?.[0]?.id === secondId, `reorder ${o.status}`);
    });
    await check('delete to trash and restore', async () => {
      const bad = await call('POST', `/api/workspaces/${secondId}/delete`, { confirmName: 'wrong' });
      expect(bad.status === 400, `wrong name ${bad.status}`);
      const d = await call('POST', `/api/workspaces/${secondId}/delete`, { confirmName: 'Second renamed' });
      expect(d.status === 200, `delete ${d.status}`);
      const t = await call('GET', '/api/workspaces/trash');
      expect(t.json.workspaces.some((w: { id: string }) => w.id === secondId), 'not in trash');
      const r = await call('POST', `/api/workspaces/${secondId}/restore`, {});
      expect(r.status === 200, `restore ${r.status}`);
    });
    await check('M1: project, page, rev-checked save, search, trash and restore', async () => {
      const W = `/api/workspaces/${wsId}`;
      const p = await call('POST', `${W}/projects`, { name: 'Smoke project' });
      expect(p.status === 201, `project ${p.status}`);
      const pg = await call('POST', `${W}/pages`, { projectId: p.json.project.id, type: 'doc', title: 'Smoke page' });
      expect(pg.status === 201, `page ${pg.status}`);
      const id = pg.json.page.id;
      const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Zanzibar quokka smoke', styles: {} }] }];
      const saved = await call('PUT', `${W}/pages/${id}/content`, { rev: 0, content });
      expect(saved.status === 200 && saved.json.rev === 1, `save ${saved.status} ${saved.text.slice(0, 120)}`);
      const stale = await call('PUT', `${W}/pages/${id}/content`, { rev: 0, content });
      expect(stale.status === 409, `stale save ${stale.status}`);
      const hits = await call('GET', `${W}/search?q=quokk`);
      expect(hits.json.results?.[0]?.id === id, `search ${JSON.stringify(hits.json).slice(0, 120)}`);
      const t = await call('POST', `${W}/trash`, { kind: 'page', id });
      expect(t.status === 200, `trash ${t.status}`);
      expect((await call('GET', `${W}/search?q=quokka`)).json.results.length === 0, 'trashed page still in search');
      const r = await call('POST', `${W}/trash/restore`, { kind: 'page', id });
      expect(r.status === 200, `restore ${r.status}`);
    });
    await check('M2: repeating task completes to the next date, counts, pin', async () => {
      const W = `/api/workspaces/${wsId}`;
      const today = '2030-01-07'; // a Monday, so the result doesn't depend on the clock
      const t = await call('POST', `${W}/tasks`, { title: 'Smoke standup', dueDate: today, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' });
      expect(t.status === 201, `task ${t.status} ${t.text.slice(0, 120)}`);
      const id = t.json.task.id;
      const counts = await call('GET', `${W}/tasks/counts?today=${today}`);
      expect(counts.json.today >= 1, `counts ${counts.text.slice(0, 120)}`);
      const done = await call('POST', `${W}/tasks/${id}/complete`, { today });
      expect(done.json.task?.dueDate === '2030-01-09' && done.json.task.status === 'todo', `complete ${done.text.slice(0, 160)}`);
      const undo = await call('POST', `${W}/tasks/${id}/uncomplete`, {});
      expect(undo.json.task?.dueDate === today, `uncomplete ${undo.text.slice(0, 160)}`);
      const pin = await call('POST', `${W}/pins`, { itemType: 'task', itemId: id });
      expect(pin.status === 201, `pin ${pin.status}`);
      const pins = await call('GET', `${W}/pins`);
      expect(pins.json.pins?.some((p: { itemId: string }) => p.itemId === id), 'pin not listed');
    });
    await check('M1: upload, sniffed type, sandboxed serve', async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'text/plain' }), 'pixel.txt');
      const up = await fetch(`${base}/api/workspaces/${wsId}/files`, { method: 'POST', body: form, headers: { origin: base!, cookie } });
      const json = (await up.json()) as { file?: { url: string; mime: string } };
      expect(up.status === 201 && json.file?.mime === 'image/png', `upload ${up.status} ${JSON.stringify(json).slice(0, 120)}`);
      const got = await fetch(base + json.file!.url, { headers: { cookie } });
      expect(got.status === 200 && (got.headers.get('content-security-policy') ?? '').includes('sandbox'), `serve ${got.status}`);
      return `mime=${json.file!.mime}`;
    });
    await check('storage adapter round trip', async () => {
      const r = await call('POST', '/api/selftest/storage', {});
      expect(r.status === 200 && r.json.ok, JSON.stringify(r.json));
      return `storage=${r.json.storage}`;
    });
    await check('sign out, then sign in again', async () => {
      await call('POST', '/api/auth/sign-out', {});
      const me = await call('GET', '/api/me');
      expect(me.status === 401, `after sign-out ${me.status}`);
      const s = await call('POST', '/api/auth/sign-in/email', { email, password });
      expect(s.status === 200, `sign-in ${s.status} ${s.text.slice(0, 200)}`);
      expect((await call('GET', '/api/me')).status === 200, 'session after sign-in');
    });
    await check('wrong password is rejected', async () => {
      const r = await call('POST', '/api/auth/sign-in/email', { email, password: 'not-the-password' });
      expect(r.status === 401, `status ${r.status}`);
    });
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
