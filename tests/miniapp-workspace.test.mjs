import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(path, 'utf8');
const dishes = source('miniapp/src/pages/dishes/dishes.vue');
const legacyRecommend = source('miniapp/src/pages/recommend/recommend.vue');
const community = source('miniapp/src/pages/community/community.vue');
const login = source('miniapp/src/pages/login/login.vue');
const home = source('miniapp/src/pages/home/home.vue');
const navigation = source('miniapp/src/domain/studentNavigation.js');

describe('miniapp unified workspaces', () => {
  it('keeps dish search and recommendation on one tab page', () => {
    assert.match(dishes, /v-model="mode"/);
    assert.match(dishes, /mode === 'search'/);
    assert.match(dishes, /modeOptions=\[\{value:'search'/);
    assert.match(dishes, /recommendLoading|recommendPrompts/);
    assert.doesNotMatch(dishes, /navigateTo\(\{url:\s*['"]\/pages\/recommend\/recommend/);
    assert.match(dishes, /visibleDishes/);
    assert.match(dishes, /visibleMealPicks/);
    assert.match(dishes, /sc-citation-list/);
  });

  it('redirects the legacy recommendation page into the tab workspace', () => {
    assert.match(legacyRecommend, /openDiscoveryMode\('recommend'\)/);
    assert.match(legacyRecommend, /switchTab\(\{ url: '\/pages\/dishes\/dishes' \}\)/);
    assert.doesNotMatch(legacyRecommend, /sc-page-shell back/);
    assert.match(navigation, /id: 'recommend'[\s\S]*route: '\/pages\/dishes\/dishes'[\s\S]*navigationType: 'switchTab'[\s\S]*discoveryMode: 'recommend'/);
  });

  it('keeps community tab selection and avoids unconditional onShow reloads', () => {
    assert.match(community, /syncingSection/);
    assert.match(community, /lastLoadedAt/);
    assert.match(community, /Date\.now\(\)-lastLoadedAt>15000/);
    assert.match(community, /watch\(section/);
    assert.match(community, /listPosts\(\{targetType:postType\.value,q:postQuery\.value\.trim\(\)/);
    assert.match(community, /listReviews\(\{\.\.\.reviewFilters,q:reviewQuery\.value\.trim\(\)/);
  });

  it('uses a full-screen poster login while keeping all auth actions', () => {
    assert.match(login, /class="login-screen"/);
    assert.match(login, /class="login-poster"/);
    assert.match(login, /class="login-card panel-card"/);
    assert.match(login, /loginWithWechat/);
    assert.match(login, /loginWithDemo/);
    assert.match(login, /loginWithAccount/);
    assert.match(login, /requireConsent/);
    assert.match(login, /min-height:100vh/);
    assert.doesNotMatch(login, /backdrop-filter/);
  });

  it('passes workspace and community context from the homepage', () => {
    assert.match(home, /COMMUNITY_ENTRY_IDS/);
    assert.match(home, /communityEntries/);
    assert.match(home, /entry\.discoveryMode/);
    assert.match(home, /entry\.communitySection/);
  });
});
