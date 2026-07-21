import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import {
  applyDishHardConstraints,
  parseDishSearchRequest,
  reciprocalRankFusion,
  runDishSearchWorkflow,
  runMealRecommendationWorkflow
} from '../server/retrievalService.js';

function candidate(overrides = {}) {
  return {
    id: 'dish-1',
    tenantId: 'tenant-a',
    name: '香煎鸡胸饭',
    stallId: 'stall-1',
    stallName: '轻食档口',
    canteenId: 'canteen-1',
    canteenName: '北苑食堂',
    canteenLocation: '北区',
    stallOpen: true,
    price: 16,
    taste: '清淡',
    cuisine: '家常',
    ingredients: ['鸡胸肉', '西兰花', '米饭'],
    allergens: [],
    tags: ['高蛋白', '低脂'],
    halal: true,
    mealTypes: ['lunch', 'dinner'],
    nutrition: { calories: 460, protein: 36, fat: 9, carbs: 55 },
    fiber: 4,
    sodium: 420,
    sugar: 2,
    rating: 4.7,
    reviewCount: 120,
    sales: 300,
    status: 'active',
    menuItem: {
      id: 'menu-item-1',
      menuId: 'menu-1',
      date: '2026-07-21',
      mealType: 'lunch',
      status: 'published',
      price: 15,
      supplyLimit: 50,
      supplyCount: 10,
      soldOut: false,
      servingStart: '11:00',
      servingEnd: '13:30'
    },
    ...overrides
  };
}

const fixedContext = { date: '2026-07-21', time: '12:00', mealType: 'lunch' };

describe('dish search request parsing and fusion', () => {
  it('extracts Chinese hard filters while explicit filters remain authoritative', () => {
    const parsed = parseDishSearchRequest({
      tenantId: 'tenant-a',
      query: '午餐要清真高蛋白，预算20元以内，不吃花生',
      filters: { budgetMax: 18 }
    });
    assert.equal(parsed.filters.mealType, 'lunch');
    assert.equal(parsed.filters.halalOnly, true);
    assert.equal(parsed.filters.minProtein, 25);
    assert.equal(parsed.filters.budgetMax, 18);
    assert.deepEqual(parsed.filters.avoidIngredients, ['花生']);
  });

  it('validates pagination and budget ranges', () => {
    assert.throws(() => parseDishSearchRequest({ limit: 0 }), /检索请求参数不合法/);
    assert.throws(() => parseDishSearchRequest({ filters: { budgetMin: 30, budgetMax: 20 } }), /最低预算/);
  });

  it('uses weighted reciprocal rank fusion without leaking unknown IDs', () => {
    const fused = reciprocalRankFusion([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }]
    ], { weights: [2, 1] });
    assert.equal(fused[0].id, 'b', 'an item present in both ranked lists should win the fusion');
    assert.deepEqual(new Set(fused.map((item) => item.id)), new Set(['a', 'b', 'c']));
  });
});

