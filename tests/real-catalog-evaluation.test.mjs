import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRealCatalogEvaluationQueries,
  CATEGORY_QUOTAS,
  summarizeRetrievalRows,
} from '../scripts/lib/real-catalog-evaluation.mjs';

function fixture() {
  const canteens = Array.from({ length: 6 }, (_, index) => ({ id: `canteen-${index}`, name: `餐厅${index}`, parentId: 'main', canteenType: 'sub' }));
  const stalls = canteens.flatMap((canteen, canteenIndex) => Array.from({ length: 5 }, (_, stallIndex) => ({
    id: `stall-${canteenIndex}-${stallIndex}`,
    canteenId: canteen.id,
    name: `档口${canteenIndex}-${stallIndex}`,
  })));
  const dishes = Array.from({ length: 360 }, (_, index) => ({
    id: `dish-${index}`,
    stallId: stalls[index % stalls.length].id,
    name: `测试菜品甲乙${String(index).padStart(3, '0')}`,
    aliases: [`测试别名甲乙${String(index).padStart(3, '0')}`],
    price: (index % 20) + 1,
    priceDisplay: `${(index % 20) + 1}元`,
    pricingMode: 'fixed',
    pricing: { budgetComparable: true },
    status: 'active',
  }));
  return { canteens: [{ id: 'main', name: '主食堂', canteenType: 'primary' }, ...canteens], stalls, dishes };
}

describe('real catalog evaluation generation', () => {
  it('builds exactly 150 referenced and stratified queries', () => {
    const bundle = fixture();
    const queries = buildRealCatalogEvaluationQueries(bundle);
    assert.equal(queries.length, 150);
    assert.equal(new Set(queries.map((item) => item.id)).size, 150);
    for (const [category, count] of Object.entries(CATEGORY_QUOTAS)) {
      assert.equal(queries.filter((item) => item.category === category).length, count);
    }
    const dishIds = new Set(bundle.dishes.map((item) => item.id));
    assert.ok(queries.flatMap((item) => item.expectedDishIds || []).every((id) => dishIds.has(id)));
  });

  it('reports hit rates, binary NDCG and latency without hiding misses', () => {
    const summary = summarizeRetrievalRows([
      { expectedCount: 1, rank: 1, latencyMs: 10 },
      { expectedCount: 1, rank: 4, latencyMs: 20 },
      { expectedCount: 1, rank: 0, latencyMs: 30 },
    ]);
    assert.equal(summary.hitAt1, 0.3333);
    assert.equal(summary.hitAt3, 0.3333);
    assert.equal(summary.hitAt5, 0.6667);
    assert.ok(summary.ndcgAt10 > 0 && summary.ndcgAt10 < 1);
    assert.equal(summary.latencyP95Ms, 30);
  });
});
