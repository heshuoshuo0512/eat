import { Launcher } from '@weapp-vite/miniprogram-automator';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const miniappRoot = fileURLToPath(new URL('../..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const projectPath = path.join(miniappRoot, 'dist', 'build', 'mp-weixin');
const artifactRoot = path.resolve('..', 'artifacts', 'miniapp-ui', 'wechat');
const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787';
const testEnv = { ...process.env, VITE_ENABLE_DEMO_LOGIN: '1', VITE_API_BASE_URL: apiBaseUrl };
const candidates = [
  process.env.WECHAT_DEVTOOLS_CLI,
  'D:\\微信web开发者工具\\cli.bat',
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat'
].filter(Boolean);
const cliPath = candidates.find((candidate) => existsSync(candidate));
if (!cliPath) throw new Error('未找到微信开发者工具 CLI，请设置 WECHAT_DEVTOOLS_CLI。');
const idePort = Number(process.env.WECHAT_DEVTOOLS_PORT || 9420);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9421);
const revealScopes = ['sc-page-shell', 'sc-reveal-card'];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build:mp-weixin'], {
  cwd: miniappRoot,
  env: testEnv,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (build.status !== 0) process.exit(build.status || 1);
mkdirSync(artifactRoot, { recursive: true });

async function apiReady() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

let apiProcess = null;
if (!await apiReady()) {
  apiProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: workspaceRoot,
    env: { ...process.env, PORT: '8787' },
    stdio: 'inherit'
  });
  for (let attempt = 0; attempt < 30 && !await apiReady(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!await apiReady()) {
    apiProcess.kill();
    throw new Error(`本地 API 未能启动：${apiBaseUrl}`);
  }
}

