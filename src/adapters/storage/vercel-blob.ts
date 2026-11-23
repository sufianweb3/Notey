import { del, get, put } from '@vercel/blob';
import { assertSafeKey, type StorageAdapter } from '../../server/storage';

/** Private Vercel Blob store. Files are only served through the app, never by public URL. */
export function vercelBlobAdapter(token: string): StorageAdapter {
  return {
    kind: 'vercel-blob',
    async put(key, body, { contentType }) {
      assertSafeKey(key);
      await put(key, new Blob([body as BlobPart]), {
        access: 'private',
        token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async get(key) {
      assertSafeKey(key);
      const res = await get(key, { access: 'private', token, useCache: false });
      if (!res || res.statusCode !== 200) return null;
      return { body: res.stream, contentType: res.blob.contentType, size: res.blob.size };
    },
    async delete(key) {
      assertSafeKey(key);
      await del(key, { token });
    },
  };
}
