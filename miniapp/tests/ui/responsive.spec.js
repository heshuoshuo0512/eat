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
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth, 'Page has horizontal overflow').toBeLessThanOrEqual(metrics.width + 1);
  const shortControls = await page.locator('button:visible').evaluateAll((buttons) => buttons
    .map((button) => ({
      text: (button.textContent || '').trim().slice(0, 24),
      height: button.getBoundingClientRect().height
    }))
    .filter((item) => item.height > 0 && item.height < 43.5));
  expect(shortControls, 'Visible buttons shorter than 44px').toEqual([]);
}

async function assertResponsiveNavigation(page, projectName) {
  const navigation = page.locator('.app-nav:visible');
  await expect(navigation).toHaveCount(1);
  const box = await navigation.boundingBox();
  expect(box).not.toBeNull();
  if (['768', '1024', 'landscape'].includes(projectName)) {
    expect(box.width, 'Wide viewport navigation should be a narrow rail').toBeLessThan(90);
    expect(box.height, 'Wide viewport rail should contain all four tabs').toBeGreaterThan(220);
  } else {
    expect(box.height, 'Mobile navigation should not cover excessive content').toBeLessThanOrEqual(72);
    expect(box.width, 'Mobile navigation should span the primary touch area').toBeGreaterThan(280);
  }
}

test('key pages fit target viewports and touch sizes', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  mkdirSync(artifactRoot, { recursive: true });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });

  await page.goto('/#/pages/login/login', { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForTimeout(800);
  await assertViewport(page);
  await page.screenshot({ path: path.join(artifactRoot, `${testInfo.project.name}-login.png`), fullPage: true });

  const accountInputs = page.locator('.auth-form input');
  await expect(accountInputs).toHaveCount(2);
  await accountInputs.nth(0).fill('演示学生');
  await accountInputs.nth(1).fill('student123');
  await page.locator('.consent-check').click({ force: true });
  await page.locator('.primary-btn').click();
  await page.waitForURL(/pages\/home\/home/, { timeout: 8_000 }).catch(() => {});
  expect(page.url(), 'Account login must enter home so visual checks cannot be skipped').toMatch(/pages\/home\/home/);

  if (testInfo.project.name === '390') {
    const selection = page.locator('.nav-selection');
    const startBox = await selection.boundingBox();
    expect(startBox).not.toBeNull();
    await page.locator('.app-nav-item').nth(1).click();
    await page.waitForTimeout(100);
    const movingBox = await selection.boundingBox();
    expect(movingBox.x, 'Selection frame should move toward the dishes tab before navigation').toBeGreaterThan(startBox.x + 12);
    await page.screenshot({ path: path.join(artifactRoot, '390-nav-selection-moving.png') });
    await page.waitForURL(/pages\/dishes\/dishes/, { timeout: 3_000 });
    const settledBox = await page.locator('.nav-selection').boundingBox();
    expect(settledBox.x, 'Selection frame should settle on the dishes slot').toBeGreaterThan(startBox.x + startBox.width * 0.9);
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

  expect(browserErrors.filter((message) => !/favicon|ResizeObserver/i.test(message))).toEqual([]);
});
