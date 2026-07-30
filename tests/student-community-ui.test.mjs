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
const saved = read('src/views/SavedView.vue');
const rankings = read('src/views/RankingsView.vue');
const healthProfile = read('src/views/HealthProfileView.vue');
const regions = read('src/views/RegionRecommendationsView.vue');
const canteens = read('src/views/CanteensView.vue');
const orders = read('src/views/OrdersView.vue');
const admin = read('src/views/AdminView.vue');
const miniCommunity = read('miniapp/src/pages/community/community.vue');
const miniSaved = read('miniapp/src/pages/saved/saved.vue');
const miniRegion = read('miniapp/src/pages/region-detail/region-detail.vue');

describe('student community and workspace UI contracts', () => {
  it('registers student routes and navigation entries', () => {
    for (const path of ['/health-profile', '/saved', '/reviews', '/community']) {
      assert.match(router, new RegExp(`path:\\s*'${path.replace('/', '\\/')}'[^}]*audience:\\s*'student'`));
      assert.match(app, new RegExp(`to:\\s*'${path.replace('/', '\\/')}'`));
    }
  });

  it('moves two-step reveal and the nine-feature orbit to home', () => {
    assert.match(home, /class="card reveal-home"/);
    assert.match(home, /revealPhase === 'covered'/);
    assert.match(home, /handleRevealAction/);
    assert.match(home, /StudentFeatureOrbit/);
    assert.equal((home.match(/id: '(dishes|recommend|canteens|rankings|regions|reviews|community|saved|orders)'/g) || []).length, 9);
  });

  it('uses the shared composer without losing semantic dish search', () => {
    assert.match(dishes, /SmartMealComposer/);
    assert.match(dishes, /buildProfilePrompts/);
    assert.doesNotMatch(dishes, /class="card filter-bar"/);
    assert.match(dishes, /store\.searchDishes/);
    assert.match(dishes, /ragResult\.items/);
    assert.doesNotMatch(dishes, /store\.askMealAdvisor/);
  });

  it('provides review tabs, cascading filters, and rating sort', () => {
    assert.match(reviews, /filters\.targetType/);
    assert.match(reviews, /filters\.canteenId/);
    assert.match(reviews, /filters\.stallId/);
    assert.match(reviews, /filters\.dishId/);
    assert.match(reviews, /rating_desc/);
  });

  it('provides moderated single-image campus posts and admin review integration', () => {
    assert.match(community, /accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
    assert.match(community, /form\.rating/);
    assert.match(community, /submitPost/);
    assert.match(admin, /updatePostStatusAdmin/);
  });

  it('filters campus posts by keyword, canteen, and dish on both clients', () => {
    for (const source of [community, miniCommunity]) {
      assert.match(source, /canteenId/);
      assert.match(source, /dishId/);
      assert.match(source, /listPosts|loadCommunityPosts/);
    }
    assert.match(community, /feedKeyword/);
    assert.match(community, /feedCanteenId/);
    assert.match(community, /feedDishId/);
    assert.match(miniCommunity, /postCanteenId/);
    assert.match(miniCommunity, /postDishId/);
    assert.match(miniCommunity, /loadPostDishOptions/);
  });

  it('groups favorites and never renders zero-count eaten records', () => {
    assert.match(saved, /favoriteGroupMode/);
    assert.match(saved, /favoriteGroups/);
    assert.match(saved, /Number\(dish\.eatenCount \|\| 0\) > 0/);
    assert.match(miniSaved, /favoriteGroupMode/);
    assert.match(miniSaved, /favoriteGroups/);
    assert.match(miniSaved, /Number\(dish\.eatenCount\|\|0\)>0/);
    assert.match(miniSaved, /eatenDishTotal/);
  });

  it('uses full-width ranking actions and grouped region dishes', () => {
    assert.equal((rankings.match(/rank-expand-button/g) || []).length >= 6, true);
    assert.match(regions, /selectedDishGroups/);
    assert.match(regions, /主食与套餐/);
    assert.match(miniRegion, /dishGroups/);
    assert.match(miniRegion, /主食与套餐/);
    assert.match(healthProfile, /overflow-wrap:\s*anywhere/);
  });

  it('keeps primary canteens 2x2 on desktop and one column on mobile', () => {
    assert.match(canteens, /\.canteen-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(canteens, /@media \(max-width: 640px\)[\s\S]*\.canteen-grid\s*\{\s*grid-template-columns:\s*1fr/);
  });

  it('keeps pickup codes and submits real at-stall reservations', () => {
    assert.match(orders, /add-dish-button/);
    assert.match(orders, /copyPickupCode/);
    assert.match(orders, /pickup-code-panel/);
    assert.match(orders, /prefers-reduced-motion/);
    assert.match(orders, /store\.createOrder/);
  });
});
