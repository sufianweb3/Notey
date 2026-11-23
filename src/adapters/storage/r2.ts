import { assertSafeKey, type StorageAdapter } from '../../server/storage';

export function r2Adapter(bucket: R2Bucket): StorageAdapter {
  return {
    kind: 'r2',
    async put(key, body, { contentType }) {
      assertSafeKey(key);
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    async get(key) {
      assertSafeKey(key);
      const obj = await bucket.get(key);
      if (!obj) return null;
      return {
        body: obj.body,
        contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
        size: obj.size,
      };
    },
    async delete(key) {
      assertSafeKey(key);
      await bucket.delete(key);
    },
  };
}
