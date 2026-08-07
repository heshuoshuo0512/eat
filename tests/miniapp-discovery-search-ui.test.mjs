import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');
const dishes = read('miniapp/src/pages/dishes/dishes.vue');
const recommend = read('miniapp/src/pages/recommend/recommend.vue');
const community = read('miniapp/src/pages/community/community.vue');
const login = read('miniapp/src/pages/login/login.vue');
const server = read('server/app.js');

describe('miniapp discovery and community search UI contracts', () => {
  it('keeps direct discovery mode switching on the unified tab workspace', () => {
    assert.match(dishes, /sc-segmented-control[^>]+modeOptions/);
    assert.match(dishes, /changeMode\(value\)/);
    assert.match(dishes, /openDiscoveryMode\(mode\.value\)/);
    assert.match(recommend, /openDiscoveryMode\('recommend'\)/);
    assert.match(recommend, /switchTab\(\{ url: '\/pages\/dishes\/dishes' \}\)/);
  });

  it('shows one ranked dish first and expands only on explicit action', () => {
    assert.match(dishes, /visibleDishes/);
    assert.match(dishes, /resultsExpanded/);
    assert.match(dishes, /查看全部 .*道排名菜品/);
    assert.match(dishes, /visibleMealPicks/);
    assert.match(dishes, /recommendExpanded/);
    assert.match(dishes, /查看全部 .*道排名菜品/);
  });

  it('keeps catalog search inside explicit student partitions', () => {
    assert.match(dishes, /value:'meal',[\s\S]*value:'snack',[\s\S]*value:'beverage'/);
    assert.doesNotMatch(dishes, /value:'addon'|label:'全部目录'/);
    assert.match(dishes, /loadCatalogCategories\(catalogItemType\.value\)/);
    assert.match(dishes, /itemType:catalogItemType\.value/);
    assert.match(dishes, /catalogCategory:catalogCategory\.value\|\|undefined/);
  });

  it('provides debounced keyword fields for posts and reviews', () => {
    assert.match(community, /v-model="postQuery"/);
    assert.match(community, /v-model="reviewQuery"/);
    assert.match(community, /setTimeout\(\(\)=>loadPosts\(true\),280\)/);
    assert.match(community, /setTimeout\(\(\)=>\{if\(section\.value==='reviews'\)loadReviews\(true\);\},280\)/);
    assert.match(community, /q:postQuery\.value\.trim\(\)/);
    assert.match(community, /q:reviewQuery\.value\.trim\(\)/);
    assert.match(server, /url\.searchParams\.get\('q'\)/);
  });

  it('uses a compact, structured login landing layout', () => {
    assert.match(login, /login-brandline/);
    assert.match(login, /class="auth-tabs"/);
    assert.match(login, /微信一键登录/);
    assert.doesNotMatch(login, /open-type="getPhoneNumber"/);
    assert.match(login, /手机号注册/);
    assert.match(login, /找回密码/);
  });
});
