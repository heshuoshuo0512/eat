import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { classifyCatalogItem } from '../server/catalogClassification.js';

const audit = JSON.parse(readFileSync('data/imports/real/campus-2026-07-27/catalog-classification-audit-v4.json', 'utf8'));
const migration = readFileSync('server/migrations/030_catalog_category_reclassification.sql', 'utf8');
const rollback = readFileSync('server/rollbacks/030_catalog_category_reclassification.rollback.sql', 'utf8');
const retiredMealCategories = new Set(['组合套餐', '干锅菜', '砂锅煲类', '水煮菜', '蒸菜', '轻食简餐', '精品小炒', '多人烤鱼', '烤鱼']);

describe('catalog category reclassification', () => {
  it('audits every real catalog row without retired meal categories or unresolved reviews', () => {
    assert.equal(audit.schemaVersion, 'catalog-classification-audit-v4');
    assert.equal(audit.total, 2563);
    assert.equal(audit.audited, 2563);
    assert.equal(audit.needsReviewCount, 0);
    assert.equal(audit.records.length, 2563);
    assert.equal(new Set(audit.records.map((record) => record.id)).size, 2563);
    assert.deepEqual([...retiredMealCategories].filter((category) => audit.categoryCounts[category]), []);
    assert.deepEqual(audit.counts, {
      meal: 2082,
      addon: 221,
      fee: 4,
      snack: 156,
      beverage: 80,
      variant: 9,
      section: 11,
    });
  });

  it('classifies cross-boundary names by main dish form', () => {
    assert.equal(classifyCatalogItem({ name: '干锅花菜', price: 10, stallName: '小炒档口' }).category, '家常热菜');
    assert.equal(classifyCatalogItem({ name: '砂锅鸡公煲', price: 18, stallName: '砂锅档口' }).category, '米饭套餐');
    assert.equal(classifyCatalogItem({ name: '水煮鱼', price: 18, stallName: '家常菜档口' }).category, '米饭套餐');
    assert.equal(classifyCatalogItem({ name: '水煮鱼米线', price: 18, stallName: '米线档口' }).category, '面食粉类');
    assert.equal(classifyCatalogItem({ name: '鸡肉谷物沙拉', price: 15, stallName: '轻食档口' }).itemType, 'snack');
    assert.equal(classifyCatalogItem({ name: '烤里鱼', price: 18, stallName: '青年盖饭干锅' }).category, '米饭套餐');
    assert.equal(classifyCatalogItem({ name: '无骨烤鱼', price: 14, stallName: '杨香记水煮肉片' }).category, '家常热菜');
  });

  it('contains a transaction-safe stable-ID migration and guarded rollback', () => {
    assert.match(migration, /CREATE TEMP TABLE catalog_classification_030_proposed/i);
    assert.match(migration, /catalog_classification_audits/i);
    assert.match(migration, /expected_count INTEGER := 2563/i);
    assert.match(migration, /UPDATE dishes d[\s\S]*FROM catalog_classification_030_proposed/i);
    assert.match(migration, /DELETE FROM rag_documents/i);
    assert.doesNotMatch(migration, /DELETE FROM dishes/i);
    assert.match(rollback, /rollback refused/i);
    assert.match(rollback, /before_item_type/i);
    assert.match(rollback, /DELETE FROM rag_documents/i);
  });

  it('keeps keyword relevance ahead of the selected secondary sort', () => {
    const app = readFileSync('server/app.js', 'utf8');
    assert.match(app, /A keyword search always ranks by the documented relevance tiers first/);
    assert.match(app, /relevance_score DESC, \$\{sort === 'price_asc'/);
  });
});
