import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import { loadFoodCompositionReferences } from '../server/healthKnowledgeBase.js';
import { businessDate } from '../server/time.js';
import {
  applyDishHardConstraints,
  matchFoodCompositionReferencesForQuery,
  mergeDiningConversationState,
  parseDishSearchRequest,
  reciprocalRankFusion,
  retrieveRoutedKnowledge,
  routeDiningKnowledgeSources,
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
  it('routes policy, nutrition and allergy questions to isolated evidence sources', () => {
    const policy = routeDiningKnowledgeSources('食堂退款和投诉规则是什么');
    const nutrition = routeDiningKnowledgeSources('训练后吃鸡蛋怎么补充蛋白质');
    const allergy = routeDiningKnowledgeSources('花生过敏时怎么理解交叉接触风险');

    assert.equal(policy.intent, 'campus_policy');
    assert.deepEqual(policy.routes.flatMap((item) => item.sourceTypes), ['campus_policy']);
    assert.equal(policy.includeFoodComposition, false);
    assert.equal(nutrition.intent, 'nutrition_and_health');
    assert.deepEqual(nutrition.routes.map((item) => item.sourceTypes[0]), ['health_knowledge', 'campus_dining_knowledge']);
    assert.equal(nutrition.includeFoodComposition, true);
    assert.equal(allergy.intent, 'allergy_safety');
    assert.ok(!allergy.routes.some((item) => item.sourceTypes.includes('campus_policy')));
  });

  it('matches FDC/FoodOn references structurally without turning them into campus dish facts', () => {
    const matches = matchFoodCompositionReferencesForQuery(
      '鸡蛋每100克大概有多少蛋白质',
      loadFoodCompositionReferences(),
      5,
    );
    assert.ok(matches.length > 0);
    assert.equal(matches[0].sourceType, 'food_composition_reference');
    assert.equal(matches[0].evidenceType, 'reference_only');
    assert.equal(matches[0].tenantId, '__global__');
    assert.equal(matches[0].metadata.campusDishFactPolicy, 'must_not_overwrite');
    assert.ok(matches[0].metadata.fdcId);
    assert.match(matches[0].metadata.foodOnId, /^FOODON:/);
  });

  it('retrieves routed sources separately and excludes dish documents from knowledge evidence', async () => {
    const calls = [];
    const result = await retrieveRoutedKnowledge({
      query: '训练后吃鸡蛋补充蛋白质',
      tenantId: 'tenant-a',
      limit: 6,
    }, {
      knowledgeSearch: async (request) => {
        calls.push(request.sourceTypes);
        if (request.sourceTypes.includes('health_knowledge')) return {
          items: [
            { id: 'health-1', sourceId: 'health-1', sourceType: 'health_knowledge', title: '运动恢复原则', content: '一般性恢复建议。', metadata: { publisher: '中国营养学会', evidenceType: 'approved_global_knowledge' } },
            { id: 'dish-noise', sourceId: 'dish-noise', sourceType: 'dish', title: '不得成为知识证据' },
          ],
          warnings: [],
        };
        return { items: [{ id: 'concept-1', sourceId: 'concept-1', sourceType: 'campus_dining_knowledge', title: '训练后用餐', content: '校园场景概念。', metadata: {} }], warnings: [] };
      },
      foodCompositionLookup: ({ query, limit }) => matchFoodCompositionReferencesForQuery(query, loadFoodCompositionReferences(), limit),
    });

    assert.deepEqual(calls, [['health_knowledge'], ['campus_dining_knowledge']]);
    assert.ok(result.results.some((item) => item.sourceType === 'health_knowledge'));
    assert.ok(result.results.some((item) => item.sourceType === 'food_composition_reference'));
    assert.ok(result.results.every((item) => item.sourceType !== 'dish'));
    assert.equal(result.trace.routing.intent, 'nutrition_and_health');
    assert.ok(result.trace.structuredReferenceCount > 0);
  });

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

  it('understands compact Chinese budget ceilings', () => {
    const parsed = parseDishSearchRequest('午餐20元内，高蛋白、不太辣、避开花生');
    assert.equal(parsed.filters.budgetMax, 20);
    assert.deepEqual(parsed.filters.allergens, ['花生']);
  });

  it('does not turn flavor words inside an explicitly named dish into hard filters', () => {
    assert.equal(parseDishSearchRequest('黑椒牛肉意面有木有').filters.taste, undefined);
    assert.equal(parseDishSearchRequest('晚上九点还有黑椒牛肉意面吗').filters.taste, undefined);
    assert.equal(parseDishSearchRequest('整点低脂卤肉饭呗').filters.maxFat, undefined);
    assert.equal(parseDishSearchRequest('想吃黑椒牛肉意面，20元以内').filters.taste, undefined);
    assert.equal(parseDishSearchRequest('减脂想吃低脂少油的').filters.maxFat, 15);
  });

  it('treats an absolute budget update as the new ceiling', () => {
    let state = mergeDiningConversationState({}, '午餐20元内');
    state = mergeDiningConversationState(state, '预算改成25元');
    assert.equal(state.filters.budgetMax, 25);
  });

  it('separates currency bounds from nutrition units and availability wording from ingredients', () => {
    const nutrition = parseDishSearchRequest('别太咸，蛋白质至少25克');
    const availability = parseDishSearchRequest('不要售罄的，价格最多18元');
    assert.equal(nutrition.filters.budgetMin, undefined);
    assert.equal(nutrition.filters.minProtein, 25);
    assert.equal(availability.filters.budgetMax, 18);
    assert.equal(availability.filters.orderableOnly, true);

    const currentlySupplied = parseDishSearchRequest('只看现在有供应的菜');
    assert.equal(currentlySupplied.filters.orderableOnly, true);
    assert.equal(availability.filters.avoidIngredients, undefined);
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

  it('prefers the longest explicitly named dish over a shorter contained name', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '想吃鸡架拌面',
      candidates: [
        candidate({ id: 'short-name', name: '鸡架' }),
        candidate({ id: 'specific-name', name: '鸡架拌面' }),
      ],
      context: fixedContext,
    });

    assert.equal(result.items[0].id, 'specific-name');
  });

  it('recovers a single missing character in a dish-name query', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '鸡肉子',
      candidates: [
        candidate({ id: 'noise', name: '把子肉' }),
        candidate({ id: 'expected', name: '鸡肉包子' }),
      ],
      context: fixedContext,
    });

    assert.equal(result.items[0].id, 'expected');
    assert.ok(result.items[0].matchReasons.includes('菜名近似匹配'));
  });

  it('keeps unknown taste facts visible with a warning instead of filtering the whole catalog', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '咖喱',
      filters: { taste: '咖喱' },
      candidates: [candidate({ id: 'unknown-taste', name: '咖喱鸡排饭', taste: '待核验' })],
      context: fixedContext,
    });

    assert.deepEqual(result.items.map((item) => item.id), ['unknown-taste']);
    assert.ok(result.warnings.some((warning) => warning.code === 'TASTE_UNVERIFIED'));
  });

  it('uses vector support rather than the small RRF score for confidence inputs', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a', query: '运动后恢复', candidates: [candidate()], context: fixedContext,
    }, {
      semanticSearch: async () => [{ sourceId: 'dish-1', sourceType: 'dish', score: 0.016, vectorScore: 0.82 }],
    });
    assert.ok(result.items[0].confidence.factors.semanticSupport >= 0.8);
  });

  it('uses a named tenant canteen as a hard search filter', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '去运动餐厅找午餐',
      candidates: [
        candidate({ id: 'north-dish', canteenId: 'north', canteenName: '北苑食堂' }),
        candidate({ id: 'sports-dish', canteenId: 'sports', canteenName: '运动餐厅' }),
      ],
      context: fixedContext,
    });

    assert.deepEqual(result.items.map((item) => item.id), ['sports-dish']);
    assert.equal(result.interpreted.filters.canteenId, 'sports');
    assert.equal(result.interpreted.detected.includes('canteenId'), true);
  });

  it('warns about both allergen and supply uncertainty for an empty catalog area', async () => {
    const db = openDatabase(':memory:');
    const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO canteens
        (id, tenant_id, name, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('east-dongdahuo-empty', 'default', '东区东大活', '东区', '待核验', 0, '[]', '目录快照', null, 'dining_area', '', now, now);

      const result = await runDishSearchWorkflow({
        tenantId: 'default',
        query: '我对小麦过敏，东区东大活有什么能吃',
        context: fixedContext,
      }, { db });

      assert.deepEqual(result.items, []);
      assert.equal(result.interpreted.filters.canteenId, 'east-dongdahuo-empty');
      assert.ok(result.warnings.some((warning) => warning.code === 'ALLERGEN_UNVERIFIED'));
      assert.ok(result.warnings.some((warning) => warning.code === 'SUPPLY_UNCONFIRMED'));
    } finally {
      db.close();
    }
  });

  it('uses a unique tenant stall mention as a hard filter within the selected canteen', async () => {
    const result = await runDishSearchWorkflow({
      tenantId: 'tenant-a',
      query: '北苑食堂汉堡鸡排饭档的香辣粉丝丸子',
      candidates: [
        candidate({ id: 'target', stallId: 'burger', stallName: '汉堡鸡排饭档', canteenId: 'north', canteenName: '北苑食堂', name: '香辣粉丝丸子', taste: '待核验' }),
        candidate({ id: 'noise', stallId: 'noodle', stallName: '面食档', canteenId: 'north', canteenName: '北苑食堂', name: '香辣肉片', taste: '待核验' }),
      ],
      context: fixedContext,
    });

    assert.deepEqual(result.items.map((item) => item.id), ['target']);
    assert.equal(result.interpreted.filters.canteenId, 'north');
    assert.equal(result.interpreted.filters.stallId, 'burger');
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
        context: { date: businessDate(), time: '12:00', mealType: 'lunch' }
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

  it('uses a named tenant canteen as a hard recommendation filter', async () => {
    const result = await runMealRecommendationWorkflow({
      tenantId: 'tenant-a',
      query: '去运动餐厅吃午餐，只看现在有供应的菜',
      profile: { goal: 'healthy', mealType: 'lunch', budgetMax: 30 },
      context: fixedContext,
      candidates: [
        candidate({ id: 'north-dish', canteenId: 'north', canteenName: '北苑食堂' }),
        candidate({ id: 'sports-dish', canteenId: 'sports', canteenName: '运动餐厅' }),
      ],
    });

    assert.deepEqual(result.recommendations.map((item) => item.id), ['sports-dish']);
    assert.equal(result.meta.interpreted.filters.canteenId, 'sports');
    assert.equal(result.meta.interpreted.filters.orderableOnly, true);
    assert.equal(result.meta.interpreted.detected.includes('canteenId'), true);
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

  it('does not treat stall retrieval documents as recommendation candidates', async () => {
    const result = await runMealRecommendationWorkflow({
      tenantId: 'tenant-a',
      query: '轻食档口有什么推荐',
      profile: { goal: 'healthy', mealType: 'lunch', budgetMax: 20 },
      context: fixedContext,
      candidates: [candidate()],
    }, {
      semanticSearch: async () => [
        { sourceId: 'stall-1', sourceType: 'stall', score: 1 },
      ],
    });

    assert.equal(result.meta.semanticUsed, false);
    assert.ok(result.recommendations.every((item) => item.id !== 'stall-1'));
    assert.ok(result.evidence.dishes.every((item) => item.sourceType === 'dish'));
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

  it('conservatively rejects a dish whose name explicitly contains the requested allergen', () => {
    const mapped = [
      { ...candidate({ id: 'named-allergen', name: '花生鸡丁', ingredients: [], allergens: [] }), availability: { orderable: true, price: 15 } },
      { ...candidate({ id: 'unknown-recipe', name: '宫保鸡丁', ingredients: [], allergens: [] }), availability: { orderable: true, price: 15 } },
      { ...candidate({ id: 'fish-flavor', name: '鱼香肉丝', ingredients: [], allergens: [] }), availability: { orderable: true, price: 15 } },
    ];

    const peanut = applyDishHardConstraints(mapped, { allergens: ['花生'] }, { requireOrderable: true });
    const fish = applyDishHardConstraints(mapped, { allergens: ['鱼'] }, { requireOrderable: true });
    assert.equal(peanut.items.some((item) => item.id === 'named-allergen'), false);
    assert.equal(peanut.items.find((item) => item.id === 'unknown-recipe').safety.status, 'unknown');
    assert.equal(fish.items.some((item) => item.id === 'fish-flavor'), true, '鱼香 is not proof that a dish contains fish');
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
