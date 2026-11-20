import { build as viteBuild } from 'vite';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

await viteBuild({ configFile: path.join(root, 'vite.config.ts') });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: true,
  external: ['electron'],
  logLevel: 'info'
};

await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'electron/main.ts')],
  outfile: path.join(root, 'dist-electron/main.js')
});

await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'electron/preload.ts')],
  outfile: path.join(root, 'dist-electron/preload.js')
});

console.log('[build] done');
