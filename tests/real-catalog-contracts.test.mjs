import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../server/database.js';
import { budgetPriceForDish, normalizeDishPricing } from '../server/dishPricing.js';
import { importRealCatalog, rollbackRealCatalogBatch } from '../server/realCatalogImport.js';
import * as webPresentation from '../src/domain/dishPresentation.js';
import * as miniappPresentation from '../miniapp/src/domain/dishPresentation.js';

process.env.ENABLE_DEMO_SEED = '0';

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'smart-canteen-real-catalog-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

function catalogBundle() {
  const batchId = 'real-catalog-contract-test';
  const source = { name: 'menu-source.txt', areaId: 'real-area', sha256: 'a'.repeat(64) };
  return {
    manifest: {
      tenantId: 'default',
      batchId,
      dataVersion: 'test-v1',
      sources: [source],
    },
    canteens: [
      { id: 'real-main', name: '测试大食堂', canteenType: 'primary' },
      { id: 'real-area', name: '测试餐厅', parentId: 'real-main', canteenType: 'sub' },
    ],
    stalls: [{ id: 'real-stall', canteenId: 'real-area', name: '测试档口', aliases: ['测试店'], open: false }],
    dishes: [{
      id: 'real-dish',
      stallId: 'real-stall',
      name: '测试称重菜',
      price: 1.68,
      pricingMode: 'per_weight',
      priceDisplay: '1.68元/50克',
      pricing: { mode: 'per_weight', baseAmount: 1.68, baseQuantity: 50, unit: '克', minAmount: 1.68, maxAmount: 1.68, budgetComparable: false },
      taste: '待核验',
      cuisine: '待核验',
      ingredients: [],
      seasonings: [],
      additives: [],
      tags: [],
      aliases: ['称重测试菜'],
      semanticLabels: ['称重餐'],
      mealTypes: [],
      nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
      rating: 0,
      reviewCount: 0,
      synthetic: false,
      factStatus: { nutrition: 'unknown', recipe: 'unknown', halal: 'unknown', dietary: 'unknown', spice: 'unknown' },
      safetyDeclarations: [{ allergenCode: '*', status: 'unknown', source: 'menu_document', dataVersion: 'test-v1' }],
      sourceRef: { batchId, sources: [{ sourceHash: source.sha256, sourceName: source.name, locator: 'line:1' }] },
    }],
    menus: [],
    importRows: [],
    report: { reviewRequiredCount: 0 },
  };
}

describe('real catalog price semantics', () => {
  it('normalizes all supported pricing modes without treating weight unit price as a serving total', () => {
    const fixed = normalizeDishPricing({ pricingMode: 'fixed', pricing: { baseAmount: 12 } }, 12);
    const weight = normalizeDishPricing({ pricingMode: 'per_weight', pricing: { baseAmount: 1.68, baseQuantity: 50, unit: '克' } }, 1.68);
    const person = normalizeDishPricing({ pricingMode: 'per_person', pricing: { baseAmount: 29 } }, 29);
    const variants = normalizeDishPricing({ pricingMode: 'variants', pricing: { variants: [{ id: 's', label: '小份', amount: 8 }, { id: 'l', label: '大份', amount: 12 }] } }, 8);
    const tiered = normalizeDishPricing({ pricingMode: 'tiered', priceDisplay: '10/15/20元', pricing: { minAmount: 10, maxAmount: 20 } }, 10);

    assert.equal(fixed.display, '12元');
    assert.equal(weight.display, '1.68元/50克');
    assert.equal(weight.budgetComparable, false);
    assert.equal(budgetPriceForDish({ price: 1.68, pricingMode: 'per_weight', pricing: weight }), null);
    assert.equal(person.display, '29元/位');
    assert.equal(variants.display, '8-12元');
    assert.equal(tiered.display, '10/15/20元');
  });
});

