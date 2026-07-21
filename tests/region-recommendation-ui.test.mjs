import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routerJs = readFileSync(resolve('src/router/index.js'), 'utf8');
const appVue = readFileSync(resolve('src/App.vue'), 'utf8');
const homeVue = readFileSync(resolve('src/views/HomeView.vue'), 'utf8');
const regionVue = readFileSync(resolve('src/views/RegionRecommendationsView.vue'), 'utf8');

describe('student region recommendation navigation', () => {
  it('exposes /regions as a student route', () => {
    assert.match(routerJs, /path:\s*'\/regions'[^}]*audience:\s*'student'/);
  });

  it('adds the region page to the student discovery navigation', () => {
    assert.match(appVue, /to:\s*'\/regions'[^}]*feature:\s*'student'/);
  });

  it('links the student homepage to the region page', () => {
    assert.match(homeVue, /id:\s*'regions'[^\n]*to:\s*'\/regions'/);
    assert.match(homeVue, /StudentFeatureOrbit/);
  });
});

describe('region recommendation page behavior', () => {
  it('reads region and sort from the URL and exposes all sort modes', () => {
    assert.match(regionVue, /route\.query\.region/);
    assert.match(regionVue, /route\.query\.sort/);
    for (const label of ['适合我', '评分优先', '热度优先', '价格优先']) {
      assert.ok(regionVue.includes(label), `missing sort mode: ${label}`);
    }
  });

  it('links region dishes to existing dish detail and ordering flows', () => {
    assert.match(regionVue, /path:\s*'\/dishes'/);
    assert.match(regionVue, /path:\s*'\/orders'/);
    assert.match(regionVue, /query:\s*\{\s*dish:/);
  });

  it('includes staggered motion and a mobile layout', () => {
    assert.match(regionVue, /animation-delay/);
    assert.match(regionVue, /@media\s*\(max-width:\s*680px\)/);
  });

  it('supports a no-backend preview mode for the region page', () => {
    const appVue = readFileSync(resolve('src/App.vue'), 'utf8');
    const storeJs = readFileSync(resolve('src/stores/canteenStore.js'), 'utf8');
    assert.match(appVue, /previewMode/);
    assert.match(appVue, /preview=regions|preview === 'regions'/);
    assert.match(storeJs, /loadPreviewState/);
    assert.match(storeJs, /页面预览/);
  });
});
