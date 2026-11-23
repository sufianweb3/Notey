import { migrations as bundled, type Migration } from './migrations/index';
import type { DbAdapter } from './types';

const BOOKKEEPING = [
  `CREATE TABLE IF NOT EXISTS __notey_migrations (tag TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS __notey_lock (name TEXT PRIMARY KEY NOT NULL, holder TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
];

/**
 * Takes a named lock row. Returns a release function, or null if someone else
 * holds an unexpired lock. Works on D1 and libSQL (single statement upsert).
 */
export async function acquireLock(adapter: DbAdapter, name: string, ttlMs: number) {
  const holder = crypto.randomUUID();
  const now = Date.now();
  await adapter.run(
    `INSERT INTO __notey_lock (name, holder, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
     WHERE __notey_lock.expires_at < ?`,
    [name, holder, now + ttlMs, now],
  );
  const rows = await adapter.all(`SELECT holder FROM __notey_lock WHERE name = ?`, [name]);
  if (rows[0]?.holder !== holder) return null;
  return async () => {
    await adapter.run(`DELETE FROM __notey_lock WHERE name = ? AND holder = ?`, [name, holder]);
  };
}

export async function ensureBookkeeping(adapter: DbAdapter) {
  await adapter.batch(BOOKKEEPING.map((sql) => ({ sql })));
}

export async function appliedTags(adapter: DbAdapter): Promise<Set<string>> {
  const rows = await adapter.all(`SELECT tag FROM __notey_migrations`);
  return new Set(rows.map((r) => String(r.tag)));
}

export type MigrateResult = { applied: string[]; total: number };

/**
 * Applies pending migrations, guarded by a lock row so concurrent cold starts
 * don't race. Waits up to `waitMs` for another holder to finish.
 */
export async function migrate(
  adapter: DbAdapter,
  list: Migration[] = bundled,
  { waitMs = 8000 }: { waitMs?: number } = {},
): Promise<MigrateResult> {
  await ensureBookkeeping(adapter);
  const deadline = Date.now() + waitMs;
  for (;;) {
    const done = await appliedTags(adapter);
    const pending = list.filter((m) => !done.has(m.tag));
    if (pending.length === 0) return { applied: [], total: list.length };

    const release = await acquireLock(adapter, 'migrate', 60_000);
    if (release) {
      try {
        const again = await appliedTags(adapter);
        const applied: string[] = [];
        for (const m of list) {
          if (again.has(m.tag)) continue;
          await adapter.batch([
            ...m.statements.map((sql) => ({ sql })),
            {
              sql: `INSERT INTO __notey_migrations (tag, applied_at) VALUES (?, ?)`,
              params: [m.tag, new Date().toISOString()],
            },
          ]);
          applied.push(m.tag);
        }
        return { applied, total: list.length };
      } finally {
        await release();
      }
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for the migration lock');
    await new Promise((r) => setTimeout(r, 250));
  }
}
