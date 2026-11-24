import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { d1GatewayAdapter } from '../../src/adapters/db/d1-gateway';
import { handleGateway } from '../../src/server/db/gateway';
import { migrate } from '../../src/server/db/migrate';
import { workspace } from '../../src/server/db/schema';
import { d1Shim } from '../d1-shim';

const SECRET = 'a-gateway-secret-that-is-long-enough-123456';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'notey-gw-'));
  const db = d1Shim(createClient({ url: `file:${join(dir, 'g.db')}` }));
  const send = (body: unknown, init: { secret?: string | null; method?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.secret !== null) headers.authorization = `Bearer ${init.secret ?? SECRET}`;
    return handleGateway(
      new Request('http://gw.test/', { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : JSON.stringify(body) }),
      { db, secret: SECRET },
    );
  };
  const adapter = d1GatewayAdapter({
    url: 'http://gw.test/',
    secret: SECRET,
    fetch: (input, init) => handleGateway(new Request(input, init), { db, secret: SECRET }),
  });
  return { db, send, adapter };
}

describe('D1 gateway', () => {
  it('rejects missing or wrong secrets, other methods, and an unconfigured secret', async () => {
    const { send, db } = setup();
    expect((await send({ op: 'query', sql: 'SELECT 1' }, { secret: null })).status).toBe(401);
    expect((await send({ op: 'query', sql: 'SELECT 1' }, { secret: 'wrong' })).status).toBe(401);
    expect((await send({ op: 'query', sql: 'SELECT 1' }, { secret: `${SECRET}x` })).status).toBe(401);
    expect((await send(null, { method: 'GET' })).status).toBe(405);
    const unconfigured = await handleGateway(new Request('http://gw.test/', { method: 'POST', body: '{}' }), { db, secret: '' });
    expect(unconfigured.status).toBe(500);
  });

  it('rejects bad JSON and unknown operations', async () => {
    const { send } = setup();
    const bad = await handleGateway(
      new Request('http://gw.test/', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body: '{nope' }),
      { db: setup().db, secret: SECRET },
    );
    expect(bad.status).toBe(400);
    expect((await send({ op: 'drop-everything' })).status).toBe(400);
    expect((await send({ op: 'query', sql: '' })).status).toBe(400);
  });

  it('returns columns and positional rows, and changes for writes', async () => {
    const { send } = setup();
    await send({ op: 'run', sql: 'CREATE TABLE t (id INTEGER, name TEXT)' });
    const ins = await (await send({ op: 'run', sql: 'INSERT INTO t VALUES (?, ?), (?, ?)', params: [1, 'Rafi', 2, 'Mei'] })).json();
    expect(ins).toEqual({ changes: 2 });
    const q = await (await send({ op: 'query', sql: 'SELECT id, name, name AS n2 FROM t ORDER BY id' })).json();
    expect(q).toEqual({ columns: ['id', 'name', 'n2'], rows: [[1, 'Rafi', 'Rafi'], [2, 'Mei', 'Mei']] });
  });

  it('runs a batch atomically', async () => {
    const { send, adapter } = setup();
    await send({ op: 'run', sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY)' });
    const res = await send({
      op: 'batch',
      statements: [{ sql: 'INSERT INTO t VALUES (1)' }, { sql: 'INSERT INTO t VALUES (1)' }],
    });
    expect(res.status).toBe(400);
    expect(await adapter.all('SELECT COUNT(*) AS n FROM t')).toEqual([{ n: 0 }]);
  });

  it('surfaces SQL errors through the adapter', async () => {
    const { adapter } = setup();
    await expect(adapter.run('SELEC nonsense')).rejects.toThrow(/syntax|near/i);
  });

  it('runs migrations and Drizzle queries end to end, including get() with no row', async () => {
    const { adapter } = setup();
    await migrate(adapter);
    const now = new Date().toISOString();
    const [row] = await adapter.db
      .insert(workspace)
      .values({ id: 'w1', name: 'Fevgo', sort: 0, aiEnabled: true, createdAt: now })
      .returning();
    expect(row).toMatchObject({ id: 'w1', name: 'Fevgo', aiEnabled: true });
    const got = await adapter.db.select().from(workspace).where(eq(workspace.id, 'w1')).get();
    expect(got?.name).toBe('Fevgo');
    expect(await adapter.db.select().from(workspace).where(eq(workspace.id, 'missing')).get()).toBeUndefined();
  });
});
