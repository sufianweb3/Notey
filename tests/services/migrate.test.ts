import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { libsqlAdapter } from '../../src/adapters/db/libsql';
import { acquireLock, migrate } from '../../src/server/db/migrate';
import { migrations } from '../../src/server/db/migrations/index';

function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), 'notey-mig-'));
  return libsqlAdapter(createClient({ url: `file:${join(dir, 'm.db')}` }));
}

describe('migrate', () => {
  it('applies every bundled migration once and is idempotent', async () => {
    const db = freshAdapter();
    const first = await migrate(db);
    expect(first.applied).toEqual(migrations.map((m) => m.tag));
    const second = await migrate(db);
    expect(second.applied).toEqual([]);
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`);
    const names = tables.map((t) => t.name);
    for (const t of ['user', 'session', 'workspace', 'page', 'task', 'change_log', 'api_token']) {
      expect(names).toContain(t);
    }
  });

  it('applies a migration only once under concurrent cold starts', async () => {
    const db = freshAdapter();
    const results = await Promise.all([migrate(db), migrate(db), migrate(db)]);
    const applied = results.flatMap((r) => r.applied);
    expect(applied).toEqual(migrations.map((m) => m.tag));
    const rows = await db.all(`SELECT COUNT(*) AS n FROM __notey_migrations`);
    expect(Number(rows[0]?.n)).toBe(migrations.length);
  });

  it('applies new migrations added later', async () => {
    const db = freshAdapter();
    await migrate(db);
    const next = [...migrations, { tag: '9999_test', statements: ['CREATE TABLE later_t (id TEXT PRIMARY KEY)'] }];
    const res = await migrate(db, next);
    expect(res.applied).toEqual(['9999_test']);
  });

  it('lock rows exclude a second holder until released or expired', async () => {
    const db = freshAdapter();
    await migrate(db);
    const release = await acquireLock(db, 'x', 60_000);
    expect(release).not.toBeNull();
    expect(await acquireLock(db, 'x', 60_000)).toBeNull();
    await release!();
    const again = await acquireLock(db, 'x', -1); // already expired
    expect(again).not.toBeNull();
    expect(await acquireLock(db, 'x', 60_000)).not.toBeNull();
  });
});
