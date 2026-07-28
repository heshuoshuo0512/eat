import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const miniappRoot = fileURLToPath(new URL('../..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const uniCli = fileURLToPath(new URL('../../node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', import.meta.url));
const viteCli = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
const env = {
  ...process.env,
  VITE_ENABLE_DEMO_LOGIN: '1',
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://127.0.0.1:4173',
  VITE_UI_TEST_PROXY: '1'
};

const build = spawnSync(process.execPath, [uniCli, 'build', '-p', 'h5'], { cwd: miniappRoot, env, stdio: 'inherit' });
if (build.status !== 0) {
  if (build.error) console.error(build.error);
  process.exit(build.status || 1);
}

async function apiReady() {
  try {
    const response = await fetch('http://127.0.0.1:8787/api/health', { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

let api = null;
if (!await apiReady()) {
  api = spawn(process.execPath, ['server/index.js'], { cwd: workspaceRoot, env: { ...process.env, PORT: '8787' }, stdio: 'inherit' });
  for (let attempt = 0; attempt < 30 && !await apiReady(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!await apiReady()) {
    api.kill();
    throw new Error('H5 视觉测试 API 未能启动');
  }
}
const preview = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173', '--outDir', 'dist/build/h5'], {
  cwd: miniappRoot,
  env,
  stdio: 'inherit'
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { preview.kill(signal); api?.kill(signal); });
preview.on('exit', (code) => { api?.kill(); process.exit(code || 0); });
