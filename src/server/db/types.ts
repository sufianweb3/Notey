import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/** Drizzle database over D1 or libSQL. Both are async SQLite. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NoteyDb = BaseSQLiteDatabase<'async', any, typeof schema>;

export type SqlStatement = { sql: string; params?: unknown[] };

/** Implemented in src/adapters/db/*. The server never imports a driver directly. */
export interface DbAdapter {
  readonly kind: 'd1' | 'libsql';
  readonly db: NoteyDb;
  /** Raw query, used by the migrator and locks. */
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Raw statement; returns affected rows. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Runs statements atomically, in order. */
  batch(statements: SqlStatement[]): Promise<void>;
}
