import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const miniappRoot = fileURLToPath(new URL('../..', import.meta.url));
const artifactRoot = path.resolve(miniappRoot, '..', 'artifacts', 'miniapp-ui', 'h5');
const routes = [
  ['home', '/#/pages/home/home'],
  ['dishes', '/#/pages/dishes/dishes'],
  ['community', '/#/pages/community/community'],
  ['profile', '/#/pages/profile/profile']
];

async function assertViewport(page) {
  const metrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(metrics.scrollWidth, '页面出现横向溢出').toBeLessThanOrEqual(metrics.width + 1);
  const shortControls = await page.locator('button:visible').evaluateAll((buttons) => buttons
    .map((button) => ({ text: (button.textContent || '').trim().slice(0, 24), height: button.getBoundingClientRect().height }))
    .filter((item) => item.height > 0 && item.height < 43.5));
  expect(shortControls, '存在小于 44px 的可见按钮').toEqual([]);
}

async function assertResponsiveNavigation(page, projectName) {
  const navigation = page.locator('.app-nav:visible');
  await expect(navigation).toHaveCount(1);
  const box = await navigation.boundingBox();
  expect(box).not.toBeNull();
  if (['768', '1024', 'landscape'].includes(projectName)) {
    expect(box.width, '宽屏导航应切换为窄侧栏').toBeLessThan(90);
    expect(box.height, '宽屏侧栏应容纳四个主入口').toBeGreaterThan(220);
  } else {
    expect(box.height, '手机导航高度不应遮挡内容').toBeLessThanOrEqual(72);
    expect(box.width, '手机导航应横向覆盖主要触控区域').toBeGreaterThan(280);
  }
}

test('关键页面在目标视口无溢出和触控尺寸问题', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  mkdirSync(artifactRoot, { recursive: true });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });

  await page.goto('/#/pages/login/login', { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(800);
  await assertViewport(page);
  await page.screenshot({ path: path.join(artifactRoot, `${testInfo.project.name}-login.png`), fullPage: true });

  const demoButton = page.getByText('演示账号登录', { exact: true });
  if (await demoButton.isVisible().catch(() => false)) {
    await page.getByText('我已阅读并同意', { exact: true }).click({ force: true, timeout: 3_000 });
    await demoButton.click({ timeout: 3_000 });
    await page.waitForURL(/pages\/home\/home/, { timeout: 6_000 }).catch(() => {});
  }

  if (/pages\/home\/home/.test(page.url())) {
    if (testInfo.project.name === '390') {
      const selection = page.locator('.nav-selection');
      const startBox = await selection.boundingBox();
      expect(startBox).not.toBeNull();
      await page.locator('.app-nav-item').nth(1).click();
      await page.waitForTimeout(100);
      const movingBox = await selection.boundingBox();
      expect(movingBox.x, '选中框应在切页前向找菜槽位移动').toBeGreaterThan(startBox.x + 12);
      await page.screenshot({ path: path.join(artifactRoot, '390-nav-selection-moving.png') });
      await page.waitForURL(/pages\/dishes\/dishes/, { timeout: 3_000 });
      const settledBox = await page.locator('.nav-selection').boundingBox();
      expect(settledBox.x, '选中框应停在找菜槽位').toBeGreaterThan(startBox.x + startBox.width * .9);
      await page.goto('/#/pages/home/home', { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(300);
    }

    for (const [name, route] of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(650);
      await assertViewport(page);
      await assertResponsiveNavigation(page, testInfo.project.name);
      await page.screenshot({ path: path.join(artifactRoot, `${testInfo.project.name}-${name}.png`), fullPage: true });

      if (name === 'home' && testInfo.project.name === '390') {
        const revealButton = page.locator('.reveal-primary');
        await expect(revealButton).toBeVisible();
        await revealButton.click();
        await page.waitForTimeout(180);
        await expect(page.locator('.reveal')).toHaveAttribute('data-motion-phase', 'bursting');
        await page.screenshot({ path: path.join(artifactRoot, '390-home-burst.png') });
        await page.waitForTimeout(560);
        await expect(page.locator('.reveal')).toHaveAttribute('data-motion-phase', 'revealed');
        await page.screenshot({ path: path.join(artifactRoot, '390-home-revealed.png'), fullPage: true });
      }
    }
  }

  expect(browserErrors.filter((message) => !/favicon|ResizeObserver/i.test(message))).toEqual([]);
});
