import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');
const apiClient = read('src/services/apiClient.js');
const store = read('src/stores/canteenStore.js');
const dishesView = read('src/views/DishesView.vue');
const recommendView = read('src/views/RecommendView.vue');
const agentView = read('src/views/AgentView.vue');
const adminView = read('src/views/AdminView.vue');

describe('dual retrieval frontend contracts', () => {
  it('exposes separate POST clients for dish search and recommendation', () => {
    assert.match(apiClient, /dishesSearch\(payload\)[\s\S]*request\('\/api\/dishes\/search',\s*\{\s*method:\s*'POST'/);
    assert.match(apiClient, /recommend\(payload = \{\}\)[\s\S]*request\('\/api\/recommend',\s*\{\s*method:\s*'POST'/);
    assert.match(apiClient, /loadRecommendation\(\)[\s\S]*request\('\/api\/recommend'\)/);
  });

  it('keeps search and recommendation response state independent', () => {
    assert.match(store, /dishSearchResult = ref\(emptyDishSearchResult\(\)\)/);
    assert.match(store, /searchDishes\(payload\)[\s\S]*apiClient\.dishesSearch\(payload\)/);
    assert.match(store, /requestRecommendation\(payload = \{\}\)[\s\S]*apiClient\.recommend\(payload\)/);
    assert.match(store, /recommendations:[\s\S]*evidence:[\s\S]*suggestedRelaxations/);
  });

  it('renders dish search items and starts recommendation without an agent call', () => {
    const mountedBlock = recommendView.match(/onMounted\(async \(\) => \{([\s\S]*?)\n\}\);/)?.[1] || '';
    assert.match(dishesView, /source = searchResultActive\.value \? store\.dishSearchResult\.items/);
    assert.match(dishesView, /v-for="dish in sortedDishes"/);
    assert.match(dishesView, /visibleSearchCitations = computed\(\(\) => visibleCitations\(ragResult\.value\?\.items/);
    assert.match(dishesView, /v-for="cite in visibleSearchCitations"/);
    assert.match(recommendView, /loadInitialRecommendation[\s\S]*store\.loadRecommendation\(\)/);
    assert.match(recommendView, /@submit="runPrompt\(question\)"/);
    assert.match(mountedBlock, /loadInitialRecommendation\(\)/);
    assert.doesNotMatch(mountedBlock, /runPrompt\(/);
  });

  it('connects retrieval observability and index administration', () => {
    assert.match(apiClient, /getRetrievalIndexStatus\(\)[\s\S]*request\('\/api\/admin\/retrieval\/status'\)/);
    assert.match(apiClient, /rebuildRetrievalIndex\(payload = \{\}\)[\s\S]*request\('\/api\/admin\/retrieval\/reindex',[\s\S]*method:\s*'POST'/);
    assert.match(store, /loadRetrievalIndexStatus\(\)[\s\S]*apiClient\.getRetrievalIndexStatus\(\)/);
    assert.match(store, /rebuildRetrievalIndex\(payload = \{\}\)[\s\S]*apiClient\.rebuildRetrievalIndex\(payload\)/);
    assert.match(agentView, /v-if="agentIndexVersion"[\s\S]*agentDegradedReasons/);
    assert.match(agentView, /result\.value\?\.plan\?\.indexVersion/);
    assert.match(agentView, /result\.value\?\.plan\?\.degradedReasons/);
    assert.match(adminView, /检索索引/);
    assert.match(adminView, /store\.retrievalIndexStatus\?\.documentCount/);
    assert.match(adminView, /store\.retrievalIndexStatus\?\.failureCount/);
    assert.match(adminView, /runRetrievalReindex/);
  });
});
