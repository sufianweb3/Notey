/** Bundles the Node/Docker server into dist/server/node.mjs. */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/entry/node.ts'],
  outfile: 'dist/server/node.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // libsql ships native bindings; resolve it from node_modules at runtime.
  external: ['@libsql/client', 'libsql'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
