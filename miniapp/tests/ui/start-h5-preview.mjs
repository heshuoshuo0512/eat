import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const miniappRoot = fileURLToPath(new URL('../..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const uniCli = fileURLToPath(new URL('../../node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', import.meta.url));
const viteCli = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
const apiPort = Number(process.env.MINIAPP_H5_TEST_API_PORT || 8798);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const tempRoot = mkdtempSync(path.join(tmpdir(), 'smart-canteen-h5-'));
const env = {
  ...process.env,
  VITE_ENABLE_DEMO_LOGIN: '1',
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://127.0.0.1:4173',
  VITE_UI_TEST_PROXY: '1',
  VITE_UI_TEST_API_BASE_URL: apiBaseUrl
};

const build = spawnSync(process.execPath, [uniCli, 'build', '-p', 'h5'], { cwd: miniappRoot, env, stdio: 'inherit' });
if (build.status !== 0) {
  rmSync(tempRoot, { recursive: true, force: true });
  if (build.error) console.error(build.error);
  process.exit(build.status || 1);
}

async function apiReady() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

if (await apiReady()) {
  rmSync(tempRoot, { recursive: true, force: true });
  throw new Error(`H5 test API port ${apiPort} is already in use; set MINIAPP_H5_TEST_API_PORT to a free port.`);
}

const api = spawn(process.execPath, ['server/index.js'], {
  cwd: workspaceRoot,
  env: {
    ...process.env,
    PORT: String(apiPort),
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    SMART_CANTEEN_DB: path.join(tempRoot, 'ui-test.sqlite'),
    ENABLE_DEMO_SEED: '1',
    ENABLE_LEGACY_TEST_BOOTSTRAP: '0',
    OUTBOX_WORKER_ENABLED: '0',
    HEALTH_KB_AUTOLOAD: '0'
  },
  stdio: 'inherit'
});
for (let attempt = 0; attempt < 60 && !await apiReady(); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!await apiReady()) {
  api.kill();
  rmSync(tempRoot, { recursive: true, force: true });
  throw new Error('H5 visual-test API failed to start');
}

const preview = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173', '--outDir', 'dist/build/h5'], {
  cwd: miniappRoot,
  env,
  stdio: 'inherit'
});

let cleaned = false;
function cleanup(signal) {
  if (cleaned) return;
  cleaned = true;
  if (signal) preview.kill(signal);
  api.kill(signal || undefined);
  rmSync(tempRoot, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup(signal);
    process.exit(0);
  });
}
preview.on('exit', (code) => {
  cleanup();
  process.exit(code || 0);
});
