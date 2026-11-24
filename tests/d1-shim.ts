import type { Client, InValue } from '@libsql/client';
import type { D1Like, D1StatementLike } from '../src/server/db/gateway';

/**
 * Just enough of the D1 binding API over a libSQL client, so tests can run the
 * real gateway handler (and the Vercel adapter in front of it) without workerd.
 */
type Stmt = D1StatementLike & { readonly sql: string; readonly args: InValue[] };

export function d1Shim(client: Client): D1Like {
  const make = (sql: string, args: InValue[] = []): Stmt => ({
    sql,
    args,
    bind: (...values) => make(sql, values as InValue[]),
    async raw<T>() {
      const r = await client.execute({ sql, args });
      const rows = r.rows.map((row) => r.columns.map((_, i) => row[i]));
      return [r.columns, ...rows] as unknown as [string[], ...T[]];
    },
    async run() {
      const r = await client.execute({ sql, args });
      return { meta: { changes: r.rowsAffected } };
    },
  });
  return {
    prepare: (sql) => make(sql),
    async batch(statements) {
      // Like D1, a batch is one transaction.
      await client.batch(
        (statements as Stmt[]).map((s) => ({ sql: s.sql, args: s.args })),
        'write',
      );
      return [];
    },
  };
}
