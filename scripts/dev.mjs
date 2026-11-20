import { createServer } from 'vite';
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const isWin = process.platform === 'win32';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info'
};

const mainCtx = await esbuild.context({
  ...shared,
  entryPoints: [path.join(root, 'electron/main.ts')],
  outfile: path.join(root, 'dist-electron/main.js')
});

const preloadCtx = await esbuild.context({
  ...shared,
  entryPoints: [path.join(root, 'electron/preload.ts')],
  outfile: path.join(root, 'dist-electron/preload.js')
});

await mainCtx.watch();
await preloadCtx.watch();

const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;
console.log(`[dev] renderer on ${url}`);

const electronBin = path.join(
  root,
  'node_modules',
  'electron',
  'dist',
  isWin ? 'electron.exe' : 'electron'
);

let child = null;
const launch = () => {
  const appArgs = ['.'];
  if (process.env.DSL_DEBUG_PORT) {
    appArgs.unshift(`--remote-debugging-port=${process.env.DSL_DEBUG_PORT}`);
  }
  child = spawn(electronBin, appArgs, {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
    stdio: 'inherit'
  });
  child.on('close', async () => {
    await mainCtx.dispose();
    await preloadCtx.dispose();
    await server.close();
    process.exit(0);
  });
};

launch();
