import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../miniapp/node_modules/playwright/index.mjs';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined);
const baseUrl = process.env.COLLECTOR_UI_URL || 'http://127.0.0.1:5174';
const output = resolve('artifacts/collector-ui');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    if (await page.locator('.group-card').count() !== 4) throw new Error(`${viewport.name}: expected four collection groups`);
    const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, guideWidths: [...document.querySelectorAll('.guide-grid img')].map((image) => image.naturalWidth) }));
    if (layout.scrollWidth > layout.clientWidth + 1) throw new Error(`${viewport.name}: horizontal overflow ${layout.scrollWidth}/${layout.clientWidth}`);
    if (layout.guideWidths.some((width) => width <= 0)) throw new Error(`${viewport.name}: guide bitmap failed to render`);
    await page.screenshot({ path: resolve(output, `home-${viewport.name}.png`), fullPage: viewport.name === 'mobile' });
    await page.locator('.group-card .button').first().click();
    await page.waitForLoadState('networkidle');
    if (await page.locator('input[type=file]').count() !== 1) throw new Error(`${viewport.name}: upload control is missing`);
    await page.screenshot({ path: resolve(output, `contribute-${viewport.name}.png`), fullPage: viewport.name === 'mobile' });
    const uploadPath = resolve('collector-web/public/guides/photo-good.jpg');
    await page.locator('input[type=file]').setInputFiles(uploadPath);
    await page.locator('#claimed-name').fill('番茄炒蛋');
    await page.route('**/api/collector/drafts', async (route) => {
      const postData = route.request().postData() || '';
      if (!postData.includes('name="requestAiSuggestion"') || !postData.includes('\r\n\r\nfalse\r\n')) {
        throw new Error(`${viewport.name}: catalog-only request did not disable image suggestions`);
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          draft: {
            id: `ui-draft-${viewport.name}`,
            status: 'draft',
            imageUrl: '/guides/photo-good.jpg',
            claimedName: '番茄炒蛋',
            aiNames: [],
            aiSuggestionStatus: 'skipped',
            candidates: [],
          },
        }),
      });
    });
    const draftResponse = page.waitForResponse((response) => response.url().includes('/api/collector/drafts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '仅按菜名匹配目录' }).click();
    const draftPayload = await (await draftResponse).json();
    if (draftPayload?.draft?.aiSuggestionStatus !== 'skipped') throw new Error(`${viewport.name}: catalog-only lookup invoked image suggestions`);
    await page.getByText('本次未使用图片建议').waitFor();
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, baseUrl, output }, null, 2));
} finally {
  await browser.close();
}
