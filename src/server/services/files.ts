import { and, eq } from 'drizzle-orm';
import { nowIso, uuidv7 } from '../../shared/ids';
import { MAX_UPLOAD_BYTES, type FileInfo } from '../../shared/schemas';
import { file } from '../db/schema';
import type { DbAdapter } from '../db/types';
import type { StorageAdapter, StoredObject } from '../storage';
import { assertLiveWorkspace } from './content';
import { assertCanWrite, ServiceError, type WsCtx } from './context';

/*
 * Uploads (PRD §9): 25 MB max, type decided by the bytes rather than the
 * browser's claim, served same-origin with a sandboxing CSP.
 */

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

export function sniffMime(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (/^(avif|avis)/.test(brand)) return 'image/avif';
    if (/^(heic|heix|mif1)/.test(brand)) return 'image/heic';
    return 'video/mp4';
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || startsWith(bytes, [0xff, 0xfb])) return 'audio/mpeg';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  const isText = bytes.slice(0, 4096).every((b) => b === 9 || b === 10 || b === 13 || b >= 32);
  return isText ? 'text/plain' : 'application/octet-stream';
}

const INLINE = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|video\/(mp4|webm)|audio\/mpeg|application\/pdf|text\/plain)$/;

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // Drop control characters (code points below 32 and DEL).
  const clean = [...base].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('');
  return clean.slice(0, 200) || 'file';
}

const toInfo = (ctx: WsCtx, r: typeof file.$inferSelect): FileInfo => ({
  id: r.id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  url: `/api/workspaces/${ctx.workspaceId}/files/${r.id}`,
});

export async function uploadFile(
  a: DbAdapter,
  storage: StorageAdapter,
  ctx: WsCtx,
  input: { name: string; bytes: Uint8Array },
): Promise<FileInfo> {
  await assertLiveWorkspace(a, ctx);
  assertCanWrite(ctx);
  if (input.bytes.byteLength === 0) throw new ServiceError('invalid', 'That file is empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new ServiceError('invalid', 'Files can be up to 25 MB.');
  const id = uuidv7();
  const mime = sniffMime(input.bytes);
  const row = {
    id,
    workspaceId: ctx.workspaceId,
    storageKey: `ws/${ctx.workspaceId}/${id}`,
    name: cleanName(input.name),
    mime,
    size: input.bytes.byteLength,
    createdAt: nowIso(),
  };
  await storage.put(row.storageKey, input.bytes, { contentType: mime });
  await a.db.insert(file).values(row);
  return toInfo(ctx, row);
}

export async function readFile(
  a: DbAdapter,
  storage: StorageAdapter,
  ctx: WsCtx,
  id: string,
): Promise<{ info: FileInfo; object: StoredObject; headers: Record<string, string> }> {
  await assertLiveWorkspace(a, ctx);
  const [row] = await a.db.select().from(file).where(and(eq(file.id, id), eq(file.workspaceId, ctx.workspaceId)));
  if (!row) throw new ServiceError('not_found', 'File not found');
  const object = await storage.get(row.storageKey);
  if (!object) throw new ServiceError('not_found', 'File not found');
  const disposition = INLINE.test(row.mime) ? 'inline' : 'attachment';
  return {
    info: toInfo(ctx, row),
    object,
    headers: {
      'content-type': row.mime === 'text/plain' ? 'text/plain; charset=utf-8' : row.mime,
      'content-length': String(row.size),
      'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'x-content-type-options': 'nosniff',
      // Scripts in an uploaded SVG or HTML-ish file can never run.
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
    },
  };
}
