import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  COMMUNITY_ENTRY_IDS,
  CORE_ENTRY_IDS,
  EXPLORE_ENTRY_IDS,
  STUDENT_ENTRIES,
  getStudentEntries
} from '../miniapp/src/domain/studentNavigation.js';

const MINIAPP = 'miniapp/src';
const TAB_PATHS = ['pages/home/home', 'pages/dishes/dishes', 'pages/community/community', 'pages/profile/profile'];

function readJson(relPath) { return JSON.parse(readFileSync(join(MINIAPP, relPath), 'utf8')); }
function walk(dir, extensions = null) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, extensions);
    return !extensions || extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}
function readVueTemplate(relPath) {
  const source = readFileSync(join(MINIAPP, relPath), 'utf8');
  return source.match(/^<template>([\s\S]*?)<\/template>/)?.[1] || '';
}

describe('miniapp page topology', () => {
  const config = readJson('pages.json');
  const registered = config.pages.map((page) => page.path);

  it('uses 首页 / 找菜 / 社区 / 我的 as the four tabs', () => {
    assert.deepEqual(config.tabBar.list.map((tab) => tab.text), ['首页', '找菜', '社区', '我的']);
    assert.deepEqual(config.tabBar.list.map((tab) => tab.pagePath), TAB_PATHS);
  });

  it('registers every planned student page and provides its Vue file', () => {
    const required = [
      ...TAB_PATHS,
      'pages/login/login', 'pages/recommend/recommend', 'pages/vision/vision',
      'pages/canteens/canteens', 'pages/canteen-detail/canteen-detail', 'pages/stall-detail/stall-detail',
      'pages/rankings/rankings', 'pages/regions/regions', 'pages/region-detail/region-detail',
      'pages/dish-detail/dish-detail', 'pages/health-profile/health-profile', 'pages/saved/saved',
      'pages/orders/orders', 'pages/community-publish/community-publish',
      'pages/health/health', 'pages/agent/agent', 'pages/privacy/privacy', 'pages/terms/terms'
    ];
    for (const pagePath of required) {
      assert.ok(registered.includes(pagePath), `${pagePath} is not registered`);
      assert.ok(existsSync(join(MINIAPP, `${pagePath}.vue`)), `${pagePath}.vue is missing`);
    }
  });

  it('keeps login as the entry page and provides all tab icons', () => {
    assert.equal(config.pages[0].path, 'pages/login/login');
    for (const tab of config.tabBar.list) {
      assert.ok(existsSync(join(MINIAPP, tab.iconPath)), `${tab.iconPath} is missing`);
      assert.ok(existsSync(join(MINIAPP, tab.selectedIconPath)), `${tab.selectedIconPath} is missing`);
    }
  });

  it('uses switchTab only for registered tab pages', () => {
    for (const file of walk(MINIAPP, ['.vue', '.js'])) {
      const source = readFileSync(file, 'utf8');
      const destinations = [...source.matchAll(/switchTab\s*\(\s*\{\s*url\s*:\s*['"]([^'"]+)/g)].map((match) => match[1].replace(/^\//, ''));
      for (const destination of destinations) {
        assert.ok(TAB_PATHS.includes(destination), `${relative(MINIAPP, file)} switchTab targets non-tab page ${destination}`);
      }
    }
  });

  it('redirects legacy health and advisor pages to their replacements', () => {
    assert.match(readFileSync(join(MINIAPP, 'pages/health/health.vue'), 'utf8'), /redirectTo[\s\S]*health-profile/);
    assert.match(readFileSync(join(MINIAPP, 'pages/agent/agent.vue'), 'utf8'), /redirectTo[\s\S]*recommend/);
  });
});

describe('miniapp safety contracts', () => {
  const sourceFiles = walk(MINIAPP, ['.vue', '.js', '.json']);
  const combined = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

  it('does not expose an order creation client or POST to /api/orders', () => {
    assert.doesNotMatch(combined, /createOrder\s*[:=(]/);
    assert.doesNotMatch(combined, /request\(\s*['"]\/api\/orders['"]\s*,\s*\{\s*method\s*:\s*['"]POST['"]/);
    assert.match(readFileSync(join(MINIAPP, 'pages/orders/orders.vue'), 'utf8'), /联调中，暂不可提交/);
  });

  it('keeps development fixtures out of operational pages and store', () => {
    const operational = sourceFiles
      .filter((file) => !file.endsWith(join('domain', 'seedData.js')))
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(operational, /from\s+['"][^'"]*seedData\.js['"]/);
  });

  it('uses miniapp/src as the only source tree', () => {
    for (const stalePath of ['App.vue', 'main.js', 'manifest.json', 'pages.json', 'pages', 'services', 'stores', 'styles', 'utils']) {
      assert.equal(existsSync(join('miniapp', stalePath)), false, `stale source path miniapp/${stalePath} still exists`);
    }
  });

  it('provides a one-tap student demo login without exposing admin credentials', () => {
    const login = readFileSync(join(MINIAPP, 'pages/login/login.vue'), 'utf8');
    assert.match(login, /DEMO_STUDENT/);
    assert.match(login, /演示账号登录/);
    assert.doesNotMatch(login, /DEMO_ADMIN|admin123/);
  });
});

describe('miniapp student navigation visibility', () => {
  const home = readFileSync(join(MINIAPP, 'pages/home/home.vue'), 'utf8');
  const dishes = readFileSync(join(MINIAPP, 'pages/dishes/dishes.vue'), 'utf8');
  const profile = readFileSync(join(MINIAPP, 'pages/profile/profile.vue'), 'utf8');

  it('centralizes every student entry with a valid route and unique icon', () => {
    assert.deepEqual(CORE_ENTRY_IDS, ['dishes', 'recommend']);
    assert.deepEqual(EXPLORE_ENTRY_IDS, ['canteens', 'rankings', 'regions']);
    assert.deepEqual(COMMUNITY_ENTRY_IDS, ['reviews', 'community']);
    assert.equal(new Set(STUDENT_ENTRIES.map((entry) => entry.id)).size, STUDENT_ENTRIES.length);
    for (const entry of STUDENT_ENTRIES) {
      assert.match(entry.route, /^\/pages\//);
      assert.ok(['navigateTo', 'switchTab'].includes(entry.navigationType));
      assert.match(entry.icon, /\.png$/, `${entry.id} must use a PNG icon in the mini program`);
      assert.ok(existsSync(join(MINIAPP, entry.icon.replace(/^\//, ''))), `${entry.icon} is missing`);
    }
    assert.deepEqual(getStudentEntries(EXPLORE_ENTRY_IDS).map((entry) => entry.id), EXPLORE_ENTRY_IDS);
  });

  it('uses rasterized Lucide-style icons in student templates', () => {
    const templates = walk(join(MINIAPP, 'pages'), ['.vue'])
      .concat(walk(join(MINIAPP, 'components'), ['.vue']))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    assert.doesNotMatch(templates, /\/static\/icons\/[A-Za-z0-9-]+\.svg/);
    const iconDir = join(MINIAPP, 'static/icons');
    for (const svgName of readdirSync(iconDir).filter((name) => name.endsWith('.svg'))) {
      const png = readFileSync(join(iconDir, svgName.replace(/\.svg$/, '.png')));
      assert.equal(png.toString('ascii', 1, 4), 'PNG', `${svgName} is missing its PNG counterpart`);
      assert.equal(png.readUInt32BE(16), 64, `${svgName} PNG width must be 64px`);
      assert.equal(png.readUInt32BE(20), 64, `${svgName} PNG height must be 64px`);
    }
  });

  it('keeps the homepage concise with reveal, core actions, and fixed exploration', () => {
    assert.match(home, /<sc-reveal-card/);
    assert.match(home, /class="core-actions"/);
    assert.match(home, /class="explore-grid"/);
    assert.deepEqual(getStudentEntries(EXPLORE_ENTRY_IDS).map((entry) => entry.label), ['食堂导航', '校园排行榜', '区域推荐']);
    assert.doesNotMatch(home, /brand-intro|greeting|数据已连接|档案目标|评分菜品/);
    assert.doesNotMatch(home, /sc-feature-orbit|HOME_ORBIT_ENTRY_IDS|profile-entry|openHealthProfile/);
    assert.equal(existsSync(join(MINIAPP, 'components/sc-feature-orbit/sc-feature-orbit.vue')), false);
    assert.equal(existsSync(join(MINIAPP, 'domain/featureOrbit.js')), false);
    assert.ok(home.indexOf('<sc-reveal-card') < home.indexOf('class="core-actions"'));
    assert.ok(home.indexOf('class="core-actions"') < home.indexOf('class="explore-grid"'));
  });

  it('provides contextual exploration shortcuts on the find-dishes tab', () => {
    assert.match(dishes, /EXPLORE_ENTRY_IDS/);
    assert.match(dishes, /class="explore-shortcuts"/);
    assert.match(dishes, /openExplore/);
  });

  it('promotes favorites to a first-screen preview in profile', () => {
    assert.match(profile, /class="favorite-preview"/);
    assert.match(profile, /我的收藏/);
    assert.match(profile, /favoritePreview/);
    assert.match(profile, /saved\/saved\?panel=favorites/);
  });
});

describe('miniapp native visual contracts', () => {
  const uiFiles = walk(join(MINIAPP, 'pages'), ['.vue'])
    .concat(walk(join(MINIAPP, 'components'), ['.vue']))
    .concat(walk(join(MINIAPP, 'styles'), ['.css']));

  it('uses readable custom type sizes and restrained font weights', () => {
    for (const file of uiFiles) {
      const source = readFileSync(file, 'utf8');
      const sizes = [...source.matchAll(/font-size:\s*(\d+)rpx/g)].map((match) => Number(match[1]));
      const weights = [...source.matchAll(/font-weight:\s*(\d+)/g)].map((match) => Number(match[1]));
      assert.ok(sizes.every((size) => size >= 22), `${relative(MINIAPP, file)} contains text smaller than 22rpx`);
      assert.ok(weights.every((weight) => weight <= 600), `${relative(MINIAPP, file)} contains font weight above 600`);
    }
  });

  it('does not use glass blur or endless decorative animation', () => {
    const combined = uiFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(combined, /backdrop-filter/);
    assert.doesNotMatch(combined, /animation:[^;]*infinite/);
  });

  it('uses the agreed palette for the page and native tab bar', () => {
    const styles = readFileSync(join(MINIAPP, 'styles/main.css'), 'utf8');
    const config = readJson('pages.json');
    assert.match(styles, /--bg:\s*#f6f7f5/);
    assert.match(styles, /--brand:\s*#237a57/);
    assert.match(styles, /--ink:\s*#17211b/);
    assert.match(styles, /--core:\s*#16785d/);
    assert.match(styles, /--explore:\s*#c47a19/);
    assert.match(styles, /--community:\s*#4778a8/);
    assert.match(styles, /--records:\s*#d9634c/);
    assert.match(styles, /--profile:\s*#2f8a6a/);
    assert.doesNotMatch(styles, /button\s*\{[^}]*min-height:\s*88rpx/s);
    assert.match(styles, /button::after\s*\{[^}]*border:\s*0/s);
    assert.match(styles, /\.primary-btn,[\s\S]*?min-height:\s*88rpx/);
    assert.equal(config.tabBar.color, '#66736c');
    assert.equal(config.tabBar.selectedColor, '#237a57');
  });

  it('keeps compact segmented controls visually small while preserving an 88rpx touch target', () => {
    const segmented = readFileSync(join(MINIAPP, 'components/sc-segmented-control/sc-segmented-control.vue'), 'utf8');
    const dishesPage = readFileSync(join(MINIAPP, 'pages/dishes/dishes.vue'), 'utf8');
    const communityPage = readFileSync(join(MINIAPP, 'pages/community/community.vue'), 'utf8');
    assert.match(segmented, /density:\s*\{[^}]*default:\s*'regular'/s);
    assert.match(segmented, /\.segmented\s*\{[^}]*min-height:88rpx/s);
    assert.match(segmented, /\.density-compact \.segmented-surface\s*\{[^}]*height:64rpx/s);
    assert.match(segmented, /\.density-compact \.segment-visual\s*\{[^}]*height:56rpx/s);
    assert.match(dishesPage, /sortDirection[^>]*density="compact"/);
    assert.match(communityPage, /\.publish-button\s*\{[^}]*min-height:88rpx/s);
    assert.match(communityPage, /\.publish-visual\s*\{[^}]*height:64rpx/s);
    assert.match(communityPage, /\.picker-touch\s*\{[^}]*min-height:88rpx/s);
    assert.match(communityPage, /\.picker-box\s*\{[^}]*height:64rpx/s);
    assert.match(communityPage, /\.post-target\s*\{[^}]*min-height:88rpx/s);
  });

  it('separates compact control surfaces from their touch targets', () => {
    const rankings = readFileSync(join(MINIAPP, 'pages/rankings/rankings.vue'), 'utf8');
    const health = readFileSync(join(MINIAPP, 'pages/health-profile/health-profile.vue'), 'utf8');
    const detail = readFileSync(join(MINIAPP, 'pages/dish-detail/dish-detail.vue'), 'utf8');
    const publish = readFileSync(join(MINIAPP, 'pages/community-publish/community-publish.vue'), 'utf8');
    const saved = readFileSync(join(MINIAPP, 'pages/saved/saved.vue'), 'utf8');
    assert.match(rankings, /\.filter-row button\s*\{[^}]*min-height:88rpx/s);
    assert.match(rankings, /\.filter-row button>view\s*\{[^}]*min-height:60rpx/s);
    assert.match(health, /\.chip-grid button\s*\{[^}]*min-height:88rpx/s);
    assert.match(health, /\.chip-grid button>view\s*\{[^}]*min-height:64rpx/s);
    assert.match(detail, /\.score-buttons button>view\s*\{[^}]*min-height:64rpx/s);
    assert.match(publish, /\.rating-field button>view\s*\{[^}]*min-height:64rpx/s);
    assert.match(saved, /\.entry-actions button>view\s*\{[^}]*min-height:64rpx/s);
    assert.match(health, /\.save-button\s*\{[^}]*min-height:88rpx/s);
    assert.match(detail, /\.submit-review\s*\{[^}]*min-height:88rpx/s);
  });

  it('keeps page backgrounds unified while tones remain local accents', () => {
    const shell = readFileSync(join(MINIAPP, 'components/sc-page-shell/sc-page-shell.vue'), 'utf8');
    assert.match(shell, /\.page-shell\s*\{[^}]*background:var\(--bg\)/s);
    assert.match(shell, /\.nav-safe\s*\{[^}]*background:var\(--bg\)/s);
    assert.doesNotMatch(shell, /--tone-bg/);
    assert.doesNotMatch(shell, /\.tone-[^{]+\{[^}]*--brand/s);
  });

  it('refreshes shared student data after the cache becomes stale', () => {
    const store = readFileSync(join(MINIAPP, 'stores/canteenStore.js'), 'utf8');
    const tabPages = ['pages/home/home.vue', 'pages/dishes/dishes.vue', 'pages/community/community.vue', 'pages/profile/profile.vue'];
    assert.match(store, /const lastLoadedAt = ref\(0\)/);
    assert.match(store, /async function refreshIfStale/);
    assert.match(store, /refreshIfStale,/);
    for (const page of tabPages) assert.match(readFileSync(join(MINIAPP, page), 'utf8'), /store\.refreshIfStale\(\)/);
  });
});

describe('manifest and production environment', () => {
  const manifest = readJson('manifest.json');
  const mp = manifest['mp-weixin'];

  it('enables WeChat privacy checking without deprecated camera permission', () => {
    assert.equal(mp.__usePrivacyCheck__, true);
    assert.equal(mp.setting.urlCheck, false);
    assert.equal(mp.permission?.['scope.camera'], undefined);
  });

  it('provides an HTTPS production API template', () => {
    const content = readFileSync(join('miniapp', '.env.production.example'), 'utf8');
    const url = content.match(/VITE_API_BASE_URL=(.+)/)?.[1]?.trim() || '';
    assert.ok(url.startsWith('https://'));
    assert.doesNotMatch(url, /localhost|127\.0\.0\.1/);
  });
});

describe('critical templates avoid emoji pictographs', () => {
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;
  const critical = [
    'pages/home/home.vue', 'pages/dishes/dishes.vue', 'pages/community/community.vue',
    'pages/profile/profile.vue', 'pages/recommend/recommend.vue', 'pages/vision/vision.vue',
    'pages/health-profile/health-profile.vue', 'pages/orders/orders.vue'
  ];
  for (const page of critical) {
    it(`${page} uses image or text UI instead of emoji`, () => {
      const template = readVueTemplate(page).replace(/\{\{[\s\S]*?\}\}/g, '');
      assert.equal(template.match(emojiPattern), null, `${page} contains emoji pictographs`);
    });
  }
});