describe('dish search workflow', () => {
  it('uses a validated LLM filter supplement only for lexical misses', async () => {
    let calls = 0;
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '运动后想吃一份合适的',
      context: fixedContext,
      candidates: [
        candidate(),
        candidate({ id: 'low-protein', name: '清汤面', nutrition: { calories: 300, protein: 8, fat: 4, carbs: 50 } })
      ]
    }, {
      interpretQuery: async () => {
        calls += 1;
        return { filters: { minProtein: 30 } };
      }
    });

    assert.equal(calls, 1);
    assert.ok(result.meta.llmSupplementUsed);
    assert.equal(result.interpreted.filters.minProtein, 30);
    assert.deepEqual(result.items.map((item) => item.id), ['dish-1']);
  });

  it('does not call the LLM supplement when deterministic retrieval already matches', async () => {
    let calls = 0;
    await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '鸡胸肉',
      context: fixedContext,
      candidates: [candidate()]
    }, { interpretQuery: async () => { calls += 1; return { filters: { maxCalories: 1 } }; } });
    assert.equal(calls, 0);
  });

  it('combines exact, lexical and semantic retrieval but only accepts dish evidence in the tenant', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '想吃鸡胸肉',
      candidates: [
        candidate(),
        candidate({ id: 'dish-2', name: '番茄炒蛋', ingredients: ['番茄', '鸡蛋'], halal: false }),
        candidate({ id: 'other-tenant', tenantId: 'tenant-b', name: '鸡胸肉套餐' })
      ],
      context: fixedContext
    }, {
      semanticSearch: async () => [
        { sourceId: 'dish-2', sourceType: 'dish', score: 0.92 },
        { sourceId: 'health-doc', sourceType: 'health', score: 0.99 },
        { sourceId: 'other-tenant', sourceType: 'dish', score: 1 }
      ]
    });
    assert.equal(result.items[0].id, 'dish-1');
    assert.ok(result.items[0].matchReasons.some((reason) => reason.includes('鸡胸肉')));
    assert.equal(result.items.some((item) => item.id === 'other-tenant'), false);
    assert.equal(result.items.some((item) => item.id === 'health-doc'), false);
    assert.equal(result.items[0].availability.price, 15, 'menu price is database truth');
  });

  it('keeps sold-out catalog matches but marks them non-orderable', async () => {
    const soldOut = candidate({ menuItem: { ...candidate().menuItem, soldOut: true, supplyCount: 50 } });
    const result = await runDishSearchWorkflow({ tenantId: 'tenant-a', query: '香煎鸡胸饭', candidates: [soldOut], context: fixedContext });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].availability.orderable, false);
    assert.equal(result.items[0].availability.status, 'sold_out');
  });

  it('never sends hidden dishes into lexical, semantic or availability ranking', async () => {
    let semanticCandidateIds = [];
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: 'Hidden exact match',
      candidates: [
        candidate({
          id: 'hidden-dish',
          name: 'Hidden exact match',
          status: 'hidden',
          availability: { orderable: true, status: 'available', price: 1 }
        }),
        candidate({ id: 'active-dish', name: 'Active alternative', status: 'active' })
      ],
      context: fixedContext
    }, {
      semanticSearch: async ({ candidateIds }) => {
        semanticCandidateIds = candidateIds;
        return [{ sourceId: 'hidden-dish', sourceType: 'dish', score: 1 }];
      }
    });

    assert.deepEqual(semanticCandidateIds, ['active-dish']);
    assert.equal(result.items.some((item) => item.id === 'hidden-dish'), false);
    assert.equal(result.meta.sourceCandidateCount, 1);
  });

  it('returns explainable relaxations instead of inventing results', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '午餐预算5元以内的清真菜',
      candidates: [candidate()],
      context: fixedContext
    });
    assert.deepEqual(result.items, []);
    assert.ok(result.suggestedRelaxations.some((item) => item.filter === 'budgetMax'));
  });

  it('loads through the existing SQLite adapter', async () => {
    const db = openDatabase(':memory:');
    try {
      const result = await runDishSearchWorkflow({
        tenantId: 'default',
        query: '鸡腿饭',
        context: { date: new Date().toISOString().slice(0, 10), time: '12:00', mealType: 'lunch' }
      }, { db });
      assert.ok(Array.isArray(result.items));
      assert.ok(result.meta.sourceCandidateCount > 0);
    } finally {
      db.close();
    }
  });
});

