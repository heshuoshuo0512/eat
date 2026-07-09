import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MINIAPP = 'miniapp/src';

function readJson(relPath) {
  return JSON.parse(readFileSync(join(MINIAPP, relPath), 'utf8'));
}

function readVueTemplate(relPath) {
  const src = readFileSync(join(MINIAPP, relPath), 'utf8');
  const match = src.match(/^<template>([\s\S]*?)<\/template>/);
  return match ? match[1] : '';
}

// ── Tab-bar topology ────────────────────────────────────────────────

describe('tab-bar topology', () => {
  const pages = readJson('pages.json');
  const tabBar = pages.tabBar;
  const tabTexts = tabBar.list.map((t) => t.text);
  const tabPaths = tabBar.list.map((t) => t.pagePath);
  const registeredPaths = pages.pages.map((p) => p.path);

  it('has exactly four tabs: 首页 / 菜单 / 健康 / 我的', () => {
    assert.deepEqual(tabTexts, ['首页', '菜单', '健康', '我的']);
  });

  it('tab pagePaths resolve to registered pages', () => {
    for (const pagePath of tabPaths) {
      assert.ok(
        registeredPaths.includes(pagePath),
        `tab pagePath "${pagePath}" not found in pages list`
      );
    }
  });

  it('every tab page has a corresponding .vue file', () => {
    for (const pagePath of tabPaths) {
      const vuePath = join(MINIAPP, `${pagePath}.vue`);
      assert.ok(existsSync(vuePath), `missing Vue file for tab: ${vuePath}`);
    }
  });

  it('pages list includes login as first page (entry)', () => {
    assert.equal(pages.pages[0].path, 'pages/login/login');
  });
});

// ── Required pages existence ────────────────────────────────────────

describe('required page files', () => {
  const requiredPages = [
    'pages/home/home.vue',
    'pages/dishes/dishes.vue',
    'pages/health/health.vue',
    'pages/profile/profile.vue',
    'pages/login/login.vue',
    'pages/vision/vision.vue',
    'pages/recommend/recommend.vue',
    'pages/agent/agent.vue',
    'pages/canteens/canteens.vue',
  ];

  for (const rel of requiredPages) {
    it(`${rel} exists`, () => {
      assert.ok(existsSync(join(MINIAPP, rel)), `missing ${rel}`);
    });
  }
});

// ── Legal pages (privacy & terms) ───────────────────────────────────

describe('legal pages', () => {
  it('privacy policy page is registered in pages.json once it exists', () => {
    const privacyVue = join(MINIAPP, 'pages/privacy/privacy.vue');
    if (!existsSync(privacyVue)) {
      assert.fail(
        'pages/privacy/privacy.vue does not exist yet. ' +
        'Create it and register in pages.json to satisfy WeChat privacy API requirements.'
      );
    }
    const pages = readJson('pages.json');
    const registered = pages.pages.some((p) => p.path === 'pages/privacy/privacy');
    assert.ok(registered, 'privacy page exists but is not registered in pages.json');
  });

  it('terms of service page is registered in pages.json once it exists', () => {
    const termsVue = join(MINIAPP, 'pages/terms/terms.vue');
    if (!existsSync(termsVue)) {
      assert.fail(
        'pages/terms/terms.vue does not exist yet. ' +
        'Create it and register in pages.json for enterprise legal compliance.'
      );
    }
    const pages = readJson('pages.json');
    const registered = pages.pages.some((p) => p.path === 'pages/terms/terms');
    assert.ok(registered, 'terms page exists but is not registered in pages.json');
  });
});

// ── WeChat manifest contracts ───────────────────────────────────────

describe('manifest.json WeChat configuration', () => {
  const manifest = readJson('manifest.json');
  const mp = manifest['mp-weixin'];

  it('declares camera permission with a description', () => {
    assert.ok(mp.permission, 'mp-weixin.permission is missing');
    const cameraPermission = mp.permission['scope.camera'] || mp.permission.scope?.camera;
    assert.ok(cameraPermission, 'scope.camera permission is missing');
    assert.ok(
      typeof cameraPermission.desc === 'string' &&
      cameraPermission.desc.length > 0,
      'scope.camera.desc must be a non-empty string'
    );
  });

  it('includes privacy-related configuration fields', () => {
    const hasPrivacyField =
      '__privacy__' in mp ||
      '__usePrivacyCheck__' in mp ||
      'privacy' in mp ||
      'requiredPrivateInfos' in mp;
    assert.ok(
      hasPrivacyField,
      'mp-weixin is missing privacy configuration (__privacy__, __usePrivacyCheck__, ' +
      'privacy, or requiredPrivateInfos). WeChat requires this for privacy API compliance.'
    );
  });

  it('sets urlCheck to true for production domain enforcement', () => {
    assert.equal(mp.setting.urlCheck, true, 'urlCheck must be true');
  });
});

// ── Production environment template ─────────────────────────────────

describe('production env template', () => {
  const envPath = join('miniapp', '.env.production.example');
  let content;

  it('.env.production.example exists', () => {
    assert.ok(existsSync(envPath), 'missing miniapp/.env.production.example');
    content = readFileSync(envPath, 'utf8');
  });

  it('uses HTTPS for API base URL', () => {
    if (!content) content = readFileSync(envPath, 'utf8');
    const match = content.match(/VITE_API_BASE_URL=(.+)/);
    assert.ok(match, 'VITE_API_BASE_URL not found in production env template');
    const url = match[1].trim();
    assert.ok(url.startsWith('https://'), `production API URL must use HTTPS, got: ${url}`);
    assert.ok(!url.includes('localhost'), 'production URL must not reference localhost');
    assert.ok(!url.includes('127.0.0.1'), 'production URL must not reference 127.0.0.1');
  });
});

// ── Emoji-free critical page templates ──────────────────────────────

describe('UI templates avoid emoji pictographs', () => {
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}\u{20E3}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{2934}-\u{2935}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu;

  const criticalPages = [
    'pages/home/home.vue',
    'pages/dishes/dishes.vue',
    'pages/health/health.vue',
    'pages/profile/profile.vue',
    'pages/login/login.vue',
    'pages/vision/vision.vue',
    'pages/recommend/recommend.vue',
    'pages/agent/agent.vue',
  ];

  for (const rel of criticalPages) {
    const name = rel.split('/').pop().replace('.vue', '');
    it(`${name} template uses image icons, not emoji pictographs`, () => {
      const template = readVueTemplate(rel);
      const stripped = template.replace(/\{\{[\s\S]*?\}\}/g, '');
      const matches = stripped.match(emojiPattern);
      assert.deepEqual(
        matches,
        null,
        `${rel} template contains emoji pictographs: ${matches?.join(', ')}. ` +
        'Use <image> tags with /static/icons/ assets instead.'
      );
    });
  }
});
