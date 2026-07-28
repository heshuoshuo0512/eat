import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const miniappRoot = fileURLToPath(new URL('../..', import.meta.url));
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sizes = [
  ['320', 320, 760],
  ['360', 360, 800],
  ['375', 375, 812],
  ['390', 390, 844],
  ['430', 430, 932],
  ['600', 600, 900],
  ['768', 768, 1024],
  ['1024', 1024, 900],
  ['landscape', 844, 390]
];

export default defineConfig({
  testDir: '.',
  testMatch: 'responsive.spec.js',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: path.resolve(miniappRoot, '..', 'artifacts', 'miniapp-ui', 'playwright-results'),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'zh-CN',
    colorScheme: 'light',
    launchOptions: existsSync(chromePath) ? { executablePath: chromePath } : undefined
  },
  projects: sizes.map(([name, width, height]) => ({ name, use: { viewport: { width, height } } })),
  webServer: {
    command: 'node start-h5-preview.mjs',
    url: 'http://127.0.0.1:4173',
    timeout: 120_000,
    reuseExistingServer: false
  }
});
