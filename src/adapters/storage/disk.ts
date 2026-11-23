import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { assertSafeKey, type StorageAdapter } from '../../server/storage';

export function diskAdapter(root: string): StorageAdapter {
  const base = resolve(root);
  const pathFor = (key: string) => {
    assertSafeKey(key);
    const p = resolve(join(base, key));
    if (!p.startsWith(base + sep)) throw new Error(`Unsafe storage key: ${key}`);
    return p;
  };
  return {
    kind: 'disk',
    async put(key, body, { contentType }) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, new Uint8Array(body as ArrayBuffer));
      await writeFile(`${p}.meta.json`, JSON.stringify({ contentType }));
    },
    async get(key) {
      const p = pathFor(key);
      try {
        const [info, meta] = await Promise.all([stat(p), readFile(`${p}.meta.json`, 'utf8')]);
        const { contentType } = JSON.parse(meta) as { contentType: string };
        const body = Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>;
        return { body, contentType, size: info.size };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async delete(key) {
      const p = pathFor(key);
      await rm(p, { force: true });
      await rm(`${p}.meta.json`, { force: true });
    },
  };
}
