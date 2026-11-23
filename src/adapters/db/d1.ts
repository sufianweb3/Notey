import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../server/db/schema';
import type { DbAdapter, SqlStatement } from '../../server/db/types';

export function d1Adapter(d1: D1Database): DbAdapter {
  const prep = (s: SqlStatement) => {
    const stmt = d1.prepare(s.sql);
    return s.params?.length ? stmt.bind(...s.params) : stmt;
  };
  return {
    kind: 'd1',
    db: drizzle(d1, { schema }),
    async all(sql, params) {
      const res = await prep({ sql, params }).all<Record<string, unknown>>();
      return res.results;
    },
    async run(sql, params) {
      const res = await prep({ sql, params }).run();
      return { changes: res.meta.changes ?? 0 };
    },
    async batch(statements) {
      if (statements.length) await d1.batch(statements.map(prep));
    },
  };
}
