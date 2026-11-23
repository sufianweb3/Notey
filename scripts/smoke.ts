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