const cli = spawnSync(cliPath, ['auto', '--project', projectPath, '--port', String(idePort), '--auto-port', String(automationPort), '--trust-project'], {
  cwd: miniappRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (cli.status !== 0) process.exit(cli.status || 1);

const automationHost = process.env.WECHAT_AUTOMATION_HOST || '[::1]';
const wsEndpoint = `ws://${automationHost}:${automationPort}`;
let miniProgram = null;
let connectError = null;
for (let attempt = 0; attempt < 30 && !miniProgram; attempt += 1) {
  try {
    miniProgram = await new Launcher().connect({ wsEndpoint });
  } catch (error) {
    connectError = error;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
if (!miniProgram) throw connectError || new Error(`无法连接微信自动化端口 ${wsEndpoint}`);
await new Promise((resolve) => setTimeout(resolve, 15000));
const errors = [];
miniProgram.on('exception', (error) => errors.push(String(error)));
miniProgram.on('console', (entry) => { if (entry.type === 'error') errors.push(String(entry.args || entry)); });

function withTimeout(promise, label, timeoutMs = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

async function screenshot(name) {
  await withTimeout(miniProgram.screenshot({ path: path.join(artifactRoot, `${name}.png`) }), `截图 ${name}`, 10000);
  console.log(`[wechat-ui] ${name}`);
}

async function revealNodes(page, selector) {
  return withTimeout(page.renderedNodes(selector, {
    componentSelectors: revealScopes,
    timeout: 5000
  }), `查询 ${selector} 渲染节点`, 6000);
}

async function revealPhase(page) {
  const [reveal] = await revealNodes(page, '.reveal');
  return String(reveal?.dataset?.motionPhase || '');
}

async function waitForRevealNode(page, selector, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const [node] = await revealNodes(page, selector);
    if (node) return node;
    await page.waitFor(50);
  }
  const version = await developerToolsVersion();
  throw nativeNodeUnavailableError(version, selector);
}

async function developerToolsVersion() {
  const toolInfo = await withTimeout(miniProgram.connection.send('Tool.getInfo'), '读取开发者工具版本');
  return toolInfo?.version || 'unknown';
}

function nativeNodeUnavailableError(version, selector) {
  if (version === '2.01.2510290') {
    return new Error(
      `微信开发者工具 ${version} 的原生 Page/Element RPC 在 Windows 上不可用，无法取得真实节点 ${selector}。` +
      '兼容查询只能返回坐标快照，不能冒充 Element.tap。请升级开发者工具后重跑 test:wechat。'
    );
  }
  return new Error(`开发者工具 ${version} 未返回真实节点 ${selector}`);
}

async function nativeRevealButton(page) {
  const version = await developerToolsVersion();
  const button = await page.$('.reveal-primary', { fallback: false, timeout: 3000 });
  if (button) return button;
  throw nativeNodeUnavailableError(version, '.reveal-primary');
}

async function waitForRevealPhase(page, expected, timeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await revealPhase(page) === expected) return;
    await page.waitFor(35);
  }
  throw new Error(`揭晓动画未进入 ${expected} 状态，当前为 ${await revealPhase(page) || '未渲染'}`);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, { signal: AbortSignal.timeout(10000), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${pathname} 返回 ${response.status}`);
  return data;
}

async function callViewModel(method, ...args) {
  try {
    const called = await withTimeout(miniProgram.evaluate((name, values) => {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const viewModel = page && page.$vm;
      if (!viewModel || typeof viewModel[name] !== 'function') return false;
      viewModel[name](...values);
      return true;
    }, method, args), `调用页面方法 ${method}`);
    console.log(`[wechat-ui] ${called ? '已调用' : '未暴露'} ${method}`);
    return Boolean(called);
  } catch (error) {
    console.warn(`[wechat-ui] 跳过 ${method}: ${error.message}`);
    return false;
  }
}

async function setViewModel(values) {
  try {
    return await withTimeout(miniProgram.evaluate((nextValues) => {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const viewModel = page && page.$vm;
      if (!viewModel) return false;
      Object.assign(viewModel, nextValues);
      return true;
    }, values), '更新页面测试状态');
  } catch {
    return false;
  }
}

try {
  let page = await withTimeout(miniProgram.currentPage(), '读取入口页', 20000);
  if (page.path !== 'pages/login/login') page = await withTimeout(miniProgram.reLaunch('/pages/login/login'), '打开登录页', 10000);
  await page.waitFor(700);
  await screenshot('01-login');

  const auth = await requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: '演示学生', password: 'student123' })
  });
  console.log('[wechat-ui] 演示登录接口通过');
  const accessToken = auth.accessToken || auth.token;
  if (!accessToken) throw new Error('演示登录未返回 access token');
  await withTimeout(miniProgram.callWxMethod('setStorageSync', 'smart-canteen-token', accessToken), '写入 access token');
  if (auth.refreshToken) await withTimeout(miniProgram.callWxMethod('setStorageSync', 'smart-canteen-refresh-token', auth.refreshToken), '写入 refresh token');
  const bootstrap = await requestJson('/api/bootstrap', { headers: { Authorization: `Bearer ${accessToken}` } });
  console.log('[wechat-ui] 登录态与基础数据已写入');

  page = await withTimeout(miniProgram.switchTab('/pages/home/home'), '切换首页', 10000);
  await page.waitFor(1400);
  await waitForRevealNode(page, '.reveal');
  await waitForRevealNode(page, '.reveal-primary');
  await waitForRevealPhase(page, 'covered');
  await screenshot('02-home-covered');
  const revealButton = await nativeRevealButton(page);
  await withTimeout(revealButton.tap(), '点击真实揭晓按钮');
  await waitForRevealPhase(page, 'bursting');
  await screenshot('03-home-bursting');
  await waitForRevealPhase(page, 'revealed');
  await screenshot('04-home-revealed');

  page = await withTimeout(miniProgram.switchTab('/pages/dishes/dishes'), '切换找菜页', 10000);
  await page.waitFor(900);
  await screenshot('05-dishes');
  await callViewModel('changeMode', 'recommend');
  await page.waitFor(700);
  await screenshot('06-recommend');
  const firstDish = bootstrap.dishes?.[0];
  if (firstDish?.id) {
    page = await withTimeout(miniProgram.navigateTo(`/pages/dish-detail/dish-detail?id=${encodeURIComponent(firstDish.id)}`), '打开菜品详情', 10000);
    await page.waitFor(900);
    await callViewModel('toggleFavorite');
    await screenshot('07-dish-detail');
    await withTimeout(miniProgram.navigateBack(), '返回找菜页', 10000);
  }

  page = await withTimeout(miniProgram.switchTab('/pages/community/community'), '切换社区页', 10000);
  await page.waitFor(800);
  await screenshot('08-community');
  await setViewModel({ section: 'reviews', filtersOpen: true });
  await page.waitFor(500);
  await screenshot('09-community-filter');

  page = await withTimeout(miniProgram.switchTab('/pages/profile/profile'), '切换个人页', 10000);
  await page.waitFor(800);
  await screenshot('10-profile');
  page = await withTimeout(miniProgram.navigateTo('/pages/health-profile/health-profile'), '打开健康档案', 10000);
  await page.waitFor(700);
  await screenshot('11-health-profile');
  page = await withTimeout(miniProgram.navigateTo('/pages/orders/orders'), '打开点餐页', 10000);
  await page.waitFor(800);
  if (firstDish) await callViewModel('add', firstDish);
  await screenshot('12-orders');

  if (errors.length) throw new Error(`小程序控制台异常:\n${errors.join('\n')}`);
} finally {
  if (miniProgram) miniProgram.disconnect();
  if (apiProcess) apiProcess.kill();
}
