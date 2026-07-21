import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');
const router = read('src/router/index.js');
const app = read('src/App.vue');
const home = read('src/views/HomeView.vue');
const dishes = read('src/views/DishesView.vue');
const reviews = read('src/views/ReviewsView.vue');
const community = read('src/views/CommunityView.vue');
const canteens = read('src/views/CanteensView.vue');
const orders = read('src/views/OrdersView.vue');
const admin = read('src/views/AdminView.vue');

describe('student community and workspace UI contracts', () => {
  it('registers student routes and navigation entries', () => {
    for (const path of ['/health-profile', '/saved', '/reviews', '/community']) {
      assert.match(router, new RegExp(`path:\\s*'${path.replace('/', '\\/')}'[^}]*audience:\\s*'student'`));
      assert.match(app, new RegExp(`to:\\s*'${path.replace('/', '\\/')}'`));
    }
  });

  it('moves reveal to home and uses four equal dashboard modules', () => {
    assert.match(home, /class="card reveal-home"/);
    assert.match(home, /揭晓下一张/);
    assert.match(home, /student-dashboard-grid/);
    assert.equal((home.match(/class="card dashboard-module"/g) || []).length, 4);
  });

  it('adds quick questions and memory beside structured dish search', () => {
    assert.match(dishes, /dish-assistant-workspace/);
    assert.match(dishes, /快捷提问/);
    assert.match(dishes, /检索记忆/);
    assert.match(dishes, /ragResult\.citations/);
  });

  it('provides review tabs, cascading filters, and rating sort', () => {
    assert.match(reviews, /菜品评价/);
    assert.match(reviews, /食堂评价/);
    assert.match(reviews, /filters\.canteenId/);
    assert.match(reviews, /filters\.stallId/);
    assert.match(reviews, /filters\.dishId/);
    assert.match(reviews, /rating_desc/);
  });

  it('provides moderated single-image campus posts and admin review integration', () => {
    assert.match(community, /accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
    assert.match(community, /提交审核/);
    assert.match(community, /form\.rating/);
    assert.match(admin, /评价与帖子审核/);
    assert.match(admin, /updatePostStatusAdmin/);
  });

  it('keeps primary canteens 2x2 on desktop and one column on mobile', () => {
    assert.match(canteens, /\.canteen-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(canteens, /@media \(max-width: 640px\)[\s\S]*\.canteen-grid\s*\{\s*grid-template-columns:\s*1fr/);
  });

  it('redesigns add and pickup-code actions with responsive motion fallbacks', () => {
    assert.match(orders, /add-dish-button/);
    assert.match(orders, /copyPickupCode/);
    assert.match(orders, /pickup-code-panel/);
    assert.match(orders, /prefers-reduced-motion/);
  });
});
