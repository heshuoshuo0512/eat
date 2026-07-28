import { Launcher } from '@weapp-vite/miniprogram-automator';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const miniappRoot = fileURLToPath(new URL('../..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const projectPath = path.join(miniappRoot, 'dist', 'build', 'mp-weixin');
const artifactRoot = path.resolve(miniappRoot, '..', 'artifacts', 'miniapp-ui', 'wechat');
const apiPort = Number(process.env.WECHAT_TEST_API_PORT || 8797);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const idePort = Number(process.env.WECHAT_DEVTOOLS_PORT || 9420);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9421);
const automationHost = process.env.WECHAT_AUTOMATION_HOST || '[::1]';
const tempRoot = mkdtempSync(path.join(tmpdir(), 'smart-canteen-wechat-'));
const candidates = [
  process.env.WECHAT_DEVTOOLS_CLI,
  'D:\\微信web开发者工具\\cli.bat',
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat'
].filter(Boolean);
const cliPath = candidates.find((candidate) => existsSync(candidate));
const revealScopes = ['sc-page-shell', 'sc-reveal-card'];
const testEnv = {
  ...process.env,
  VITE_ENABLE_DEMO_LOGIN: '1',
  VITE_API_BASE_URL: apiBaseUrl,
  ALLOW_INSECURE_MINIAPP_BUILD: '1'
};

let apiProcess = null;
let miniProgram = null;

function withTimeout(promise, label, timeoutMs = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

async function apiReady() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, { signal: AbortSignal.timeout(10000), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || `${pathname} returned ${response.status}`);
  return data;
}

async function screenshot(name) {
  await withTimeout(miniProgram.screenshot({ path: path.join(artifactRoot, `${name}.png`) }), `Screenshot ${name}`, 10000);
  console.log(`[wechat-ui] ${name}`);
}

async function revealNodes(page, selector) {
  return withTimeout(page.renderedNodes(selector, { componentSelectors: revealScopes, timeout: 5000 }), `Query ${selector}`, 6000);
}

async function revealPhase(page) {
  const [reveal] = await revealNodes(page, '.reveal');
  return String(reveal?.dataset?.motionPhase || '');
}

async function developerToolsVersion() {
  const info = await withTimeout(miniProgram.connection.send('Tool.getInfo'), 'Read DevTools version');
  return info?.version || 'unknown';
}

function nativeNodeUnavailableError(version, selector) {
  return new Error(`WeChat DevTools ${version} did not expose native node ${selector}; upgrade DevTools and rerun test:wechat.`);
}

async function waitForRevealNode(page, selector, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const [node] = await revealNodes(page, selector);
    if (node) return node;
    await page.waitFor(50);
  }
  throw nativeNodeUnavailableError(await developerToolsVersion(), selector);
}

async function nativeRevealButton(page) {
  const button = await page.$('.reveal-primary', { fallback: false, timeout: 3000 });
  if (button) return button;
  throw nativeNodeUnavailableError(await developerToolsVersion(), '.reveal-primary');
}

async function waitForRevealPhase(page, expected, timeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await revealPhase(page) === expected) return;
    await page.waitFor(35);
  }
  throw new Error(`Reveal did not enter ${expected}; current phase is ${await revealPhase(page) || 'unknown'}`);
}

async function callViewModel(method, ...args) {
  try {
    return Boolean(await withTimeout(miniProgram.evaluate((name, values) => {
      const pages = getCurrentPages();
      const viewModel = pages[pages.length - 1]?.$vm;
      if (!viewModel || typeof viewModel[name] !== 'function') return false;
      viewModel[name](...values);
      return true;
    }, method, args), `Call page method ${method}`));
  } catch (error) {
    console.warn(`[wechat-ui] skipped ${method}: ${error.message}`);
    return false;
  }
}

async function setViewModel(values) {
  return withTimeout(miniProgram.evaluate((nextValues) => {
    const pages = getCurrentPages();
    const viewModel = pages[pages.length - 1]?.$vm;
    if (!viewModel) return false;
    Object.assign(viewModel, nextValues);
    return true;
  }, values), 'Update page test state').catch(() => false);
}

