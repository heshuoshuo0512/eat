import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessPhotoMeal, matchDishesFromSuggestion, buildStudentMealAnalysis } from '../server/mealVision.js';
import { dishes as seedDishes, stalls as seedStalls, canteens as seedCanteens } from '../src/domain/seedData.js';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const chickenBowl = seedDishes.find((d) => d.id === 'd-chicken-bowl');
const eggTomato = seedDishes.find((d) => d.id === 'd-egg-tomato');
const bulkMeal = seedDishes.find((d) => d.id === 'd-bulk');

/* ================================================================== */
/*  1. assessPhotoMeal — nutrition scoring and cautions                */
/* ================================================================== */
describe('assessPhotoMeal', () => {
  it('high-protein healthy suggestion scores 适合 with positives', () => {
    const result = assessPhotoMeal(
      { nutrition: { calories: 480, protein: 35, fat: 12, carbs: 50 }, confidence: 0.85 },
      { goal: 'healthy' },
    );
    assert.ok(result.score >= 80, 'score >= 80 for healthy high-protein meal');
    assert.equal(result.level, '适合');
    assert.ok(result.positives.length > 0, 'has positives');
    assert.ok(result.positives.some((p) => p.includes('蛋白质')), 'mentions protein');
  });

  it('low-confidence suggestion triggers caution and lowers score', () => {
    const highConf = assessPhotoMeal(
      { nutrition: { calories: 500, protein: 25, fat: 15, carbs: 60 }, confidence: 0.8 },
      { goal: 'healthy' },
    );
    const lowConf = assessPhotoMeal(
      { nutrition: { calories: 500, protein: 25, fat: 15, carbs: 60 }, confidence: 0.4 },
      { goal: 'healthy' },
    );
    assert.ok(lowConf.score < highConf.score, 'low confidence lowers score');
    assert.ok(
      lowConf.cautions.some((c) => c.includes('置信度')),
      'low confidence caution present',
    );
  });

  it('fatLoss profile with high-calorie high-fat meal yields cautions', () => {
    const result = assessPhotoMeal(
      { nutrition: { calories: 780, protein: 28, fat: 30, carbs: 90 }, confidence: 0.7 },
      { goal: 'fatLoss' },
    );
    assert.ok(result.cautions.some((c) => c.includes('热量')), 'calorie caution');
    assert.ok(result.cautions.some((c) => c.includes('脂肪')), 'fat caution');
    assert.ok(result.score < 72, 'score drops below base');
  });

  it('muscleGain profile with low protein triggers caution', () => {
    const result = assessPhotoMeal(
      { nutrition: { calories: 550, protein: 15, fat: 18, carbs: 70 }, confidence: 0.75 },
      { goal: 'muscleGain' },
    );
    assert.ok(
      result.cautions.some((c) => c.includes('蛋白质') && c.includes('偏低')),
      'protein low caution for muscleGain',
    );
    assert.ok(result.score < 72, 'score drops');
  });

  it('high carbs (>105) triggers carb caution', () => {
    const result = assessPhotoMeal(
      { nutrition: { calories: 700, protein: 32, fat: 16, carbs: 120 }, confidence: 0.8 },
      { goal: 'healthy' },
    );
    assert.ok(
      result.cautions.some((c) => c.includes('碳水')),
      'carb caution present',
    );
  });

  it('score is bounded between 0 and 100', () => {
    // Worst case: low confidence, fatLoss, high cal, high fat, low protein, high carbs
    const worst = assessPhotoMeal(
      { nutrition: { calories: 1200, protein: 5, fat: 60, carbs: 150 }, confidence: 0.1 },
      { goal: 'fatLoss' },
    );
    assert.ok(worst.score >= 0 && worst.score <= 100, 'score bounded [0, 100]');

    // Best case: high protein, healthy balanced
    const best = assessPhotoMeal(
      { nutrition: { calories: 500, protein: 40, fat: 15, carbs: 55 }, confidence: 0.95 },
      { goal: 'healthy' },
    );
    assert.ok(best.score >= 0 && best.score <= 100, 'score bounded [0, 100]');
  });

  it('empty suggestion defaults to base assessment', () => {
    const result = assessPhotoMeal({}, {});
    assert.equal(typeof result.score, 'number');
    assert.ok(['适合', '可选', '谨慎'].includes(result.level));
    assert.ok(Array.isArray(result.positives));
    assert.ok(Array.isArray(result.cautions));
  });
});

