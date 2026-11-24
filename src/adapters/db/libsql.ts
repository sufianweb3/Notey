import type { Client, InValue } from '@libsql/client';
// The web entry only imports the pure-JS client, so bundles never pull in native libSQL;
// it still accepts any client instance (the Node entry passes the native one).
import { drizzle } from 'drizzle-orm/libsql/web';
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
