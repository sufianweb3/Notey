import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { libsqlAdapter } from '../src/adapters/db/libsql';
import { createApp } from '../src/server/app';
import { migrate } from '../src/server/db/migrate';
import type { DbAdapter } from '../src/server/db/types';
import type { Actor } from '../src/server/services/context';
import type { StorageAdapter } from '../src/server/storage';

export const ORIGIN = 'http://localhost';

/** A fresh SQLite file per test (in-memory libSQL loses tables across transactions). */
export async function makeDb(): Promise<DbAdapter> {
  const dir = mkdtempSync(join(tmpdir(), 'notey-test-'));
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  await client.execute('PRAGMA foreign_keys = ON');
  const adapter = libsqlAdapter(client);
  await migrate(adapter);
  return adapter;
}

export function memoryStorage(): StorageAdapter {
  const files = new Map<string, { data: Uint8Array; contentType: string }>();
  return {
    kind: 'disk',
    async put(key, body, { contentType }) {
      files.set(key, { data: new Uint8Array(body as ArrayBuffer), contentType });
    },
    async get(key) {
      const f = files.get(key);
      if (!f) return null;
      return { body: new Response(f.data as BodyInit).body!, contentType: f.contentType, size: f.data.length };
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

export async function makeApp() {
  const db = await makeDb();
  const app = createApp({
    db,
    storage: memoryStorage(),
    env: { NOTEY_SECRET: 'test-secret-'.padEnd(48, 'x'), PUBLIC_URL: ORIGIN },
  });
  return { app, db };
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>['app'];

/** Minimal client that keeps the session cookie between calls. */
export function client(app: TestApp, ip = '203.0.113.7') {
  let cookie = '';
  async function call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin: ORIGIN, 'x-notey-client-ip': ip };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await app.request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie();
    if (set.length) {
      cookie = set.map((c) => c.split(';')[0]).join('; ');
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: json as any };
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    signOut: () => {
      cookie = '';
    },
  };
}

export const OWNER = {
  name: 'Nadia Rahman',
  email: 'nadia@example.com',
  password: 'correct horse battery',
  workspaceName: 'Personal',
};

export async function setupOwner(app: TestApp) {
  const c = client(app);
  const res = await c.post('/api/setup', OWNER);
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.json)}`);
  return { c, workspace: res.json.workspace as { id: string; name: string } };
}

export const owner = (userId = 'owner-1'): Actor => ({ kind: 'user', userId, name: 'Nadia Rahman' });
export const agent = (workspaceId: string, scope: 'read' | 'write' = 'write'): Actor => ({
  kind: 'agent',
  tokenId: 'tok-1',
  name: 'Claude',
  workspaceId,
  scope,
});
