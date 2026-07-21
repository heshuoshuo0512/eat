import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appVue = readFileSync(resolve('src/App.vue'), 'utf8');
const recommendVue = readFileSync(resolve('src/views/RecommendView.vue'), 'utf8');
const healthProfileVue = readFileSync(resolve('src/views/HealthProfileView.vue'), 'utf8');
const savedVue = readFileSync(resolve('src/views/SavedView.vue'), 'utf8');
const routerJs = readFileSync(resolve('src/router/index.js'), 'utf8');

describe('student health and preference views', () => {
  it('keeps recommendation, health profile, and saved records as distinct routes', () => {
    assert.match(appVue, /to:\s*'\/recommend',\s*label:\s*'智能推荐'/);
    assert.match(appVue, /to:\s*'\/health-profile',\s*label:\s*'健康档案'/);
    assert.match(appVue, /to:\s*'\/saved',\s*label:\s*'收藏与吃过'/);
    assert.match(routerJs, /query\.panel === 'favorites'[\s\S]*path:\s*'\/saved'/);
  });

  it('health profile page contains only profile editing and refreshes recommendation after save', () => {
    assert.match(healthProfileVue, /<h1>健康档案<\/h1>/);
    assert.match(healthProfileVue, /await store\.saveProfile/);
    assert.match(healthProfileVue, /await store\.loadRecommendation/);
    assert.doesNotMatch(healthProfileVue, /逐张揭晓/);
  });

  it('saved page owns favorites and eaten history without profile fields', () => {
    assert.match(savedVue, /<h1>收藏与吃过<\/h1>/);
    assert.match(savedVue, /favoriteEntries/);
    assert.match(savedVue, /eatenEntries/);
    assert.doesNotMatch(savedVue, /饮食目标/);
  });

  it('loads deterministic recommendations first and reserves the agent for user follow-ups', () => {
    assert.match(recommendVue, /SmartMealComposer/);
    assert.match(recommendVue, /buildProfilePrompts/);
    assert.match(recommendVue, /loadAgentMemory/);
    assert.match(recommendVue, /groundednessScore/);
    assert.match(recommendVue, /toolSuccessRate/);
    assert.match(recommendVue, /safetyScore/);
    assert.match(recommendVue, /visibleRecommendationCitations/);
    assert.match(recommendVue, /loadInitialRecommendation[\s\S]*store\.loadRecommendation\(\)/);
    assert.match(recommendVue, /runPrompt[\s\S]*store\.runAgent/);
    assert.doesNotMatch(recommendVue, /runPrompt\(profilePrompt\(\)\)/);
  });
});
