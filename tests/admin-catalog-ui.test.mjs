import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync('src/views/AdminCatalogView.vue', 'utf8');
const drawer = readFileSync('src/components/CatalogEditorDrawer.vue', 'utf8');
const areaFields = readFileSync('src/components/CatalogAreaFormFields.vue', 'utf8');
const dishFields = readFileSync('src/components/CatalogDishFormFields.vue', 'utf8');
const stallFields = readFileSync('src/components/CatalogStallFormFields.vue', 'utf8');
const admin = readFileSync('src/views/AdminView.vue', 'utf8');
const apiClient = readFileSync('src/services/apiClient.js', 'utf8');

describe('administrator catalog workspace UI contracts', () => {
  it('uses a fixed four-quadrant workspace with independent scrolling', () => {
    const positions = ['campus-main', 'north-zone', 'south-zone', 'east-zone'].map((id) => view.indexOf(`id: '${id}'`));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual([...positions].sort((left, right) => left - right), positions);
    assert.match(view, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(view, /grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(view, /\.venue-panel-scroll[^}]*overflow-y:\s*auto/s);
    assert.match(view, /scrollbar-gutter:\s*stable/);
    assert.match(view, /position:\s*sticky/);
  });

  it('renders the missing-venue state before the statistics branch', () => {
    const statsBranch = view.indexOf('<template v-else-if="modeByVenue[venue.id] === \'stats\'">');
    const missingBranch = view.indexOf('<template v-else-if="venue.missing">');
    assert.ok(statsBranch >= 0, 'statistics branch should remain explicit');
    assert.ok(missingBranch >= 0, 'missing venue branch should remain explicit');
    assert.ok(missingBranch < statsBranch, 'a missing venue must show its configuration state even when statistics mode is remembered');
    const missingBlock = view.slice(missingBranch, statsBranch);
    assert.match(missingBlock, /配置场所/);
  });

  it('shows all four statistics metrics with unambiguous labels', () => {
    const summary = view.match(/<div class="stats-total-line"[\s\S]*?<\/div>\s*<\/div>/)?.[0];
    assert.ok(summary, 'statistics view should expose its metric summary');
    for (const field of ['canteens', 'stalls', 'dishes', 'openStalls']) {
      assert.match(summary, new RegExp(`venue\\.counts\\?\\.${field}`), `missing summary field ${field}`);
    }
    assert.match(summary, /venue\.areaLabel|餐饮分区/);
    assert.match(summary, /档口总数/);
    assert.match(summary, /菜品总数/);
    assert.match(summary, /营业档口/);
    assert.match(view, /\.stats-total-line\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  });

  it('uses unified venue, area, stall and dish terminology', () => {
    for (const label of ['餐饮场所', '餐饮分区', '餐厅', '楼层餐区', '档口', '菜品', '待归类档口', '历史层级']) {
      assert.ok(view.includes(label) || drawer.includes(label), `missing ${label}`);
    }
    assert.doesNotMatch(view, /一级档口|子档口/);
    assert.match(view, /venueType === 'dining_complex'/);
  });

  it('provides directory and CSS chart views without adding a chart dependency', () => {
    assert.match(view, /modeByVenue/);
    assert.match(view, />目录<\/button>/);
    assert.match(view, />统计<\/button>/);
    assert.match(view, /class="bar stalls"/);
    assert.match(view, /class="bar dishes"/);
    assert.match(view, /locateArea\(venue, areaNode\)/);
    assert.doesNotMatch(view, /echarts|chart\.js/i);
  });

  it('persists URL selection, expansion and card scroll positions', () => {
    for (const key of ['venueId', 'areaId', 'stallId', 'dishId', 'q']) assert.ok(view.includes(key), `missing ${key}`);
    assert.match(view, /sessionStorage\.setItem\(storageKey\('expanded'/);
    assert.match(view, /sessionStorage\.setItem\(storageKey\(`scroll:/);
    assert.match(view, /watch\(storageScope,[\s\S]*loadWorkspaceMemory\(\)[\s\S]*restoreScrollPositions\(\)/);
    assert.match(view, /onBeforeRouteLeave/);
    assert.match(view, /onBeforeRouteUpdate/);
    assert.match(view, /internalSelectionUpdate/);
    assert.match(view, /selectionKeys\s*=\s*\['venueId',\s*'areaId',\s*'stallId',\s*'dishId'\]/);
    assert.match(view, /drawerDescriptor\.value\s*=\s*null/);
    assert.match(view, /confirmDiscard/);
    assert.match(view, /<HighlightText/);
    assert.doesNotMatch(view, /v-html/);
  });

  it('keeps search, statistics and saved-node location in the same visible hierarchy', () => {
    assert.match(view, /v-for="areaNode in visibleAreas\(venue\)"/);
    assert.match(view, /function maxAreaCount\(venue, key\)[^{]*\{[^}]*visibleAreas\(venue\)/);
    assert.match(view, /function dishSearchDetail\(dish\)/);
    assert.match(view, /标签：\$\{value\}/);
    assert.match(view, /食材：\$\{value\}/);
    assert.match(view, /class="dish-search-match"/);
    assert.match(view, /:data-node-key="`venue:\$\{venue\.id\}`"/);
    assert.match(view, /venue-panel\.is-highlighted/);
  });

  it('passes the current search term to the server-side catalog query', () => {
    const refreshBody = view.match(/async function refreshTree\(\)\s*\{([\s\S]*?)\n\}/)?.[1];
    assert.ok(refreshBody, 'refreshTree should remain an inspectable function');
    assert.match(refreshBody, /loadAdminCatalogTree\(\{[\s\S]*q:\s*(?:searchTerm\.value(?:\.trim\(\))?|normalizedQuery\(\)|String\(route\.query\.q\s*\|\|\s*''\))/);
    assert.match(apiClient, /getAdminCatalogTree\(params\s*=\s*\{\}\)/);
  });

  it('uses real dish thumbnails and classifies actionable errors', () => {
    assert.match(view, /<img[^>]+:src="dish\.imageUrl"[^>]*loading="lazy"/);
    assert.match(view, /dish\.image\s*\|\|\s*'餐'/);
    const source = `${view}\n${drawer}\n${apiClient}`;
    for (const kind of ['permission', 'validation', 'conflict', 'network']) {
      assert.match(source, new RegExp(kind), `missing ${kind} error classification`);
    }
    assert.match(source, /error(?:Kind|Category)|error\.kind/);
  });

  it('keeps write controls permission-aware and edits in the right drawer', () => {
    assert.match(view, /canWriteCanteens/);
    assert.match(view, /canWriteStalls/);
    assert.match(view, /canWriteDishes/);
    assert.match(view, /canBulkImportDishes/);
    assert.match(view, /hasCapability\('dish:bulk_import'\)/);
    assert.match(view, /CatalogEditorDrawer/);
    assert.match(drawer, /position:\s*fixed/);
    assert.match(drawer, /justify-content:\s*flex-end/);
    assert.match(drawer, /fixedId/);
    assert.match(drawer, /uploadDishImage/);
    assert.match(drawer, /identifyDishImage/);
    assert.match(drawer, /catalog-drawer-fieldset[^>]*:disabled="busy"/);
    assert.match(drawer, /needsClassification/);
  });

  it('shares catalog fields with the focused entry workspace and stops new child-stall tasks', () => {
    assert.match(drawer, /<CatalogAreaFormFields/);
    assert.match(admin, /<CatalogAreaFormFields/);
    assert.match(drawer, /<CatalogStallFormFields/);
    assert.match(admin, /<CatalogStallFormFields/);
    assert.match(drawer, /<CatalogDishFormFields/);
    assert.match(admin, /<CatalogDishFormFields/);
    assert.match(areaFields, /图片与客流设置/);
    assert.match(stallFields, /档口统一直属餐厅或楼层餐区/);
    assert.match(dishFields, /扩展营养、图片与展示/);
    const taskDefinitions = admin.match(/const entryTaskDefinitions\s*=\s*\[([\s\S]*?)\n\];/)?.[1];
    assert.ok(taskDefinitions);
    assert.doesNotMatch(taskDefinitions, /id:\s*['"]sub-stall['"]/);
    assert.match(admin, /entryTaskDefinitions\.filter\(\(task\) => task\.allowed\.value\)/);
  });

  it('uses single-column touch layouts and respects reduced motion', () => {
    assert.match(view, /@media \(max-width: 900px\)[\s\S]*grid-template-columns:\s*1fr/);
    assert.match(view, /height:\s*60dvh/);
    assert.match(drawer, /@media \(max-width: 900px\)[\s\S]*width:\s*100vw/);
    assert.match(view, /prefers-reduced-motion/);
    assert.match(drawer, /prefers-reduced-motion/);
    const touchBlock = view.match(/@media \(hover: none\), \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1];
    assert.ok(touchBlock, 'touch-specific controls should have a dedicated media block');
    assert.match(touchBlock, /min-height:\s*(?:2\.75rem|44px)/);
    assert.match(touchBlock, /min-width:\s*(?:2\.75rem|44px)/);
  });
});