/* ================================================================== */
/*  2. matchDishesFromSuggestion — grounded dish matching              */
/* ================================================================== */
describe('matchDishesFromSuggestion', () => {
  it('exact name match returns high-scoring hit with match reason', () => {
    const matches = matchDishesFromSuggestion(
      { name: '番茄鸡蛋盖饭', ingredients: ['番茄', '鸡蛋', '米饭'], tags: ['快餐'], nutrition: { calories: 560, protein: 20, fat: 17, carbs: 80 } },
      seedDishes, seedStalls, seedCanteens,
    );
    assert.ok(matches.length > 0, 'has matches');
    const top = matches[0];
    assert.equal(top.id, 'd-egg-tomato', 'top match is the seeded dish');
    assert.ok(top.matchScore > 0.4, 'match score is high for exact name');
    assert.ok(top.matchReasons.some((r) => r.includes('菜名完全一致')), 'reason mentions name match');
  });

  it('ingredient overlap produces matching results', () => {
    const matches = matchDishesFromSuggestion(
      { name: '鸡胸饭', ingredients: ['鸡胸肉', '糙米'], tags: ['高蛋白'], nutrition: { calories: 450, protein: 36, fat: 10, carbs: 55 } },
      seedDishes, seedStalls, seedCanteens,
    );
    assert.ok(matches.length > 0, 'has matches from ingredient overlap');
    const ids = matches.map((m) => m.id);
    assert.ok(ids.includes('d-chicken-bowl'), 'chicken bowl matches via ingredients');
    assert.ok(
      matches.find((m) => m.id === 'd-chicken-bowl').matchReasons.some((r) => r.includes('食材重合')),
      'match reason mentions ingredient overlap',
    );
  });

  it('matched dishes include location (canteen + stall) info', () => {
    const matches = matchDishesFromSuggestion(
      { name: '番茄鸡蛋盖饭', ingredients: ['番茄', '鸡蛋'], tags: [], nutrition: {} },
      seedDishes, seedStalls, seedCanteens,
    );
    const top = matches[0];
    assert.ok(top.stall, 'matched dish has stall');
    assert.ok(top.stall.name, 'stall has name');
    assert.ok(top.canteen, 'matched dish has canteen');
    assert.ok(top.canteen.name, 'canteen has name');
  });

  it('results are sorted by descending score', () => {
    const matches = matchDishesFromSuggestion(
      { name: '鸡', ingredients: ['鸡肉', '鸡蛋'], tags: ['高蛋白'], nutrition: { calories: 500, protein: 30, fat: 15, carbs: 60 } },
      seedDishes, seedStalls, seedCanteens,
    );
    for (let i = 1; i < matches.length; i++) {
      assert.ok(matches[i - 1].matchScore >= matches[i].matchScore, 'scores are descending');
    }
  });

  it('completely unrelated suggestion returns empty or very few results', () => {
    const matches = matchDishesFromSuggestion(
      { name: 'xyz不存在的菜', ingredients: ['外星食材'], tags: ['外星'], nutrition: { calories: 999, protein: 99, fat: 99, carbs: 99 } },
      seedDishes, seedStalls, seedCanteens,
    );
    assert.ok(matches.length <= 1, 'unrelated suggestion yields zero or near-zero matches');
  });

  it('respects limit parameter', () => {
    const matches = matchDishesFromSuggestion(
      { name: '饭', ingredients: ['米饭', '鸡蛋', '鸡肉'], tags: ['高蛋白'], nutrition: { calories: 500, protein: 25, fat: 15, carbs: 60 } },
      seedDishes, seedStalls, seedCanteens, 2,
    );
    assert.ok(matches.length <= 2, 'respects limit of 2');
  });
});

