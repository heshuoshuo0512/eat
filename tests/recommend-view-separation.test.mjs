import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appVue = readFileSync(resolve('src/App.vue'), 'utf8');
const recommendVue = readFileSync(resolve('src/views/RecommendView.vue'), 'utf8');

describe('student health and preference views', () => {
  it('keeps health profile and favorites as distinct navigation states', () => {
    assert.match(appVue, /to:\s*'\/recommend',\s*label:\s*'健康推荐'/);
    assert.match(appVue, /to:\s*'\/recommend\?panel=favorites',\s*label:\s*'收藏与吃过'/);
    assert.match(appVue, /item\.to === '\/recommend'.*route\.query\.panel !== 'favorites'/s);
  });

  it('shows only the profile form on the health recommendation state', () => {
    assert.match(recommendVue, /const isFavoritesPanel = computed\(\(\) => route\.query\.panel === 'favorites'\)/);
    assert.match(recommendVue, /<form v-if="!isFavoritesPanel"[^>]*class="card profile-form"/);
    assert.match(recommendVue, /<article v-else class="card recommendation-card"/);
  });

  it('moves recommendation results, reveal, favorites, and eaten history to the favorites state', () => {
    assert.match(recommendVue, /v-if="isFavoritesPanel && serverContext"/);
    assert.match(recommendVue, /v-if="isFavoritesPanel && rankedDishes\.length"[^>]*class="card reveal-section"/);
    assert.equal((recommendVue.match(/v-if="isFavoritesPanel" class="card favorites-panel"/g) || []).length, 2);
  });
});
