import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  DISH_AI_ANNOTATION_BATCH_JSON_SCHEMA,
  annotationRecord,
  buildDishAnnotationInput,
  findDishAiAnnotation,
  listDishAiAnnotations,
  saveDishAiAnnotation,
  selectDishAnnotationPilot,
  validateDishAiAnnotation,
} from '../server/dishAiAnnotations.js';

function pilotCatalog() {
  const canteens = Array.from({ length: 6 }, (_, index) => ({
    id: `canteen-${index + 1}`,
    name: `餐厅${index + 1}`,
  }));
  const stalls = canteens.map((canteen, index) => ({
    id: `stall-${index + 1}`,
    name: `档口${index + 1}`,
    canteenId: canteen.id,
  }));
  const modes = ['fixed', 'per_weight', 'per_person', 'per_unit', 'variants', 'tiered'];
  const dishes = Array.from({ length: 240 }, (_, index) => ({
    id: `dish-${String(index + 1).padStart(3, '0')}`,
    name: `测试菜品${index + 1}`,
    stallId: stalls[index % stalls.length].id,
    pricingMode: modes[index % modes.length],
    status: 'active',
  }));
  return { canteens, stalls, dishes };
}

function validAnnotation(dishId = 'dish-001') {
  return {
    dishId,
    factStatus: 'estimated',
    safetyStatus: 'unknown',
    aliases: ['番茄鸡蛋盖饭'],
    cuisineCandidates: ['家常'],
    cookingMethods: ['炒'],
    tasteProfiles: ['咸鲜'],
    spiceLevel: 0,
    mealTypes: ['lunch'],
    ingredientHypotheses: [{
      name: '鸡蛋',
      role: 'primary',
      confidence: 0.9,
      basis: 'dish_name',
      referenceIds: ['food:egg'],
    }],
    seasoningHypotheses: [],
    allergenHints: [{
      allergenCode: 'egg',
      confidence: 0.8,
      reason: '菜名明确包含鸡蛋',
      referenceIds: ['food:egg'],
    }],
    nutritionEstimate: {
      basis: 'per_serving',
      portionAssumption: '按一份约四百克估算',
      caloriesKcal: { min: 420, max: 780 },
      proteinG: { min: 12, max: 28 },
      fatG: { min: 8, max: 30 },
      carbsG: { min: 55, max: 110 },
      confidence: 0.55,
      referenceIds: ['food:egg'],
    },
    scenarioTags: ['日常午餐'],
    nutritionGoalTags: ['蛋白质来源'],
    linkedConceptIds: ['concept:egg-rice'],
    sourceIds: ['concept:egg-rice', 'food:egg'],
    uncertaintyNotes: ['真实配方和份量待食堂核验'],
    fieldConfidence: {
      aliases: 0.9,
      cuisineCandidates: 0.6,
      cookingMethods: 0.7,
      tasteProfiles: 0.7,
      spiceLevel: 0.8,
      mealTypes: 0.7,
      ingredientHypotheses: 0.8,
      seasoningHypotheses: 0.5,
      allergenHints: 0.7,
      nutritionEstimate: 0.55,
      scenarioTags: 0.6,
      nutritionGoalTags: 0.6,
    },
  };
}

function annotationDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE dishes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL
    );
    CREATE TABLE dish_ai_annotations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      annotation_json TEXT NOT NULL,
      field_confidence_json TEXT NOT NULL,
      linked_concept_ids_json TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, dish_id, batch_id, input_hash)
    );
  `);
  return db;
}

describe('dish AI annotation review layer', () => {
  it('exports the strict model output contract from the authoritative Zod schema', () => {
    const annotation = DISH_AI_ANNOTATION_BATCH_JSON_SCHEMA.properties.annotations.items;

    assert.equal(DISH_AI_ANNOTATION_BATCH_JSON_SCHEMA.additionalProperties, false);
    assert.equal(annotation.additionalProperties, false);
    for (const field of ['dishId', 'spiceLevel', 'allergenHints', 'nutritionEstimate', 'fieldConfidence']) {
      assert.ok(annotation.required.includes(field), `missing required model field ${field}`);
    }
    assert.equal(annotation.properties.uncertaintyNotes.minItems, 1);
    assert.equal(annotation.properties.fieldConfidence.required.length, 12);
  });

  it('selects 200 unique dishes deterministically across locations and pricing modes', () => {
    const catalog = pilotCatalog();
    const first = selectDishAnnotationPilot(catalog);
    const second = selectDishAnnotationPilot(catalog);

    assert.equal(first.length, 200);
    assert.equal(new Set(first.map((dish) => dish.id)).size, 200);
    assert.deepEqual(first.map((dish) => dish.id), second.map((dish) => dish.id));
    assert.deepEqual(new Set(first.map((dish) => dish.canteenId)), new Set(catalog.canteens.map((item) => item.id)));
    for (const mode of ['fixed', 'per_weight', 'per_person', 'per_unit', 'variants', 'tiered']) {
      assert.ok(first.some((dish) => dish.pricingMode === mode), `missing ${mode}`);
    }
  });

  it('supports a deterministic reduced pilot without exceeding the requested count', () => {
    const catalog = pilotCatalog();
    const first = selectDishAnnotationPilot(catalog, { count: 5, seed: 'probe' });
    const second = selectDishAnnotationPilot(catalog, { count: 5, seed: 'probe' });

    assert.equal(first.length, 5);
    assert.equal(new Set(first.map((dish) => dish.id)).size, 5);
    assert.deepEqual(first.map((dish) => dish.id), second.map((dish) => dish.id));
    assert.ok(new Set(first.map((dish) => dish.pricingMode)).size >= 4);
  });

  it('accepts estimated candidates and rejects authoritative safety states or unknown references', () => {
    const allowed = {
      dishId: 'dish-001',
      allowedConceptIds: new Set(['concept:egg-rice']),
      allowedReferenceIds: new Set(['food:egg']),
      allowedSourceIds: new Set(['concept:egg-rice', 'food:egg']),
    };
    const parsed = validateDishAiAnnotation(validAnnotation(), allowed);
    assert.equal(parsed.factStatus, 'estimated');
    assert.equal(parsed.safetyStatus, 'unknown');
    assert.deepEqual(
      validateDishAiAnnotation({ ...validAnnotation(), mealTypes: ['午餐', '晚饭', '夜宵'] }, allowed).mealTypes,
      ['lunch', 'dinner', 'late_snack'],
    );

    assert.throws(
      () => validateDishAiAnnotation({ ...validAnnotation(), safetyStatus: 'confirmed_absent' }, allowed),
      /Invalid input|expected "unknown"/i,
    );
    assert.throws(
      () => validateDishAiAnnotation({ ...validAnnotation(), linkedConceptIds: ['concept:not-provided'] }, allowed),
      /linkedConceptIds/,
    );
    assert.throws(
      () => validateDishAiAnnotation({ ...validAnnotation(), sourceIds: ['source:not-provided'] }, allowed),
      /sourceIds/,
    );
    assert.throws(
      () => validateDishAiAnnotation({ ...validAnnotation(), sourceIds: ['food:egg'] }, allowed),
      /sourceIds 缺少实际引用/,
    );
  });

  it('builds a stable input hash from approved evidence only', () => {
    const dish = {
      id: 'dish-001',
      name: '番茄鸡蛋盖饭',
      stallName: '盖饭档',
      canteenName: '一楼东厅',
      sourceRef: { sourceSha256: 'not-model-evidence' },
    };
    const knowledge = {
      model: 'deepseek-v4-flash',
      concepts: [{ id: 'concept:egg-rice', canonicalName: '鸡蛋盖饭', aliases: ['蛋炒饭'], softTags: [], status: 'approved' }],
      references: [{ id: 'food:egg', canonicalName: '鸡蛋参考食材', aliases: ['鸡蛋'], basisGrams: 100, nutrients: {}, factStatus: 'reference_only', campusDishFactPolicy: 'must_not_overwrite' }],
      healthDocuments: [
        {
          id: 'health:approved',
          title: '健康知识',
          content: '用于解释营养估算边界。',
          metadata: {
            knowledgeDomain: 'nutrition',
            factStatus: 'verified_reference',
            safetyBoundary: '不替代医疗建议',
            sourceStatus: 'approved',
          },
        },
        { id: 'health:draft', title: '草稿', knowledgeDomain: 'nutrition', content: '不得加载', status: 'draft' },
      ],
    };
    const first = buildDishAnnotationInput(dish, knowledge);
    const second = buildDishAnnotationInput(dish, knowledge);

    assert.equal(first.inputHash, second.inputHash);
    assert.equal(first.payload.dish.sourceRef, undefined);
    assert.deepEqual(first.payload.healthKnowledge.map((item) => item.id), ['health:approved']);
    assert.equal(first.payload.healthKnowledge[0].factStatus, 'verified_reference');
    assert.ok(first.allowedSourceIds.has('food:egg'));
    assert.ok(!first.allowedSourceIds.has('health:draft'));
  });

  it('upserts annotations idempotently without modifying formal dish facts', async () => {
    const db = annotationDatabase();
    db.prepare('INSERT INTO dishes (id, name, price) VALUES (?, ?, ?)').run('dish-001', '番茄鸡蛋盖饭', 12);
    const before = db.prepare('SELECT * FROM dishes WHERE id = ?').get('dish-001');
    const annotation = validAnnotation();
    const record = annotationRecord({
      tenantId: 'default',
      batchId: 'pilot-20260728',
      model: 'deepseek-v4-flash',
      inputHash: 'a'.repeat(64),
      annotation,
      now: '2026-07-28T08:00:00.000Z',
    });

    await saveDishAiAnnotation(db, record);
    await saveDishAiAnnotation(db, { ...record, updatedAt: '2026-07-28T09:00:00.000Z' });

    const found = await findDishAiAnnotation(db, {
      tenantId: 'default',
      dishId: 'dish-001',
      batchId: 'pilot-20260728',
      inputHash: 'a'.repeat(64),
    });
    const listed = await listDishAiAnnotations(db, { tenantId: 'default', batchId: 'pilot-20260728' });
    const after = db.prepare('SELECT * FROM dishes WHERE id = ?').get('dish-001');

    assert.equal(found.id, record.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].annotation.factStatus, 'estimated');
    assert.deepEqual(after, before);
    db.close();
  });
});