describe('meal recommendation workflow', () => {
  it('enforces allergens, halal, budget, meal and availability before scoring', async () => {
    const result = await runMealRecommendationWorkflow({
      tenantId: 'tenant-a',
      query: '午餐推荐，花生过敏，只吃清真，预算18元以内',
      profile: { goal: 'fatLoss', budgetMax: 30, mealType: 'lunch', halalOnly: false },
      context: fixedContext,
      candidates: [
        candidate(),
        candidate({ id: 'allergen', name: '花生鸡丁', ingredients: ['花生', '鸡肉'], allergens: ['花生'] }),
        candidate({ id: 'not-halal', name: '红烧肉饭', halal: false }),
        candidate({ id: 'too-pricey', name: '牛排饭', menuItem: { ...candidate().menuItem, price: 25 } }),
        candidate({ id: 'sold-out', name: '清真牛肉饭', menuItem: { ...candidate().menuItem, soldOut: true } })
      ]
    });
    assert.deepEqual(result.recommendations.map((item) => item.id), ['dish-1']);
    assert.equal(result.recommendations[0].availability.orderable, true);
    assert.equal(result.mealPlan.mode, 'alternatives');
    assert.deepEqual(result.mealPlan.options.map((item) => item.dishId), result.recommendations.map((item) => item.id));
  });

  it('builds a combination whose total price respects the meal budget', async () => {
    const result = await runMealRecommendationWorkflow({
      tenantId: 'tenant-a',
      query: '帮我搭配午餐，预算30元',
      profile: { goal: 'healthy', mealType: 'lunch', budgetMax: 30 },
      context: fixedContext,
      candidates: [
        candidate({ id: 'a', name: '鸡胸肉', menuItem: { ...candidate().menuItem, id: 'mi-a', price: 16 } }),
        candidate({ id: 'b', name: '时蔬', ingredients: ['西兰花'], menuItem: { ...candidate().menuItem, id: 'mi-b', price: 8 } }),
        candidate({ id: 'c', name: '菌菇汤', ingredients: ['菌菇'], menuItem: { ...candidate().menuItem, id: 'mi-c', price: 6 } })
      ]
    });
    assert.equal(result.mealPlan.mode, 'combination');
    assert.equal(result.recommendations.length, 3);
    assert.ok(result.mealPlan.totals.price <= 30);
    assert.deepEqual(result.mealPlan.dishes.map((item) => item.id), result.recommendations.map((item) => item.id));
  });

  it('returns non-orderable catalog references and separated knowledge evidence when no menu item is available', async () => {
    const result = await runMealRecommendationWorkflow({
      tenantId: 'tenant-a',
      query: '高蛋白推荐',
      profile: { goal: 'muscleGain', mealType: 'lunch', budgetMax: 20 },
      context: fixedContext,
      candidates: [candidate({ menuItem: null })]
    }, {
      knowledgeSearch: async () => [
        { id: 'health-1', sourceType: 'health', title: '蛋白质摄入建议', content: '按个人情况合理摄入蛋白质。', score: 0.8 },
        { id: 'dish-noise', sourceType: 'dish', title: '不应混入知识证据', score: 1 }
      ]
    });
    assert.equal(result.meta.source, 'catalog_fallback');
    assert.equal(result.recommendations[0].availability.orderable, false);
    assert.ok(result.warnings.some((item) => item.code === 'NO_ORDERABLE_MENU'));
    assert.deepEqual(result.evidence.knowledge.map((item) => item.id), ['health-1']);
    assert.equal(result.evidence.dishes[0].sourceType, 'dish');
  });

  it('excludes hidden dishes from both current-menu and catalog-fallback recommendations', async () => {
    const result = await runMealRecommendationWorkflow({
      tenantId: 'tenant-a',
      query: '',
      profile: { goal: 'healthy', mealType: 'lunch', budgetMax: 20 },
      context: fixedContext,
      candidates: [
        candidate({
          id: 'hidden-dish',
          status: 'hidden',
          availability: { orderable: true, status: 'available', price: 1 }
        })
      ]
    });

    assert.deepEqual(result.recommendations, []);
    assert.equal(result.meta.sourceCandidateCount, 0);
    assert.equal(result.meta.source, 'catalog_fallback');
  });
});

describe('hard constraints', () => {
  it('never relaxes safety constraints in the filtering stage', () => {
    const mapped = [
      { ...candidate(), availability: { orderable: true, price: 15 } },
      { ...candidate({ id: 'unsafe', allergens: ['花生'] }), availability: { orderable: true, price: 15 } }
    ];
    const result = applyDishHardConstraints(mapped, { allergens: ['花生'] }, { requireOrderable: true });
    assert.deepEqual(result.items.map((item) => item.id), ['dish-1']);
    assert.equal(result.rejections.safety, 1);
  });

  it('accepts only active dish status as a hard constraint', () => {
    const mapped = ['active', 'hidden', 'inactive', 'archived', ''].map((status, index) => ({
      ...candidate({ id: `dish-${index}`, status }),
      availability: { orderable: true, price: 15 }
    }));
    const result = applyDishHardConstraints(mapped, {}, { requireOrderable: true });

    assert.deepEqual(result.items.map((item) => item.status), ['active']);
    assert.equal(result.rejections.status, 4);
  });
});
