import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGION_DEFINITIONS,
  getDishRegionIds,
  getRegionDishes,
  rankRegionDishes,
  summarizeRegions
} from '../src/domain/regionRecommendation.js';
import { dishes } from '../src/domain/seedData.js';
import { previewDishes } from '../src/domain/previewData.js';

function dish(overrides = {}) {
  return {
    id: 'region-test-dish',
    name: '测试菜品',
    price: 15,
    cuisine: '家常',
    taste: '咸鲜',
    ingredients: ['鸡肉', '米饭'],
    tags: [],
    rating: 4.5,
    reviewCount: 50,
    sales: 200,
    ...overrides
  };
}

describe('region recommendation taxonomy', () => {
  it('provides one clearly labeled preview dish per region', () => {
    assert.equal(previewDishes.length, 6);
    assert.deepEqual(
      previewDishes.map((dish) => dish.cuisine),
      ['粤菜', '湘菜', '西北', '日式', '轻食', '快餐']
    );
  });

  it('defines six regions and gives each seeded region visible dishes', () => {
    assert.equal(REGION_DEFINITIONS.length, 6);
    const summaries = summarizeRegions(dishes);
    assert.ok(summaries.every((region) => region.count > 0), 'every region should have seeded dishes');
    assert.ok(summaries.every((region) => region.heroDish), 'every region should have a hero dish');
  });

  it('uses campus fast food as the fallback for unknown dishes', () => {
    const unknown = dish({
      id: 'unknown-dish',
      name: '未知口味',
      cuisine: '其他',
      taste: '未知',
      ingredients: [],
      tags: []
    });
    assert.deepEqual(getDishRegionIds(unknown), ['campus']);
    assert.equal(getRegionDishes('campus', [unknown]).length, 1);
  });

  it('excludes archived and inactive dishes from region lists', () => {
    const pool = [dish({ id: 'active' }), dish({ id: 'archived', status: 'archived' }), dish({ id: 'inactive', status: 'inactive' })];
    const visible = getRegionDishes('campus', pool);
    assert.ok(visible.every((item) => item.id === 'active'));
  });
});

describe('region recommendation sorting', () => {
  const pool = [
    dish({ id: 'high-rating', rating: 4.9, reviewCount: 20, sales: 100, price: 20 }),
    dish({ id: 'high-heat', rating: 4.4, reviewCount: 80, sales: 900, price: 16 }),
    dish({ id: 'favorite', rating: 4.0, reviewCount: 10, sales: 40, price: 10 })
  ];

  it('sorts by rating, heat, and price using the requested mode', () => {
    assert.equal(rankRegionDishes(pool, { sortBy: 'rating' })[0].id, 'high-rating');
    assert.equal(rankRegionDishes(pool, { sortBy: 'hot' })[0].id, 'high-heat');
    assert.equal(rankRegionDishes(pool, { sortBy: 'price' })[0].id, 'favorite');
  });

  it('lets favorite and eaten history influence the for-you order', () => {
    const ranked = rankRegionDishes(pool, {
      sortBy: 'forYou',
      preferences: [{ dishId: 'favorite', favorite: 1, eatenCount: 8, drawnCount: 8 }]
    });
    assert.equal(ranked[0].id, 'favorite');
    assert.equal(ranked[0].isFavorite, true);
    assert.equal(ranked[0].eatenCount, 8);
  });

  it('uses review-derived ratings when a ranking map is supplied', () => {
    const ranked = rankRegionDishes(pool, {
      sortBy: 'rating',
      ratingById: new Map([
        ['high-rating', { computedRating: 4.1, computedReviewCount: 300 }],
        ['high-heat', { computedRating: 4.8, computedReviewCount: 2 }]
      ])
    });
    assert.equal(ranked[0].id, 'high-heat');
    assert.equal(ranked[0].displayRating, 4.8);
    assert.equal(ranked[0].displayReviewCount, 2);
  });
});
