import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { GatewayQueryResult, GatewayRequest, GatewayRunResult, GatewayStatement } from '../../server/db/gateway';
import * as schema from '../../server/db/schema';
import type { DbAdapter } from '../../server/db/types';

/**
 * D1 reached over HTTPS through the gateway Worker (src/entry/d1-gateway.ts).
 * Used by the Vercel entry when no Turso database is configured.
 */
export function d1GatewayAdapter(opts: { url: string; secret: string; fetch?: typeof fetch }): DbAdapter {
  const doFetch = opts.fetch ?? fetch;

  async function call<T>(body: GatewayRequest): Promise<T> {
    const res = await doFetch(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.secret}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: { message: string } }) | null;
    if (!res.ok || !data) throw new Error(data?.error?.message ?? `D1 gateway error ${res.status}`);
    return data;
  }

  const query = (sql: string, params?: unknown[]) => call<GatewayQueryResult>({ op: 'query', sql, params });

  const db = drizzle(
    async (sql, params, method) => {
      if (method === 'run') {
        await call<GatewayRunResult>({ op: 'run', sql, params });
        return { rows: [] };
      }
      const { rows } = await query(sql, params);
      // sqlite-proxy: "get" expects one row (or nothing), "all"/"values" an array of rows.
      return { rows: method === 'get' ? (rows[0] as unknown[]) : rows };
    },
    async (batch) => {
      // Only drizzle's db.batch() uses this; Notey runs its own batches through adapter.batch.
      const out: { rows: unknown[] }[] = [];
      for (const q of batch) {
        if (q.method === 'run') {
          await call<GatewayRunResult>({ op: 'run', sql: q.sql, params: q.params });
          out.push({ rows: [] });
        } else {
          const { rows } = await query(q.sql, q.params);
          out.push({ rows: q.method === 'get' ? (rows[0] as unknown[]) : rows });
        }
      }
      return out;
    },
    { schema },
  );

  return {
    kind: 'd1',
    db,
    async all(sql, params) {
      const { columns, rows } = await query(sql, params);
      return rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
    },
    async run(sql, params) {
      return call<GatewayRunResult>({ op: 'run', sql, params });
    },
    async batch(statements: GatewayStatement[]) {
      if (statements.length) await call({ op: 'batch', statements });
    },
  };
}
