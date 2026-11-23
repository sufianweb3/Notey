/**
 * Writes .vercel/output (Build Output API v3): the SPA as static files and the
 * Hono app as one Node function. Bundling ourselves avoids Vercel's per-file
 * TypeScript compile, which can't resolve extensionless ESM imports.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/functions/api.func`, { recursive: true });
cpSync('dist/web', `${out}/static`, { recursive: true });

await build({
  entryPoints: ['api/[[...route]].ts'],
  outfile: `${out}/functions/api.func/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

writeFileSync(
  `${out}/functions/api.func/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true }, null, 2),
);
writeFileSync(`${out}/functions/api.func/package.json`, JSON.stringify({ type: 'module' }));

const appPaths = '/(api|mcp|oauth|ai|\\.well-known)(/.*)?';
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: appPaths, dest: '/api' },
        { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Wrote ${out}`);
