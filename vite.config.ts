import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Excalidraw loads its fonts from a CDN unless told otherwise. Serve them
 * from our own origin instead (dev: middleware, build: copied into dist).
 */
function excalidrawAssets(): Plugin {
  const src = fileURLToPath(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url));
  const prefix = '/excalidraw-assets/fonts/';
  return {
    name: 'notey-excalidraw-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        const file = normalize(join(src, decodeURIComponent(req.url.slice(prefix.length).split('?')[0]!)));
        if (!file.startsWith(src) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      cpSync(src, join(options.dir!, 'excalidraw-assets/fonts'), { recursive: true });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/web/routes',
      generatedRouteTree: './src/web/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    excalidrawAssets(),
  ],
  resolve: {
    alias: {
      '@web': fileURLToPath(new URL('./src/web', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: true,
  },
});
