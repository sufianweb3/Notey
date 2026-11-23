import type { Client, InValue } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../../server/db/schema';
import type { DbAdapter } from '../../server/db/types';

/**
 * Takes a libSQL client created by the entry file: `@libsql/client` for a
 * local file (Node/Docker), `@libsql/client/web` for Turso over HTTP (Vercel).
 */
export function libsqlAdapter(client: Client): DbAdapter {
  const args = (params?: unknown[]) => (params ?? []) as InValue[];
  return {
    kind: 'libsql',
    db: drizzle(client, { schema }),
    async all(sql, params) {
      const res = await client.execute({ sql, args: args(params) });
      return res.rows.map((row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]])));
    },
    async run(sql, params) {
      const res = await client.execute({ sql, args: args(params) });
      return { changes: res.rowsAffected };
    },
    async batch(statements) {
      if (!statements.length) return;
      await client.batch(
        statements.map((s) => ({ sql: s.sql, args: args(s.params) })),
        'write',
      );
    },
  };
}
