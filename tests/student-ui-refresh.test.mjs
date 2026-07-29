import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProfilePrompts, compactCitationSnippet, createRatingMap, sortDishesByRating, visibleCitations } from '../src/domain/studentDiscovery.js';

const read = (path) => readFileSync(resolve(path), 'utf8');
const app = read('src/App.vue');
const home = read('src/views/HomeView.vue');
const orbit = read('src/components/StudentFeatureOrbit.vue');
const dishes = read('src/views/DishesView.vue');
const recommend = read('src/views/RecommendView.vue');
const orders = read('src/views/OrdersView.vue');
const canteens = read('src/views/CanteensView.vue');
const searchSelect = read('src/components/SearchSelect.vue');

describe('student UI refresh contracts', () => {
  it('keeps the required student navigation order and production reservation entry', () => {
    const labels = ['菜品检索', '智能推荐', '菜品评价', '校园帖子', '食堂导航', '排行榜', '地区口味推荐', '我的', '收藏与用餐记录', '到店预约', '健康档案'];
    let previous = -1;
    for (const label of labels) {
      const index = app.indexOf(`label: '${label}'`);
      assert.ok(index > previous, `${label} should appear after the previous student item`);
      previous = index;
    }
    assert.match(app, /to:\s*'\/orders'[^\n]*label:\s*'到店预约'/);
  });

  it('implements covered, revealed, and next-card states on the home reveal', () => {
    assert.match(home, /const revealPhase = ref\('covered'\)/);
    assert.match(home, /revealPhase\.value = 'revealed'/);
    assert.match(home, /revealPhase\.value = 'covered'/);
    assert.match(home, /handleRevealAction/);
  });

  it('implements a nine-item timed orbit with pause, keyboard, mobile snap, and reduced motion', () => {
    assert.equal((home.match(/id: '(dishes|recommend|canteens|rankings|regions|reviews|community|saved|orders)'/g) || []).length, 9);
    assert.match(orbit, /setInterval[\s\S]*5000/);
    assert.match(orbit, /mouseenter="paused = true"/);
    assert.match(orbit, /keydown\.left/);
    assert.match(orbit, /pointerdown="startDrag"/);
    assert.match(orbit, /orbit-side-arrow/);
    assert.match(orbit, /scroll-snap-type:\s*x mandatory/);
    assert.match(orbit, /prefers-reduced-motion/);
    assert.match(orbit, /iconFor\(item\.icon\)/);
    assert.match(orbit, /v-if="item\.imageUrl" class="orbit-scrim"/);
  });

  it('groups long dish selectors and provides east-west canteen navigation with verified 1F labels', () => {
    assert.match(searchSelect, /option\.group/);
    assert.match(canteens, /按东西区找食堂/);
    assert.match(canteens, /'west-xinyi': '西区大食堂 · 1F'/);
    assert.match(canteens, /'west-minzu': '西区大食堂 · 1F'/);
  });

  it('uses one composer model across discovery and recommendation', () => {
    for (const source of [dishes, recommend]) {
      assert.match(source, /SmartMealComposer/);
      assert.match(source, /buildProfilePrompts/);
      assert.match(source, /sortDishesByRating/);
    }
    assert.doesNotMatch(dishes, /class="card filter-bar"/);
    assert.match(recommend, /visibleRecommendationCitations/);
  });

  it('submits real reservations and displays at-stall payment semantics', () => {
    assert.match(orders, /提交预约/);
    assert.match(orders, /store\.createOrder/);
    assert.match(orders, /到店支付/);
  });
});

describe('student discovery helpers', () => {
  it('builds profile-aware prompts from budget, meal, taste, and avoid lists', () => {
    const prompts = buildProfilePrompts({ goal: 'fatLoss', mealType: 'lunch', budgetMax: 35, taste: '麻辣', avoid: ['花生'], preferLowCrowd: true }, 'search');
    assert.equal(prompts.length, 5);
    assert.ok(prompts.some((item) => item.query.includes('35')));
    assert.ok(prompts.some((item) => item.query.includes('麻辣')));
    assert.ok(prompts.some((item) => item.query.includes('花生')));
    assert.ok(prompts.some((item) => item.label === '轻松少排队'));
  });

  it('sorts by review-aware display rating in both directions', () => {
    const dishes = [{ id: 'a', name: 'A', rating: 5 }, { id: 'b', name: 'B', rating: 1 }];
    const ratings = createRatingMap([{ id: 'a', computedRating: 3.8 }, { id: 'b', computedRating: 4.7 }]);
    assert.deepEqual(sortDishesByRating(dishes, ratings, 'desc').map((item) => item.id), ['b', 'a']);
    assert.deepEqual(sortDishesByRating(dishes, ratings, 'asc').map((item) => item.id), ['a', 'b']);
  });

  it('folds citations to three and produces one-line snippets', () => {
    const citations = Array.from({ length: 5 }, (_, index) => ({ id: index }));
    assert.equal(visibleCitations(citations, false).length, 3);
    assert.equal(visibleCitations(citations, true).length, 5);
    assert.ok(compactCitationSnippet('a '.repeat(80), 20).length <= 21);
  });
});
