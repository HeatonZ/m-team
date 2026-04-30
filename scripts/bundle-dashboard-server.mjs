/**
 * Bundle dashboard/server.ts into dist/dashboard-server.cjs
 * Run AFTER `npm run build --prefix dashboard` (vite build).
 *
 * Uses esbuild with import.meta.url polyfill so the resulting CJS
 * file works without tsx/node --import tsx.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const result = await esbuild.build({
  entryPoints: [resolve(repoRoot, 'dashboard/server.ts')],
  bundle: true,
  platform: 'node',
  outfile: resolve(repoRoot, 'dist/dashboard-server.cjs'),
  format: 'cjs',
  external: ['node:*', 'better-sqlite3'],
  define: {
    // Polyfill import.meta.url in CJS output
    'import.meta.url': 'import.meta.url',
  },
  // Rewrite import.meta.url to __dirname-based path at bundle time
  banner: {
    js: [
      '// dashboard server bundled by esbuild',
      'const __import_meta_url__ = __filename.startsWith("file://") ? __filename : `file://${__filename}`;',
    ].join('\n'),
  },
});

if (result.errors.length) {
  console.error('[bundle-dashboard-server] errors:', result.errors);
  process.exit(1);
}
console.log('[bundle-dashboard-server] done → dist/dashboard-server.cjs');
