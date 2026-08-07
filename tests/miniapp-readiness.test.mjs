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
import { verifiedDishImageUrl } from '../miniapp/src/domain/dishPresentation.js';

const MINIAPP = 'miniapp/src';
const TAB_PATHS = ['pages/home/home', 'pages/dishes/dishes', 'pages/community/community', 'pages/profile/profile'];
const WOT_ICON_NAMES = new Set(['search-line', 'bulb', 'location', 'trophy', 'compass', 'star', 'message', 'heart', 'store', 'safe', 'camera']);

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

  it('submits idempotent at-stall reservations through the production orders API', () => {
    assert.match(combined, /createOrder\s*[:=(]/);
    assert.match(combined, /request\(\s*['"]\/api\/orders['"]\s*,\s*\{\s*method\s*:\s*['"]POST['"]/);
    assert.match(readFileSync(join(MINIAPP, 'pages/orders/orders.vue'), 'utf8'), /提交预约/);
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

  it('does not expose demo login credentials in the production miniapp', () => {
    const login = readFileSync(join(MINIAPP, 'pages/login/login.vue'), 'utf8');
    assert.doesNotMatch(login, /DEMO_STUDENT|演示账号登录/);
    assert.doesNotMatch(login, /DEMO_ADMIN|admin123/);
  });
});

describe('miniapp student navigation visibility', () => {
  const home = readFileSync(join(MINIAPP, 'pages/home/home.vue'), 'utf8');
  const dishes = readFileSync(join(MINIAPP, 'pages/dishes/dishes.vue'), 'utf8');
  const profile = readFileSync(join(MINIAPP, 'pages/profile/profile.vue'), 'utf8');

  it('centralizes every student entry with valid Wot icon metadata', () => {
    assert.deepEqual(CORE_ENTRY_IDS, ['dishes', 'recommend', 'collector']);
    assert.deepEqual(EXPLORE_ENTRY_IDS, ['canteens', 'rankings', 'regions']);
    assert.deepEqual(COMMUNITY_ENTRY_IDS, ['reviews', 'community']);
    assert.equal(new Set(STUDENT_ENTRIES.map((entry) => entry.id)).size, STUDENT_ENTRIES.length);
    for (const entry of STUDENT_ENTRIES) {
      assert.match(entry.route, /^\/pages\//);
      assert.ok(['navigateTo', 'switchTab'].includes(entry.navigationType));
      assert.equal('icon' in entry, false, `${entry.id} must not reference image metadata`);
      assert.equal(typeof entry.iconName, 'string', `${entry.id} must provide a Wot icon name`);
      assert.doesNotMatch(entry.iconName, /\//, `${entry.id} must not use an image path as an icon`);
      assert.ok(WOT_ICON_NAMES.has(entry.iconName), `${entry.id} uses an unsupported Wot icon name`);
    }
    assert.deepEqual(getStudentEntries(EXPLORE_ENTRY_IDS).map((entry) => entry.id), EXPLORE_ENTRY_IDS);
  });

  it('uses licensed Phosphor raster icons in the native tab bar', () => {
    const config = readJson('pages.json');
    const tabDir = join(MINIAPP, 'static/tab');
    assert.deepEqual(config.tabBar.list.map((item) => item.pagePath), TAB_PATHS);
    for (const item of config.tabBar.list) {
      for (const iconPath of [item.iconPath, item.selectedIconPath]) {
        const png = readFileSync(join(MINIAPP, iconPath));
        assert.equal(png.toString('ascii', 1, 4), 'PNG', `${iconPath} must be a PNG`);
        assert.equal(png.readUInt32BE(16), 81, `${iconPath} width must be 81px`);
        assert.equal(png.readUInt32BE(20), 81, `${iconPath} height must be 81px`);
      }
    }
    const licensePath = join(MINIAPP, 'static/tab/LICENSE-PHOSPHOR.txt');
    assert.ok(existsSync(licensePath), 'Phosphor icon license is missing');
    assert.match(readFileSync(licensePath, 'utf8'), /MIT License/);
    assert.deepEqual(readdirSync(tabDir).sort(), [
      'LICENSE-PHOSPHOR.txt',
      'community-active.png', 'community-normal.png',
      'dishes-active.png', 'dishes-normal.png',
      'home-active.png', 'home-normal.png',
      'profile-active.png', 'profile-normal.png'
    ].sort());
  });

  it('keeps the homepage concise with reveal, core actions, and fixed exploration', () => {
    assert.match(home, /<sc-reveal-card/);
    assert.match(home, /class="core-actions"/);
    assert.match(home, /class="[^"]*explore-grid[^"]*"/);
    assert.deepEqual(getStudentEntries(EXPLORE_ENTRY_IDS).map((entry) => entry.label), ['食堂导航', '校园排行榜', '地区口味推荐']);
    assert.match(home, /:title="greeting"/);
    assert.match(home, /const greeting = computed/);
    assert.doesNotMatch(home, /brand-intro|数据已连接|档案目标|评分菜品/);
    assert.doesNotMatch(home, /sc-feature-orbit|HOME_ORBIT_ENTRY_IDS|profile-entry|openHealthProfile/);
    assert.equal(existsSync(join(MINIAPP, 'components/sc-feature-orbit/sc-feature-orbit.vue')), false);
    assert.equal(existsSync(join(MINIAPP, 'domain/featureOrbit.js')), false);
    assert.ok(home.indexOf('<sc-reveal-card') < home.indexOf('class="core-actions"'));
    assert.ok(home.indexOf('class="core-actions"') < home.indexOf('explore-grid'));
  });

  it('provides contextual exploration shortcuts on the find-dishes tab', () => {
    assert.match(dishes, /EXPLORE_ENTRY_IDS/);
    assert.match(dishes, /class="explore-shortcuts"/);
    assert.match(dishes, /openExplore/);
  });

  it('promotes favorites to a first-screen preview in profile', () => {
    assert.match(profile, /class="[^"]*favorite-preview[^"]*"/);
    assert.match(profile, />收藏</);
    assert.match(profile, /saved\.favorites\.length/);
    assert.match(profile, /class="favorite-count"/);
    assert.match(profile, /saved\/saved\?panel=favorites/);
    assert.match(profile, /<image\b[^>]*store\.user\.value\?\.avatarUrl/);
    assert.doesNotMatch(profile, /favoritePreview/);
  });
});

describe('miniapp native visual contracts', () => {
  const uiFiles = walk(join(MINIAPP, 'pages'), ['.vue'])
    .concat(walk(join(MINIAPP, 'components'), ['.vue']))
    .concat(walk(join(MINIAPP, 'styles'), ['.css']));

  it('uses readable custom type sizes and restrained font weights', () => {
    for (const file of uiFiles) {
      const source = readFileSync(file, 'utf8');
      const sizes = [...source.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
      const weights = [...source.matchAll(/font-weight:\s*(\d+)/g)].map((match) => Number(match[1]));
      const relPath = relative(MINIAPP, file).replaceAll('\\', '/');
      const allowedSizes = relPath === 'components/sc-app-nav/sc-app-nav.vue'
        ? [10, 11, 12, 14, 16, 20, 24, 28]
        : [12, 14, 16, 20, 24, 28];
      assert.ok(sizes.every((size) => allowedSizes.includes(size)), `${relPath} uses a font size outside its type scale`);
      assert.ok(weights.every((weight) => weight <= 600), `${relative(MINIAPP, file)} contains font weight above 600`);
      assert.doesNotMatch(source, /\d+rpx/, `${relative(MINIAPP, file)} must not scale visual dimensions with rpx`);
    }
  });

  it('does not use glass blur, gradients, or endless decorative animation', () => {
    const combined = uiFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(combined, /backdrop-filter/);
    assert.doesNotMatch(combined, /(?:linear|radial)-gradient/);
    const infiniteAnimations = [...combined.matchAll(/animation:[^;]*infinite[^;}]*[;}]/g)].map((match) => match[0]);
    assert.deepEqual(infiniteAnimations, ['animation:scan 1.8s ease-in-out infinite alternate}']);
    const vision = readFileSync(join(MINIAPP, 'pages/vision/vision.vue'), 'utf8');
    assert.match(vision, /v-if="imagePath&&loading" class="scan-line"/);
  });

  it('uses neutral canvas tokens and dynamic semantic tones for controls and navigation', () => {
    const styles = readFileSync(join(MINIAPP, 'styles/main.css'), 'utf8');
    const shell = readFileSync(join(MINIAPP, 'components/sc-page-shell/sc-page-shell.vue'), 'utf8');
    const appNav = readFileSync(join(MINIAPP, 'components/sc-app-nav/sc-app-nav.vue'), 'utf8');
    const nativeTabLogic = readFileSync(join(MINIAPP, 'custom-tab-bar/index.js'), 'utf8');
    const nativeTabMarkup = readFileSync(join(MINIAPP, 'custom-tab-bar/index.wxml'), 'utf8');
    const nativeTab = readFileSync(join(MINIAPP, 'custom-tab-bar/index.wxss'), 'utf8');
    const login = readFileSync(join(MINIAPP, 'pages/login/login.vue'), 'utf8');
    const config = readJson('pages.json');
    assert.match(styles, /--bg:\s*#f7f8fa/);
    assert.match(styles, /--surface:\s*#ffffff/);
    assert.match(styles, /--ink:\s*#181a1f/);
    assert.match(styles, /--ink-2:\s*#5e626a/);
    assert.match(styles, /--line:\s*#e6e8ec/);
    assert.match(styles, /--brand:\s*#e23d4a/);
    assert.match(styles, /--brand-soft:\s*#fff1f2/);
    assert.match(styles, /--discover:\s*#356ae6/);
    assert.match(styles, /--discover-soft:\s*#eef4ff/);
    assert.match(styles, /--community:\s*#7656d6/);
    assert.match(styles, /--community-soft:\s*#f5f1ff/);
    assert.match(styles, /--records:\s*#238460/);
    assert.match(styles, /--records-soft:\s*#eef8f3/);
    assert.match(styles, /--ranking:\s*#a56a00/);
    assert.match(styles, /--ranking-soft:\s*#fff7e8/);
    assert.match(styles, /--success:\s*#238460/);
    assert.match(styles, /--warning:\s*#a56a00/);
    assert.match(styles, /--danger:\s*#b42318/);
    assert.match(styles, /--info:\s*#356ae6/);
    assert.match(styles, /--radius-large:\s*8px/);
    assert.match(styles, /--control-height:\s*44px/);
    assert.match(styles, /--content-max:\s*680px/);
    assert.doesNotMatch(styles, /button\s*\{[^}]*min-height:\s*88rpx/s);
    assert.match(styles, /button::after\s*\{[^}]*border:\s*0/s);
    assert.match(styles, /\.primary-btn,[\s\S]*?min-height:\s*var\(--control-height\)/);
    assert.match(styles, /\.outline-btn/);
    assert.match(styles, /\.destructive-btn/);
    assert.match(styles, /@media \(max-width:\s*359px\)/);
    assert.match(styles, /@media \(min-width:\s*480px\) and \(max-width:\s*767px\)/);
    assert.match(styles, /@media \(min-width:\s*768px\)[\s\S]*--content-max:\s*1120px/);
    assert.match(shell, /height:48px/);
    assert.match(shell, /animation:page-enter var\(--motion-base\)/);
    assert.match(shell, /primary6:\s*activeTone\.value\.accent/);
    assert.match(shell, /segmentedItemBgActive:\s*'#ffffff'/);
    assert.match(shell, /switchColorActiveBg:\s*activeTone\.value\.accent/);
    for (const tone of ['meal', 'discover', 'community', 'records', 'health', 'ranking']) {
      assert.match(shell, new RegExp(`${tone}:\\s*\\{`));
    }
    assert.match(appNav, /class="nav-selection"/);
    assert.match(nativeTabMarkup, /class="nav-selection/);
    assert.match(appNav, /transition:transform 220ms/);
    assert.match(nativeTab, /transition:transform \.22s/);
    assert.match(nativeTabLogic, /setTimeout\(\(\) => wx\.switchTab\(\{ url: route \}\), 220\)/);
    assert.doesNotMatch(nativeTabLogic, /vibrateShort/);
    assert.doesNotMatch(`${appNav}\n${nativeTabMarkup}`, /active-surface|active-mark/);
    for (const color of ['#e23d4a', '#356ae6', '#7656d6', '#238460']) {
      assert.match(nativeTab, new RegExp(color));
    }
    assert.doesNotMatch(shell, /colorTheme|segmentedActiveBg|switchActiveColor/);
    assert.equal(config.tabBar.custom, true);
    assert.equal(config.tabBar.color.toLowerCase(), '#858991');
    assert.equal(config.tabBar.selectedColor.toLowerCase(), '#e23d4a');
    assert.equal(config.globalStyle.backgroundColor.toLowerCase(), '#f7f8fa');
    assert.match(login, /<sc-page-shell hide-nav tone="neutral">/);
    assert.doesNotMatch(login, /\.wechat-btn[^}]*background:var\(--brand\)/s);
    assert.match(login, /\.login-card[^}]*box-shadow:none/s);
  });

  it('renders images only for verified dishes, community content, and vision content', () => {
    const templates = walk(join(MINIAPP, 'pages'), ['.vue']).concat(walk(join(MINIAPP, 'components'), ['.vue']));
    const imageUsages = [];
    for (const file of templates) {
      const source = readFileSync(file, 'utf8');
      for (const _match of source.matchAll(/<image\b/g)) imageUsages.push(relative(MINIAPP, file).replaceAll('\\', '/'));
    }
    assert.deepEqual(imageUsages.sort(), [
      'components/sc-dish-media/sc-dish-media.vue',
      'components/sc-illustration/sc-illustration.vue',
      'pages/community-publish/community-publish.vue',
      'pages/community/community.vue',
      'pages/profile/profile.vue',
      'pages/vision/vision.vue',
      'pages/vision/vision.vue'
    ].sort());
    const dishMedia = readFileSync(join(MINIAPP, 'components/sc-dish-media/sc-dish-media.vue'), 'utf8');
    assert.match(dishMedia, /verifiedDishImageUrl/);
    assert.match(dishMedia, /lazy-load/);
    assert.match(dishMedia, /@error="handleError"/);
    assert.equal(verifiedDishImageUrl({ imageUrl: 'https://example.test/stock.jpg' }), '');
    assert.equal(verifiedDishImageUrl({ imageUrl: 'https://example.test/real.jpg', imageStatus: 'approved' }), 'https://example.test/real.jpg');
    assert.equal(verifiedDishImageUrl({ imageUrl: 'https://example.test/real.jpg', imageVerified: true }), 'https://example.test/real.jpg');
    assert.equal(existsSync(join(MINIAPP, 'static/icons')), false);
    assert.equal(existsSync(join(MINIAPP, 'static/food')), false);
    assert.equal(existsSync(join(MINIAPP, 'static/brand')), false);
    assert.deepEqual(readdirSync(join(MINIAPP, 'static/illustrations')).sort(), [
      'brand-mark.svg', 'empty-community.svg', 'empty-saved.svg',
      'empty-search.svg', 'order-complete.svg', 'vision-stage.svg'
    ].sort());
    const illustration = readFileSync(join(MINIAPP, 'components/sc-illustration/sc-illustration.vue'), 'utf8');
    assert.match(illustration, /const ASSETS = Object\.freeze/);
    for (const asset of readdirSync(join(MINIAPP, 'static/illustrations'))) assert.match(illustration, new RegExp(asset.replace('.', '\\.')));
    const combined = templates.map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(combined, /\/static\/(?:icons|food|brand)\//);
    assert.doesNotMatch(combined, /#(?:167a5b|237a57|0c6248)/i);
  });

  it('keeps compact segmented controls visually small within 44px touch targets', () => {
    const segmented = readFileSync(join(MINIAPP, 'components/sc-segmented-control/sc-segmented-control.vue'), 'utf8');
    const dishesPage = readFileSync(join(MINIAPP, 'pages/dishes/dishes.vue'), 'utf8');
    const communityPage = readFileSync(join(MINIAPP, 'pages/community/community.vue'), 'utf8');
    assert.match(segmented, /density:\s*\{[^}]*default:\s*'regular'/s);
    assert.match(segmented, /<wd-segmented/);
    assert.match(segmented, /\.segmented\s*\{[^}]*min-height:44px/s);
    assert.match(segmented, /\.density-compact :deep\(\.wd-segmented\)\s*\{[^}]*height:32px/s);
    assert.match(segmented, /\.density-compact :deep\(\.wd-segmented__item\)\s*\{[^}]*height:28px/s);
    assert.match(dishesPage, /sortDirection[^>]*density="compact"/);
    assert.match(communityPage, /\.publish-button\s*\{[^}]*min-height:44px/s);
    assert.match(communityPage, /\.publish-visual\s*\{[^}]*height:36px/s);
    assert.match(communityPage, /\.picker-touch\s*\{[^}]*min-height:44px/s);
    assert.match(communityPage, /\.picker-box\s*\{[^}]*height:40px/s);
    assert.match(communityPage, /\.post-target\s*\{[^}]*min-height:48px/s);
    assert.match(communityPage, /<sc-responsive-panel/);
    assert.match(communityPage, /@media \(min-width:768px\)/);
  });

  it('separates compact control surfaces from their touch targets', () => {
    const rankings = readFileSync(join(MINIAPP, 'pages/rankings/rankings.vue'), 'utf8');
    const health = readFileSync(join(MINIAPP, 'pages/health-profile/health-profile.vue'), 'utf8');
    const detail = readFileSync(join(MINIAPP, 'pages/dish-detail/dish-detail.vue'), 'utf8');
    const publish = readFileSync(join(MINIAPP, 'pages/community-publish/community-publish.vue'), 'utf8');
    const saved = readFileSync(join(MINIAPP, 'pages/saved/saved.vue'), 'utf8');
    assert.match(rankings, /\.filter-row button\s*\{[^}]*min-height:44px/s);
    assert.match(health, /\.chip-grid button\s*\{[^}]*min-height:44px/s);
    assert.match(detail, /\.score-buttons button\s*\{[^}]*min-height:44px/s);
    assert.match(detail, /\.score-buttons button>view\s*\{[^}]*min-height:34px/s);
    assert.match(publish, /\.rating-field button\s*\{[^}]*min-height:44px/s);
    assert.match(saved, /\.entry-actions button,\.again-button\s*\{[^}]*min-height:44px/s);
    assert.match(health, /\.save-button\s*\{[^}]*min-height:44px/s);
    assert.match(detail, /\.submit-review\s*\{[^}]*min-height:44px/s);
  });

  it('keeps page backgrounds neutral while exposing local semantic tone variables', () => {
    const shell = readFileSync(join(MINIAPP, 'components/sc-page-shell/sc-page-shell.vue'), 'utf8');
    assert.match(shell, /\.page-shell\s*\{[^}]*background:var\(--bg\)/s);
    assert.match(shell, /\.nav-safe\s*\{[^}]*background:var\(--surface\)/s);
    assert.match(shell, /'--module-accent': activeTone\.value\.accent/);
    assert.match(shell, /const TONE_ALIASES = \{ default:'neutral', core:'meal', explore:'discover', profile:'records' \}/);
    assert.match(shell, /tabId:\s*\{ type: String, default: '' \}/);
    assert.match(shell, /<sc-app-nav v-if="tabId" :active="tabId"/);
    assert.doesNotMatch(shell, /--tone-bg/);
  });

  it('uses real-node reveal phases with a true-device fallback and strict motion storage', () => {
    const reveal = readFileSync(join(MINIAPP, 'components/sc-reveal-card/sc-reveal-card.vue'), 'utf8');
    const store = readFileSync(join(MINIAPP, 'stores/canteenStore.js'), 'utf8');
    assert.match(reveal, /'covered'/);
    assert.match(reveal, /visualPhase\.value = 'arming'/);
    assert.match(reveal, /visualPhase\.value = 'bursting'/);
    assert.match(reveal, /visualPhase\.value = 'revealed'/);
    assert.match(reveal, /v-for="part in 8"/);
    assert.match(reveal, /class="burst-sentinel" @animationend\.stop="finishReveal"/);
    assert.match(reveal, /setTimeout\(finishReveal, 800\)/);
    assert.match(reveal, /animation:reveal-complete 530ms/);
    assert.match(reveal, /\.phase-bursting \.dish-name \{ animation:detail-in/);
    assert.match(reveal, /triggerHaptic\(props\.reducedMotion \? 'light' : 'medium'\)/);
    assert.doesNotMatch(reveal, /\.reveal[^\n{]*::after/);
    assert.match(store, /getStorageSync\?\.\(MOTION_KEY\) === '1'/);
  });

  it('keeps WeChat automation on a real reveal element without a view-model shortcut', () => {
    const packageJson = JSON.parse(readFileSync(join('miniapp', 'package.json'), 'utf8'));
    const automationPath = join('miniapp', 'tests/ui/wechat-automator.mjs');
    const automation = readFileSync(automationPath, 'utf8');
    assert.equal(packageJson.devDependencies['miniprogram-automator'], '0.12.1');
    assert.equal(packageJson.devDependencies['@weapp-vite/miniprogram-automator'], '1.2.8');
    assert.match(automation, /import \{ Launcher \} from '@weapp-vite\/miniprogram-automator'/);
    assert.match(automation, /page\.renderedNodes\(selector/);
    assert.match(automation, /componentSelectors:\s*revealScopes/);
    assert.match(automation, /page\.\$\('\.reveal-primary', \{ fallback: false/);
    assert.match(automation, /revealButton\.tap\(\)/);
    assert.doesNotMatch(automation, /callViewModel\(['"]handleReveal/);
    assert.equal(existsSync(join('miniapp', 'tests/ui/probe-automator.mjs')), false);
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
    assert.equal(mp.setting.urlCheck, true);
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
