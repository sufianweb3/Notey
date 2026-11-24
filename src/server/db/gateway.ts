import { timingSafeEqual } from '../auth/password';

/*
 * D1 gateway (PRD "Calls made", M1+): a tiny Worker that runs SQL against a
 * D1 binding for the Vercel deploy, which has no D1 binding of its own.
 * Callers must send `Authorization: Bearer <GATEWAY_SECRET>`. The protocol is
 * deliberately small: one query, one write, or an atomic batch.
 */

export type GatewayStatement = { sql: string; params?: unknown[] };
export type GatewayRequest =
  | { op: 'query'; sql: string; params?: unknown[] }
  | { op: 'run'; sql: string; params?: unknown[] }
  | { op: 'batch'; statements: GatewayStatement[] };

export type GatewayQueryResult = { columns: string[]; rows: unknown[][] };
export type GatewayRunResult = { changes: number };

/** The parts of D1Database the gateway uses (so tests can supply a stand-in). */
export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  run(): Promise<{ meta: { changes?: number } }>;
}

const MAX_BODY = 4 * 1024 * 1024;
const MAX_STATEMENTS = 500;
const enc = new TextEncoder();

async function digest(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function isStatement(v: unknown): v is GatewayStatement {
  const s = v as GatewayStatement;
  return !!s && typeof s.sql === 'string' && s.sql.length > 0 && (s.params === undefined || Array.isArray(s.params));
}

export async function handleGateway(request: Request, env: { db: D1Like; secret: string | undefined }): Promise<Response> {
  if (!env.secret || env.secret.length < 32) return json({ error: { message: 'Gateway secret is not configured' } }, 500);
  if (request.method !== 'POST') return json({ error: { message: 'POST only' } }, 405);

  // Compare digests so the check takes the same time whatever the input length.
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(await digest(given), await digest(env.secret))) {
    return json({ error: { message: 'Unauthorized' } }, 401);
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY) return json({ error: { message: 'Request too large' } }, 413);
  let body: GatewayRequest;
  try {
    body = (await request.json()) as GatewayRequest;
  } catch {
    return json({ error: { message: 'Invalid JSON' } }, 400);
  }

  const prep = (s: GatewayStatement) => {
    const stmt = env.db.prepare(s.sql);
    return s.params?.length ? stmt.bind(...s.params) : stmt;
  };

  try {
    if (body.op === 'query' && isStatement(body)) {
      const [columns, ...rows] = await prep(body).raw({ columnNames: true });
      return json({ columns, rows } satisfies GatewayQueryResult);
    }
    if (body.op === 'run' && isStatement(body)) {
      const res = await prep(body).run();
      return json({ changes: res.meta.changes ?? 0 } satisfies GatewayRunResult);
    }
    if (body.op === 'batch' && Array.isArray(body.statements) && body.statements.every(isStatement)) {
      if (body.statements.length > MAX_STATEMENTS) return json({ error: { message: 'Too many statements' } }, 400);
      // D1 runs a batch as one transaction.
      if (body.statements.length) await env.db.batch(body.statements.map(prep));
      return json({ ok: true });
    }
    return json({ error: { message: 'Unknown operation' } }, 400);
  } catch (e) {
    // SQL errors (constraint violations, syntax) go back to the caller, which rethrows them.
    return json({ error: { message: e instanceof Error ? e.message : String(e) } }, 400);
  }
}
