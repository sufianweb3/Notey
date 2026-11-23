/** Implemented in src/adapters/storage/*. Keys are opaque, workspace-prefixed paths. */
export type StoredObject = { body: ReadableStream<Uint8Array>; contentType: string; size: number | null };

export interface StorageAdapter {
  readonly kind: 'r2' | 'vercel-blob' | 'disk';
  put(key: string, body: ArrayBuffer | Uint8Array, opts: { contentType: string }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** Rejects keys that could escape a prefix on disk-backed stores. */
export function assertSafeKey(key: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
