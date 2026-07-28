import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { businessDate } from '../server/time.js';
import { openDatabase, parseJson } from '../server/database.js';
import { calculateRecipeNutrition } from '../server/mealNutrition.js';
import {
  addDishReferenceImage,
  analyzeTrustworthyMeal,
  confirmMealVisionAnalysis,
  createDishRecipeVersion,
  getMealVisionMetrics,
  selectScopedVisionCandidates,
  updateDishReferenceImage,
} from '../server/visionMealService.js';

const originalFetch = globalThis.fetch;
const originalEnvironment = Object.fromEntries([
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_VISION_MODEL',
  'VISION_AUTO_MATCH_ENABLED',
  'VISION_EMBEDDING_BASE_URL',
].map((key) => [key, process.env[key]]));

let db;
let student;
let admin;
let observation;
let capturedAt;
let imageBase64;
let aiCallCount;

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function cloneDish(sourceId, id, name) {
  const columns = db.prepare('PRAGMA table_info(dishes)').all().map((item) => item.name);
  const row = db.prepare('SELECT * FROM dishes WHERE id = ?').get(sourceId);
  assert.ok(row, `missing source dish ${sourceId}`);
  row.id = id;
  row.name = name;
  row.nutrition_fact_status = 'unknown';
  row.recipe_fact_status = 'unknown';
  row.fact_source = 'vision-test';
  row.data_version = 'vision-test-v1';
  db.prepare(`INSERT INTO dishes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => row[column]));
}

function mealBody(context = {}) {
  return {
    filename: 'meal.jpg',
    contentType: 'image/jpeg',
    dataBase64: imageBase64,
    mode: 'single_dish',
    context: { capturedAt, mealType: 'lunch', ...context },
    portion: { size: 'regular' },
  };
}

describe('trustworthy meal vision MVP', () => {
  before(() => {
    process.env.AI_API_KEY = 'vision-test-key';
    process.env.AI_BASE_URL = 'http://vision-ai.test/v1';
    process.env.AI_VISION_MODEL = 'vision-test-model';
    delete process.env.VISION_AUTO_MATCH_ENABLED;
    delete process.env.VISION_EMBEDDING_BASE_URL;

    observation = {
      genericNames: ['香煎鸡胸杂粮饭'],
      visibleIngredients: ['鸡胸肉', '杂粮饭'],
      cookingMethods: ['煎'],
      presentation: '单份主食和蛋白质',
      multipleItems: false,
      dishCountEstimate: 1,
      quality: { usable: true, issueCodes: [] },
      estimatedNutrition: null,
      confidence: 0.82,
      notes: '仅描述可见食物',
    };
    globalThis.fetch = async (url, options = {}) => {
      aiCallCount += 1;
      assert.match(String(url), /vision-ai\.test\/v1\/chat\/completions$/);
      const payload = JSON.parse(options.body);
      assert.ok(payload.messages.some((message) => JSON.stringify(message).includes('不得猜测食堂')));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(observation) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    db = openDatabase(':memory:');
    student = db.prepare("SELECT * FROM users WHERE id = 'u-demo-student'").get();
    admin = db.prepare("SELECT * FROM users WHERE id = 'u-admin'").get();
    capturedAt = new Date().toISOString();
    imageBase64 = Buffer.from('trustworthy-meal-vision-test-image').toString('base64');
    aiCallCount = 0;

    cloneDish('d-chicken-bowl', 'd-vision-not-on-menu', '未发布测试菜');
    const now = new Date().toISOString();
    const date = businessDate(capturedAt);
    db.prepare(`INSERT INTO menus (id, tenant_id, canteen_id, date, meal_type, status, created_at, updated_at)
      VALUES (?, 'default', 'north', ?, 'lunch', 'draft', ?, ?)`)
      .run('menu-vision-draft', date, now, now);
    db.prepare(`INSERT INTO menu_items (
      id, tenant_id, menu_id, dish_id, price, supply_limit, supply_count, sold_out,
      serving_start, serving_end, created_at, updated_at
    ) VALUES (?, 'default', ?, ?, ?, 0, 0, 0, '11:00', '13:30', ?, ?)`).run(
      'menu-item-vision-draft', 'menu-vision-draft', 'd-vision-not-on-menu', 16, now, now,
    );
  });

  after(() => {
    db.close();
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  });

  it('returns observation only without trusted location context and retains only an image hash', async () => {
    const result = await analyzeTrustworthyMeal({ db, user: student, body: mealBody() });

    assert.equal(result.match.status, 'unresolved');
    assert.deepEqual(result.match.candidates, []);
    assert.equal(result.selectedDish, null);
    assert.equal(result.nutrition.status, 'unknown');
    assert.equal(result.nutrition.ranges, null);
    assert.ok(result.warnings.some((item) => item.code === 'VISION_CONTEXT_REQUIRED'));
    assert.equal(result.source.location, 'relational-database');
    assert.equal(result.source.rawImageRetained, false);

    const stored = db.prepare('SELECT * FROM meal_vision_analyses WHERE id = ?').get(result.analysisId);
    assert.match(stored.image_hash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(imageBase64));
    assert.deepEqual(parseJson(stored.context_json, {}).scopeDishIds, []);
  });

  it('rejects invalid canteens and canteen-stall mismatches inside the tenant boundary', async () => {
    const callsBefore = aiCallCount;
    await assert.rejects(
      () => analyzeTrustworthyMeal({ db, user: student, body: mealBody({ canteenId: 'missing-canteen' }) }),
      (error) => error.code === 'VISION_CANTEEN_NOT_FOUND',
    );
    assert.equal(aiCallCount, callsBefore, 'invalid relational context must be rejected before invoking AI');
    await assert.rejects(
      () => selectScopedVisionCandidates(db, 'default', { canteenId: 'missing-canteen', capturedAt, mealType: 'lunch' }),
      (error) => error.code === 'VISION_CANTEEN_NOT_FOUND',
    );
    await assert.rejects(
      () => selectScopedVisionCandidates(db, 'default', { canteenId: 'north', stallId: 's-local', capturedAt, mealType: 'lunch' }),
      (error) => error.code === 'VISION_STALL_CONTEXT_MISMATCH',
    );
    await assert.rejects(
      () => selectScopedVisionCandidates(db, 'tenant-that-does-not-own-north', { canteenId: 'north', capturedAt, mealType: 'lunch' }),
      (error) => error.code === 'VISION_CANTEEN_NOT_FOUND',
    );
  });

  it('isolates candidates to active dishes on the published menu and selected stall scope', async () => {
    const scoped = await selectScopedVisionCandidates(db, 'default', {
      canteenId: 'north',
      stallId: 'n-protein',
      capturedAt,
      mealType: 'lunch',
    });
    const ids = scoped.candidates.map((item) => item.dish.id);

    assert.ok(ids.includes('d-chicken-bowl'));
    assert.ok(ids.includes('d-fish-set'));
    assert.ok(!ids.includes('d-vision-not-on-menu'), 'draft menu items must not enter recognition scope');
    assert.ok(!ids.includes('d-beef-noodle'), 'other stalls must not enter a locked stall scope');
    assert.ok(scoped.menuIds.every((id) => id !== 'menu-vision-draft'));
  });

  it('returns unresolved for no menu, multiple dishes, low quality and unrelated observations', async () => {
    const noMenu = await analyzeTrustworthyMeal({
      db,
      user: student,
      body: mealBody({ canteenId: 'south', stallId: 's-local' }),
    });
    assert.equal(noMenu.match.status, 'unresolved');
    assert.ok(noMenu.warnings.some((item) => item.code === 'NO_ACTIVE_MENU'));

    const baseline = observation;
    try {
      observation = { ...baseline, multipleItems: true, dishCountEstimate: 3 };
      const multiple = await analyzeTrustworthyMeal({ db, user: student, body: mealBody({ canteenId: 'north' }) });
      assert.equal(multiple.match.status, 'unresolved');
      assert.ok(multiple.warnings.some((item) => item.code === 'MULTIPLE_DISHES_UNSUPPORTED'));

      observation = { ...baseline, quality: { usable: false, issueCodes: ['TOO_DARK'] } };
      const lowQuality = await analyzeTrustworthyMeal({ db, user: student, body: mealBody({ canteenId: 'north' }) });
      assert.equal(lowQuality.match.status, 'unresolved');
      assert.ok(lowQuality.warnings.some((item) => item.code === 'IMAGE_QUALITY_TOO_LOW'));

      observation = {
        ...baseline,
        genericNames: ['完全未知料理'],
        visibleIngredients: ['不可识别食材'],
        cookingMethods: [],
        confidence: 0.2,
      };
      const unrelated = await analyzeTrustworthyMeal({ db, user: student, body: mealBody({ canteenId: 'north' }) });
      assert.equal(unrelated.match.status, 'unresolved');
      assert.deepEqual(unrelated.match.candidates, []);
    } finally {
      observation = baseline;
    }
  });

  it('requires confirmation, rejects cross-scope corrections, and never invents nutrition defaults', async () => {
    db.prepare(`UPDATE dishes SET nutrition_fact_status = 'unknown', recipe_fact_status = 'unknown',
      calories = 500, protein = 20, fat = 12, carbs = 60, fact_source = 'legacy'
      WHERE tenant_id = 'default' AND id = 'd-chicken-bowl'`).run();
    db.prepare("DELETE FROM dish_nutrition_versions WHERE tenant_id = 'default' AND dish_id = 'd-chicken-bowl'").run();

    const analysis = await analyzeTrustworthyMeal({
      db,
      user: student,
      body: mealBody({ canteenId: 'north', stallId: 'n-protein' }),
    });
    assert.equal(analysis.match.status, 'needs_confirmation');
    assert.equal(analysis.selectedDish, null);
    assert.equal(analysis.nutrition.status, 'unknown');
    assert.equal(analysis.nutrition.ranges, null);
    assert.equal(analysis.match.candidates[0].dishId, 'd-chicken-bowl');

    await assert.rejects(
      () => confirmMealVisionAnalysis({ db, user: student, analysisId: analysis.analysisId, body: { dishId: 'd-tofu' } }),
      (error) => error.code === 'VISION_CONFIRMATION_OUT_OF_SCOPE',
    );

    const confirmed = await confirmMealVisionAnalysis({
      db,
      user: student,
      analysisId: analysis.analysisId,
      body: { dishId: 'd-chicken-bowl', portion: { size: 'regular' } },
    });
    assert.equal(confirmed.selectedDish.id, 'd-chicken-bowl');
    assert.equal(confirmed.nutrition.status, 'unknown');
    assert.equal(confirmed.nutrition.ranges, null);
    assert.doesNotMatch(JSON.stringify(confirmed.nutrition), /500|20|12|60/);
  });

  it('does not allow a dish added to the menu after analysis to enter the original confirmation scope', async () => {
    const analysis = await analyzeTrustworthyMeal({
      db,
      user: student,
      body: mealBody({ canteenId: 'north', stallId: 'n-protein' }),
    });
    const publishedMenuId = analysis.source.menuIds[0];
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO menu_items (
      id, tenant_id, menu_id, dish_id, price, supply_limit, supply_count, sold_out,
      serving_start, serving_end, created_at, updated_at
    ) VALUES (?, 'default', ?, ?, ?, 0, 0, 0, '11:00', '13:30', ?, ?)`).run(
      'menu-item-vision-added-later', publishedMenuId, 'd-vision-not-on-menu', 16, now, now,
    );

    await assert.rejects(
      () => confirmMealVisionAnalysis({ db, user: student, analysisId: analysis.analysisId, body: { dishId: 'd-vision-not-on-menu' } }),
      (error) => error.code === 'VISION_CONFIRMATION_OUT_OF_SCOPE',
    );
  });

  it('keeps held-out evaluation images out of the embedding index', async () => {
    const now = new Date().toISOString();
    for (const [id, filename] of [['upload-vision-reference', 'reference.png'], ['upload-vision-evaluation', 'evaluation.png']]) {
      db.prepare(`INSERT INTO uploads (
        id, tenant_id, owner_id, filename, content_type, size_bytes, storage_key,
        public_url, visibility, storage_provider, object_version, created_at
      ) VALUES (?, 'default', ?, ?, 'image/png', 4, ?, ?, 'private', 'local', 'v1', ?)`).run(
        id, admin.id, filename, `vision-tests/${filename}`, `upload://${id}`, now,
      );
    }

    const reference = await addDishReferenceImage({
      db,
      user: admin,
      dishId: 'd-fish-set',
      body: { uploadId: 'upload-vision-reference', purpose: 'reference', qualityStatus: 'approved' },
    });
    const evaluation = await addDishReferenceImage({
      db,
      user: admin,
      dishId: 'd-fish-set',
      body: { uploadId: 'upload-vision-evaluation', purpose: 'evaluation', qualityStatus: 'approved' },
    });

    assert.ok(db.prepare('SELECT 1 FROM dish_image_embeddings WHERE reference_image_id = ?').get(reference.id));
    assert.equal(db.prepare('SELECT 1 FROM dish_image_embeddings WHERE reference_image_id = ?').get(evaluation.id), undefined);

    await updateDishReferenceImage({ db, user: admin, referenceImageId: reference.id, body: { purpose: 'evaluation' } });
    assert.equal(db.prepare('SELECT 1 FROM dish_image_embeddings WHERE reference_image_id = ?').get(reference.id), undefined);
    await updateDishReferenceImage({ db, user: admin, referenceImageId: evaluation.id, body: { purpose: 'reference' } });
    assert.ok(db.prepare('SELECT 1 FROM dish_image_embeddings WHERE reference_image_id = ?').get(evaluation.id));
  });

  it('calculates approved recipe nutrition from governed references with source ids and ranges', async () => {
    const ingredients = [
      { foodReferenceId: 'reference-cooked-white-rice', rawWeightGrams: 150 },
      { foodReferenceId: 'reference-roasted-chicken-breast', rawWeightGrams: 100 },
    ];
    const calculation = calculateRecipeNutrition({ ingredients, servingWeightGrams: 250, yieldWeightGrams: 250 });
    assert.ok(calculation.points.calories > 300);
    assert.ok(calculation.points.protein > 30);
    assert.ok(calculation.ranges.calories.min < calculation.ranges.calories.max);
    assert.ok(calculation.sourceIds.includes('reference-cooked-white-rice'));
    assert.ok(calculation.sourceIds.includes('usda-fdc'));

    const saved = await createDishRecipeVersion({
      db,
      user: admin,
      dishId: 'd-chicken-bowl',
      body: { version: 'vision-recipe-v1', ingredients, servingWeightGrams: 250, yieldWeightGrams: 250, approve: true },
    });
    assert.equal(saved.status, 'approved');
    const nutrition = db.prepare('SELECT * FROM dish_nutrition_versions WHERE id = ?').get(saved.nutritionId);
    assert.equal(nutrition.status, 'estimated');
    assert.ok(parseJson(nutrition.source_ids_json, []).includes('reference-roasted-chicken-breast'));
    assert.ok(parseJson(nutrition.nutrient_ranges_json, {}).protein.min > 0);
  });

  it('aggregates candidate coverage, P95 and user correction confusion without image data', async () => {
    const analysis = await analyzeTrustworthyMeal({
      db,
      user: student,
      body: mealBody({ canteenId: 'north', stallId: 'n-protein' }),
    });
    const corrected = await confirmMealVisionAnalysis({
      db,
      user: student,
      analysisId: analysis.analysisId,
      body: { dishId: 'd-fish-set' },
    });
    assert.equal(corrected.feedbackType, 'corrected');

    const metrics = await getMealVisionMetrics(db, 'default', { days: 30 });
    assert.ok(metrics.analysisCount >= 1);
    assert.ok(metrics.candidateCoverageRate >= 0 && metrics.candidateCoverageRate <= 1);
    assert.ok(metrics.latency.p95Ms >= 0);
    assert.equal(metrics.latency.targetMs, 8000);
    assert.ok(metrics.userCorrectionRate > 0);
    assert.ok(metrics.confusionMatrix.some((item) => item.predictedDishId === 'd-chicken-bowl' && item.confirmedDishId === 'd-fish-set'));
    assert.doesNotMatch(JSON.stringify(metrics), /dataBase64|rawImage/);
  });

  it('rejects empty image data before any analysis is stored', async () => {
    const beforeCount = db.prepare('SELECT COUNT(*) AS count FROM meal_vision_analyses').get().count;
    await assert.rejects(
      () => analyzeTrustworthyMeal({ db, user: student, body: { ...mealBody(), dataBase64: '' } }),
      (error) => error.status === 400,
    );
    const afterCount = db.prepare('SELECT COUNT(*) AS count FROM meal_vision_analyses').get().count;
    assert.equal(afterCount, beforeCount);
  });
});