describe('real catalog import transactions', () => {
  it('is idempotent by batch and can roll the complete batch back', () => {
    const db = openDatabase(join(temporaryDirectory(), 'catalog.sqlite'));
    try {
      const bundle = catalogBundle();
      const first = importRealCatalog(db, bundle);
      const insertRetrieval = db.prepare(`INSERT INTO rag_documents
        (id, tenant_id, source_type, source_id, title, content, metadata_json, updated_at)
        VALUES (?, 'default', ?, ?, ?, ?, '{}', ?)`);
      insertRetrieval.run('retrieval:default:dish:real-dish:chunk:0', 'dish', 'real-dish', '测试称重菜', '测试', new Date().toISOString());
      insertRetrieval.run('retrieval:default:stall:real-stall:chunk:0', 'stall', 'real-stall', '测试档口', '测试', new Date().toISOString());
      const second = importRealCatalog(db, bundle);
      assert.equal(first.dishes, 1);
      assert.equal(second.dishes, 1);
      assert.equal(second.idempotent, true);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM dishes WHERE id = 'real-dish'").get().count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rag_documents WHERE source_id IN ('real-dish', 'real-stall')").get().count, 2);
      const row = db.prepare("SELECT rating, review_count, calories, nutrition_fact_status, pricing_mode, price_display FROM dishes WHERE id = 'real-dish'").get();
      assert.deepEqual({ ...row }, { rating: 0, review_count: 0, calories: 0, nutrition_fact_status: 'unknown', pricing_mode: 'per_weight', price_display: '1.68元/50克' });
      assert.equal(db.prepare("SELECT aliases_json FROM stalls WHERE id = 'real-stall'").get().aliases_json, '["测试店"]');

      const rolledBack = rollbackRealCatalogBatch(db, bundle.manifest.batchId);
      assert.equal(rolledBack.dishes, 1);
      assert.equal(rolledBack.stalls, 1);
      assert.equal(rolledBack.canteens, 2);
      assert.equal(rolledBack.retrievalDocuments, 2);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM dishes WHERE id = 'real-dish'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rag_documents WHERE source_id IN ('real-dish', 'real-stall')").get().count, 0);
    } finally {
      db.close();
    }
  });
});

describe('dish fact presentation parity', () => {
  for (const [client, presentation] of [['web', webPresentation], ['miniapp', miniappPresentation]]) {
    it(`${client} prefers structured prices and never presents unknown facts as zero`, () => {
      const unknown = {
        price: 1.68,
        priceDisplay: '1.68元/50克',
        pricing: { display: '1.68元/50克' },
        rating: 0,
        reviewCount: 0,
        nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        factStatus: { nutrition: 'unknown' },
        availability: { status: 'catalog_only', orderable: false, price: 1.68, priceDisplay: '1.68元/50克' },
      };
      assert.equal(presentation.dishPriceText(unknown), '1.68元/50克');
      assert.equal(presentation.dishRatingText(unknown), '暂无评分');
      assert.deepEqual(presentation.dishNutritionPresentation(unknown), { known: false, status: 'unknown', label: '营养待核验', metrics: {} });
      assert.equal(presentation.dishSupplyPresentation(unknown).label, '今日供应尚未确认');

      const verified = { price: 12, rating: 4.6, reviewCount: 8, nutrition: { calories: 420, protein: 26, fat: 9, carbs: 58 }, factStatus: { nutrition: 'verified' } };
      assert.equal(presentation.dishPriceText(verified), '12元');
      assert.equal(presentation.dishRatingText(verified), '4.6 分');
      assert.match(presentation.dishNutritionPresentation(verified).label, /420 kcal/);
    });
  }
});

describe('isolated retrieval reindex', () => {
  it('does not seed demo dishes unless explicitly requested', () => {
    const databasePath = join(temporaryDirectory(), 'clean-reindex.sqlite');
    const result = spawnSync(process.execPath, [
      resolve('scripts/reindex-retrieval.mjs'),
      `--sqlite=${databasePath}`,
      '--tenant=default',
      '--source=dish',
      '--lexical-only',
    ], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, ENABLE_DEMO_SEED: '1' },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const db = openDatabase(databasePath);
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dishes').get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rag_documents WHERE source_type = 'dish'").get().count, 0);
    } finally {
      db.close();
    }
    const openapi = readFileSync(resolve('openapi/smart-canteen.yaml'), 'utf8');
    assert.match(openapi, /catalog_only/);
    assert.match(openapi, /pricingMode/);
    assert.match(openapi, /priceDisplay/);
  });
});