async function main() {
  if (!cliPath) throw new Error('WeChat DevTools CLI was not found. Set WECHAT_DEVTOOLS_CLI.');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npm, ['run', 'build:mp-weixin'], {
    cwd: miniappRoot,
    env: testEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (build.status !== 0) throw build.error || new Error(`Miniapp build exited with ${build.status}`);
  mkdirSync(artifactRoot, { recursive: true });

  if (await apiReady()) throw new Error(`WeChat test API port ${apiPort} is in use; set WECHAT_TEST_API_PORT to a free port.`);
  apiProcess = spawn(process.execPath, ['server/index.js'], {
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
  for (let attempt = 0; attempt < 60 && !await apiReady(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 500));
  if (!await apiReady()) throw new Error(`WeChat test API failed to start at ${apiBaseUrl}`);

  const cli = spawnSync(cliPath, ['auto', '--project', projectPath, '--port', String(idePort), '--auto-port', String(automationPort), '--trust-project'], {
    cwd: miniappRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (cli.status !== 0) throw cli.error || new Error(`WeChat DevTools CLI exited with ${cli.status}`);

  const wsEndpoint = `ws://${automationHost}:${automationPort}`;
  let connectError = null;
  for (let attempt = 0; attempt < 30 && !miniProgram; attempt += 1) {
    try {
      miniProgram = await new Launcher().connect({ wsEndpoint });
    } catch (error) {
      connectError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!miniProgram) throw connectError || new Error(`Unable to connect to WeChat automation at ${wsEndpoint}`);
  await new Promise((resolve) => setTimeout(resolve, 15000));

  const errors = [];
  miniProgram.on('exception', (error) => errors.push(String(error)));
  miniProgram.on('console', (entry) => { if (entry.type === 'error') errors.push(String(entry.args || entry)); });

  let page = await withTimeout(miniProgram.currentPage(), 'Read entry page', 20000);
  if (page.path !== 'pages/login/login') page = await withTimeout(miniProgram.reLaunch('/pages/login/login'), 'Open login page', 10000);
  await page.waitFor(700);
  await screenshot('01-login');

  const auth = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: '演示学生', password: 'student123' })
  });
  const accessToken = auth.accessToken || auth.token;
  if (!accessToken) throw new Error('Demo login did not return an access token');
  await withTimeout(miniProgram.callWxMethod('setStorageSync', 'smart-canteen-token', accessToken), 'Write access token');
  if (auth.refreshToken) await withTimeout(miniProgram.callWxMethod('setStorageSync', 'smart-canteen-refresh-token', auth.refreshToken), 'Write refresh token');
  await requestJson('/api/bootstrap', { headers: { Authorization: `Bearer ${accessToken}` } });
  const catalog = await requestJson('/api/dishes/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ page: 1, pageSize: 1, sort: 'rating_desc' })
  });
  const firstDish = catalog.items?.[0];
  if (!firstDish?.id) throw new Error('Catalog search did not return a dish for WeChat automation');

  page = await withTimeout(miniProgram.switchTab('/pages/home/home'), 'Open home tab', 10000);
  await page.waitFor(1400);
  await waitForRevealNode(page, '.reveal');
  await waitForRevealNode(page, '.reveal-primary');
  await waitForRevealPhase(page, 'covered');
  await screenshot('02-home-covered');
  const revealButton = await nativeRevealButton(page);
  await withTimeout(revealButton.tap(), 'Tap native reveal button');
  await waitForRevealPhase(page, 'bursting');
  await screenshot('03-home-bursting');
  await waitForRevealPhase(page, 'revealed');
  await screenshot('04-home-revealed');

  page = await withTimeout(miniProgram.switchTab('/pages/dishes/dishes'), 'Open dishes tab', 10000);
  await page.waitFor(900);
  await screenshot('05-dishes');
  await callViewModel('changeMode', 'recommend');
  await page.waitFor(700);
  await screenshot('06-recommend');
  page = await withTimeout(miniProgram.navigateTo(`/pages/dish-detail/dish-detail?id=${encodeURIComponent(firstDish.id)}`), 'Open dish detail', 10000);
  await page.waitFor(900);
  await callViewModel('toggleFavorite');
  await screenshot('07-dish-detail');

  page = await withTimeout(miniProgram.switchTab('/pages/community/community'), 'Open community tab', 10000);
  await page.waitFor(800);
  await screenshot('08-community');
  await setViewModel({ section: 'reviews', filtersOpen: true });
  await page.waitFor(500);
  await screenshot('09-community-filter');

  page = await withTimeout(miniProgram.switchTab('/pages/profile/profile'), 'Open profile tab', 10000);
  await page.waitFor(800);
  await screenshot('10-profile');
  page = await withTimeout(miniProgram.navigateTo('/pages/health-profile/health-profile'), 'Open health profile', 10000);
  await page.waitFor(700);
  await screenshot('11-health-profile');
  page = await withTimeout(miniProgram.navigateTo('/pages/orders/orders'), 'Open reservations', 10000);
  await page.waitFor(800);
  await callViewModel('add', firstDish);
  await screenshot('12-orders');

  if (errors.length) throw new Error(`Miniapp console errors:\n${errors.join('\n')}`);
}

try {
  await main();
} finally {
  if (miniProgram) miniProgram.disconnect();
  if (apiProcess) apiProcess.kill();
  rmSync(tempRoot, { recursive: true, force: true });
}