/* ================================================================== */
/*  3. buildStudentMealAnalysis — integrated analysis                  */
/* ================================================================== */
describe('buildStudentMealAnalysis', () => {
  it('matched suggestion produces dish-match grounding with real picks', () => {
    const result = buildStudentMealAnalysis({
      suggestion: { name: '番茄鸡蛋盖饭', ingredients: ['番茄', '鸡蛋', '米饭'], tags: ['快餐'], nutrition: { calories: 560, protein: 20, fat: 17, carbs: 80 }, confidence: 0.85 },
      dishes: seedDishes,
      stalls: seedStalls,
      canteens: seedCanteens,
      profile: { goal: 'fatLoss' },
    });
    assert.equal(result.source.grounding, 'dish-match');
    assert.ok(result.matches.length > 0, 'has matches');
    assert.ok(result.guidance.includes('匹配'), 'guidance mentions matching');
    assert.ok(result.plan, 'has plan');
    assert.ok(Array.isArray(result.plan.picks), 'plan has picks');
    assert.ok(result.plan.picks.length > 0, 'plan has real picks');
    assert.equal(result.source.databaseOnlyRecommendations, true, 'flagged as DB-only');
  });

  it('unmatched suggestion produces profile-recommendation grounding', () => {
    const result = buildStudentMealAnalysis({
      suggestion: { name: '外星料理', ingredients: ['不存在'], tags: [], nutrition: { calories: 999, protein: 1, fat: 99, carbs: 99 }, confidence: 0.3 },
      dishes: seedDishes,
      stalls: seedStalls,
      canteens: seedCanteens,
      profile: { goal: 'healthy' },
    });
    assert.equal(result.source.grounding, 'profile-recommendation');
    assert.equal(result.matches.length, 0, 'no matches');
    assert.ok(result.guidance.includes('未匹配'), 'guidance notes no match');
    assert.ok(result.plan.picks.length > 0, 'still has fallback picks from full dish list');
  });

  it('plan picks have required dish fields including location', () => {
    const result = buildStudentMealAnalysis({
      suggestion: { name: '鸡胸肉饭', ingredients: ['鸡胸肉'], tags: ['高蛋白'], nutrition: { calories: 450, protein: 35, fat: 10, carbs: 50 }, confidence: 0.8 },
      dishes: seedDishes,
      stalls: seedStalls,
      canteens: seedCanteens,
      profile: { goal: 'muscleGain' },
    });
    for (const pick of result.plan.picks) {
      assert.ok(pick.id, 'pick has id');
      assert.ok(pick.name, 'pick has name');
      assert.ok(typeof pick.price === 'number', 'pick has numeric price');
      assert.ok(pick.nutrition, 'pick has nutrition');
      assert.ok(typeof pick.nutrition.calories === 'number', 'nutrition has calories');
    }
  });

  it('assessment is included and reflects the suggestion nutrition', () => {
    const result = buildStudentMealAnalysis({
      suggestion: { name: '测试', ingredients: [], tags: [], nutrition: { calories: 800, protein: 15, fat: 30, carbs: 100 }, confidence: 0.6 },
      dishes: seedDishes,
      stalls: seedStalls,
      canteens: seedCanteens,
      profile: { goal: 'fatLoss' },
    });
    assert.ok(result.assessment, 'has assessment');
    assert.ok(typeof result.assessment.score === 'number', 'assessment has score');
    assert.ok(['适合', '可选', '谨慎'].includes(result.assessment.level), 'assessment has valid level');
    assert.ok(result.assessment.cautions.length > 0, 'high cal fatLoss has cautions');
  });

  it('suggestion passthrough preserves original input', () => {
    const suggestion = { name: '测试菜', ingredients: ['豆腐'], tags: ['素食'], nutrition: { calories: 400, protein: 18, fat: 12, carbs: 50 }, confidence: 0.7 };
    const result = buildStudentMealAnalysis({
      suggestion,
      dishes: seedDishes,
      stalls: seedStalls,
      canteens: seedCanteens,
      profile: {},
    });
    assert.deepEqual(result.suggestion, suggestion, 'original suggestion is preserved');
  });
});
