import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfile,
  filterDishes,
  rankDishes,
  buildMealPlan,
  calculateRanking,
} from '../src/domain/recommendation.js';
import { dishes, reviews } from '../src/domain/seedData.js';

/* ------------------------------------------------------------------ */
/*  Helper: tiny dish factory for focused test scenarios               */
/* ------------------------------------------------------------------ */
function dish(overrides) {
  return {
    id: 'test-dish',
    stallId: 's1',
    name: '测试菜品',
    price: 15,
    taste: '咸鲜',
    cuisine: '家常',
    ingredients: ['鸡肉', '米饭'],
    tags: ['高蛋白'],
    halal: false,
    mealTypes: ['lunch', 'dinner'],
    nutrition: { calories: 500, protein: 30, fat: 15, carbs: 60 },
    rating: 4.5,
    reviewCount: 100,
    sales: 200,
    image: '🍱',
    description: '测试',
    ...overrides,
  };
}

/* ================================================================== */
/*  1. Budget / meal-type / halal filtering                            */
/* ================================================================== */
describe('filterDishes', () => {
  const pool = [
    dish({ id: 'cheap-lunch', price: 10, mealTypes: ['lunch'] }),
    dish({ id: 'pricey-lunch', price: 25, mealTypes: ['lunch'] }),
    dish({ id: 'dinner-only', price: 12, mealTypes: ['dinner'] }),
    dish({ id: 'halal-lunch', price: 14, halal: true, mealTypes: ['lunch'] }),
    dish({ id: 'breakfast-cheap', price: 8, mealTypes: ['breakfast'] }),
  ];

  it('drops dishes that exceed budgetMax', () => {
    const result = filterDishes(pool, { budgetMax: 15 });
    const ids = result.map((d) => d.id);
    assert.ok(ids.includes('cheap-lunch'), 'cheap-lunch within budget');
    assert.ok(!ids.includes('pricey-lunch'), 'pricey-lunch excluded');
  });

  it('keeps only dishes matching mealType', () => {
    const lunch = filterDishes(pool, { mealType: 'lunch' });
    assert.ok(lunch.every((d) => d.mealTypes.includes('lunch')));
    assert.ok(!lunch.some((d) => d.id === 'dinner-only'));
    assert.ok(!lunch.some((d) => d.id === 'breakfast-cheap'));
  });

  it('halalOnly excludes non-halal dishes', () => {
    const result = filterDishes(pool, { halalOnly: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'halal-lunch');
  });

  it('halalOnly: false keeps halal and non-halal dishes within the default lunch scope', () => {
    const result = filterDishes(pool, { halalOnly: false, budgetMax: 50 });
    assert.deepEqual(result.map((d) => d.id), ['cheap-lunch', 'pricey-lunch', 'halal-lunch']);
  });

  it('halalOnly + budgetMax interact correctly', () => {
    const result = filterDishes(pool, { halalOnly: true, budgetMax: 10 });
    assert.equal(result.length, 0, 'no halal dish under 10 yuan');
  });

  it('taste filter keeps matching taste', () => {
    const special = [
      dish({ id: 'spicy', taste: '麻辣' }),
      dish({ id: 'mild', taste: '酸甜' }),
    ];
    const result = filterDishes(special, { taste: '麻辣' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'spicy');
  });

  it('avoid ingredients excludes dishes containing them', () => {
    const special = [
      dish({ id: 'with-tofu', ingredients: ['豆腐', '米饭'] }),
      dish({ id: 'no-tofu', ingredients: ['鸡肉', '米饭'] }),
    ];
    const result = filterDishes(special, { avoid: ['豆腐'] });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'no-tofu');
  });
});

/* ================================================================== */
/*  2. Fat-loss ranking: low-calorie + high-protein preferred          */
/* ================================================================== */
describe('rankDishes – fatLoss goal', () => {
  it('ranks low-calorie high-protein dish above high-calorie lower-protein dish', () => {
    const light = dish({
      id: 'light',
      name: '鸡胸沙拉',
      nutrition: { calories: 380, protein: 36, fat: 8, carbs: 30 },
      rating: 4.5,
      reviewCount: 100,
    });
    const heavy = dish({
      id: 'heavy',
      name: '红烧肉饭',
      nutrition: { calories: 750, protein: 22, fat: 30, carbs: 90 },
      rating: 4.5,
      reviewCount: 100,
    });

    const ranked = rankDishes([heavy, light], { goal: 'fatLoss' });
    assert.equal(ranked[0].id, 'light', 'low-cal high-protein should rank first');
    assert.ok(
      ranked[0].recommendationScore > ranked[1].recommendationScore,
      'score gap confirms the preference'
    );
  });

  it('fatLoss score function: protein*2.2 - calories*0.035 - fat*1.4', () => {
    // Manually compute for a known dish
    const d = dish({
      nutrition: { calories: 486, protein: 38, fat: 11, carbs: 58 },
      rating: 4.8,
      reviewCount: 126,
    });
    const goalScore = 38 * 2.2 - 486 * 0.035 - 11 * 1.4;
    // ≈ 83.6 - 17.01 - 15.4 = 51.19
    const ratingScore = 4.8 * 8 + Math.log10(127) * 6;
    const budgetScore = Math.max(0, 20 - 15) * 0.8;
    const expected = goalScore + ratingScore + budgetScore;

    const ranked = rankDishes([d], { goal: 'fatLoss', budgetMax: 20 });
    assert.equal(ranked.length, 1);
    assert.ok(
      Math.abs(ranked[0].recommendationScore - Number(expected.toFixed(1))) < 0.2,
      `expected ~${expected.toFixed(1)}, got ${ranked[0].recommendationScore}`
    );
  });

  it('with full seed data, fat-loss #1 has fewer calories than the bottom result', () => {
    const ranked = rankDishes(dishes, { goal: 'fatLoss' });
    assert.ok(ranked.length > 1, 'should have multiple results');
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    assert.ok(
      top.nutrition.calories <= bottom.nutrition.calories,
      `top (${top.name}, ${top.nutrition.calories}kcal) should have ≤ calories than bottom (${bottom.name}, ${bottom.nutrition.calories}kcal)`
    );
  });
});

/* ================================================================== */
/*  3. No fabricated recommendations when constraints impossible       */
/* ================================================================== */
describe('buildMealPlan – impossible constraints', () => {
  it('returns empty dishes and an explanation when nothing matches', () => {
    const plan = buildMealPlan(dishes, {
      budgetMax: 1, // no dish costs ≤ 1 yuan
      mealType: 'lunch',
      halalOnly: false,
    });
    assert.equal(plan.dishes.length, 0, 'no dishes should be fabricated');
    assert.match(
      plan.reason,
      /没有匹配|请放宽/,
      'reason should explain why no picks were made'
    );
  });

  it('impossible halal + budget combo yields empty picks', () => {
    // halal dish is d-beef-noodle at 15 yuan
    const plan = buildMealPlan(dishes, {
      halalOnly: true,
      budgetMax: 5, // halal min is 15
      mealType: 'lunch',
    });
    assert.equal(plan.dishes.length, 0, 'no halal dish under 5 yuan');
  });

  it('impossible mealType yields empty picks', () => {
    const plan = buildMealPlan(dishes, {
      mealType: 'breakfast',
      budgetMax: 5, // breakfast dish (d-oat) is 9 yuan
    });
    assert.equal(plan.dishes.length, 0, 'no breakfast dish under 5 yuan');
  });

  it('empty pool produces zero picks regardless of profile', () => {
    const plan = buildMealPlan([], { goal: 'fatLoss', budgetMax: 100 });
    assert.equal(plan.dishes.length, 0);
    assert.equal(plan.totals.calories, 0);
  });
});

/* ================================================================== */
/*  4. Ranking score updates from reviews                              */
/* ================================================================== */
describe('calculateRanking – review-driven scores', () => {
  const stallItems = [
    { id: 'stall-a', rating: 4.0, reviewCount: 10 },
    { id: 'stall-b', rating: 4.5, reviewCount: 5 },
  ];

  it('uses item.rating when no reviews map is provided', () => {
    const ranked = calculateRanking(stallItems);
    assert.equal(ranked[0].id, 'stall-b', 'higher rating should rank first');
    assert.equal(ranked[0].computedRating, 4.5);
  });

  it('overrides rating with review average when reviews exist', () => {
    const reviewMap = new Map([
      [
        'stall-a',
        [
          { rating: 5, user: 'u1' },
          { rating: 5, user: 'u2' },
          { rating: 5, user: 'u3' },
        ],
      ],
    ]);
    const ranked = calculateRanking(stallItems, reviewMap);
    const a = ranked.find((r) => r.id === 'stall-a');
    assert.equal(a.computedRating, 5.0, 'review average should be 5.0');
    assert.equal(a.computedReviewCount, 3, 'review count from reviews array');
  });

  it('higher review volume increases rankScore via log component', () => {
    const few = [{ id: 'few', rating: 4.5, reviewCount: 5 }];
    const many = [{ id: 'many', rating: 4.5, reviewCount: 200 }];

    const rankedFew = calculateRanking(few);
    const rankedMany = calculateRanking(many);
    assert.ok(
      rankedMany[0].rankScore > rankedFew[0].rankScore,
      `many (${rankedMany[0].rankScore}) should score higher than few (${rankedFew[0].rankScore})`
    );
  });

  it('reviews with low ratings pull the rankScore down', () => {
    const item = [{ id: 'x', rating: 4.8, reviewCount: 50 }];
    const badReviews = new Map([
      ['x', [{ rating: 1 }, { rating: 1 }, { rating: 2 }]],
    ]);

    const without = calculateRanking(item)[0];
    const withBad = calculateRanking(item, badReviews)[0];
    assert.ok(
      withBad.rankScore < without.rankScore,
      `bad reviews (${withBad.rankScore}) should lower score vs original (${without.rankScore})`
    );
  });

  it('calculateRanking with seed reviews overrides computed fields', () => {
    // Build a reviewsByTarget map from seed reviews
    const reviewMap = new Map();
    for (const r of reviews) {
      if (!reviewMap.has(r.targetId)) reviewMap.set(r.targetId, []);
      reviewMap.get(r.targetId).push(r);
    }

    const baseRanked = calculateRanking(dishes);
    const reviewRanked = calculateRanking(dishes, reviewMap);

    // d-chicken-bowl: single 5-star review replaces 4.8/126 with 5.0/1
    const baseChicken = baseRanked.find((d) => d.id === 'd-chicken-bowl');
    const reviewChicken = reviewRanked.find((d) => d.id === 'd-chicken-bowl');
    assert.equal(reviewChicken.computedRating, 5.0, 'review average replaces original rating');
    assert.equal(reviewChicken.computedReviewCount, 1, 'review count comes from reviews array');

    // The log(2)*0.3 component from 1 review is smaller than log(127)*0.3 from 126 reviews,
    // so rankScore may drop — this is expected behavior (reviews replace, not supplement).

    // At least one dish's computed rating changed
    const changed = reviewRanked.some((r) => {
      const base = baseRanked.find((b) => b.id === r.id);
      return base && r.computedRating !== base.computedRating;
    });
    assert.ok(changed, 'seed reviews should alter at least one dish computed rating');
  });
});

/* ================================================================== */
/*  5. normalizeProfile defaults                                       */
/* ================================================================== */
describe('normalizeProfile', () => {
  it('returns sensible defaults for empty input', () => {
    const p = normalizeProfile();
    assert.equal(p.goal, 'healthy');
    assert.equal(p.budgetMax, 20);
    assert.equal(p.mealType, 'lunch');
    assert.equal(p.taste, '不限');
    assert.equal(p.halalOnly, false);
    assert.deepEqual(p.avoid, []);
  });

  it('preserves explicitly provided values', () => {
    const p = normalizeProfile({
      goal: 'fatLoss',
      budgetMax: 12,
      mealType: 'dinner',
      taste: '麻辣',
      halalOnly: true,
      avoid: ['花生'],
    });
    assert.equal(p.goal, 'fatLoss');
    assert.equal(p.budgetMax, 12);
    assert.equal(p.mealType, 'dinner');
    assert.equal(p.taste, '麻辣');
    assert.equal(p.halalOnly, true);
    assert.deepEqual(p.avoid, ['花生']);
  });

  it('parses avoid from comma-separated string', () => {
    const p = normalizeProfile({ avoid: '花生，虾仁' });
    assert.deepEqual(p.avoid, ['花生', '虾仁']);
  });
});
