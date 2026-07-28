import { loadFoodCompositionReferences } from './healthKnowledgeBase.js';

const NUTRIENTS = {
  calories: 'caloriesKcal',
  protein: 'proteinG',
  fat: 'fatG',
  carbs: 'carbsG',
  fiber: 'fiberG',
  sodium: 'sodiumMg',
};

let referenceById;

function references() {
  if (!referenceById) referenceById = new Map(loadFoodCompositionReferences().map((item) => [item.id, item]));
  return referenceById;
}

function positiveNumber(value, label, { required = true, max = 100_000 } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw Object.assign(new Error(`${label}必须是有效正数`), { status: 400, code: 'INVALID_RECIPE_VALUE' });
  }
  return number;
}

function ratio(value, fallback, label, max = 1) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw Object.assign(new Error(`${label}超出有效范围`), { status: 400, code: 'INVALID_RECIPE_RATIO' });
  }
  return number;
}

function rounded(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function nutrientRangesFromPoints(points, uncertainty = 0.1) {
  return Object.fromEntries(Object.entries(points).map(([key, value]) => {
    const number = Math.max(0, Number(value || 0));
    return [key, { min: rounded(number * (1 - uncertainty)), max: rounded(number * (1 + uncertainty)), unit: key === 'calories' ? 'kcal' : key === 'sodium' ? 'mg' : 'g' }];
  }));
}

export function calculateRecipeNutrition({ ingredients, servingWeightGrams, yieldWeightGrams, basis = 'per_serving' } = {}) {
  if (!Array.isArray(ingredients) || !ingredients.length) {
    throw Object.assign(new Error('配方至少需要一种食材'), { status: 400, code: 'RECIPE_INGREDIENTS_REQUIRED' });
  }
  if (!['per_serving', 'per_100g'].includes(basis)) {
    throw Object.assign(new Error('营养口径必须是 per_serving 或 per_100g'), { status: 400, code: 'INVALID_NUTRITION_BASIS' });
  }

  const normalizedIngredients = ingredients.map((item, index) => {
    const foodReferenceId = String(item.foodReferenceId || '').trim();
    const reference = references().get(foodReferenceId);
    if (!reference) throw Object.assign(new Error(`第 ${index + 1} 个食材未关联有效食物成分参考`), { status: 400, code: 'FOOD_REFERENCE_NOT_FOUND' });
    return {
      foodReferenceId,
      ingredientName: String(item.ingredientName || reference.canonicalName).trim().slice(0, 120),
      rawWeightGrams: positiveNumber(item.rawWeightGrams, `第 ${index + 1} 个食材重量`),
      edibleRatio: ratio(item.edibleRatio, 1, '可食比例'),
      retentionFactor: ratio(item.retentionFactor, 1, '营养保留系数', 1.5),
      reference,
    };
  });

  const edibleWeight = normalizedIngredients.reduce((sum, item) => sum + item.rawWeightGrams * item.edibleRatio, 0);
  const yieldGrams = positiveNumber(yieldWeightGrams, '成品总重量', { required: false }) || edibleWeight;
  const portionGrams = basis === 'per_100g'
    ? 100
    : (positiveNumber(servingWeightGrams, '单份重量', { required: false }) || yieldGrams);
  if (portionGrams > yieldGrams * 1.5) {
    throw Object.assign(new Error('单份重量不能明显大于整份成品重量'), { status: 400, code: 'INVALID_RECIPE_PORTION' });
  }

  const totals = Object.fromEntries(Object.keys(NUTRIENTS).map((key) => [key, 0]));
  for (const item of normalizedIngredients) {
    const factor = (item.rawWeightGrams * item.edibleRatio * item.retentionFactor) / Number(item.reference.basisGrams || 100);
    for (const [target, source] of Object.entries(NUTRIENTS)) {
      totals[target] += Number(item.reference.nutrients?.[source] || 0) * factor;
    }
  }
  const servingFactor = Math.min(1.5, portionGrams / yieldGrams);
  const points = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, rounded(value * servingFactor)]));
  const sourceIds = [...new Set(normalizedIngredients.flatMap((item) => [item.foodReferenceId, ...(item.reference.sourceIds || [])]))];
  return {
    basis,
    portionGrams: rounded(portionGrams),
    yieldWeightGrams: rounded(yieldGrams),
    points,
    ranges: nutrientRangesFromPoints(points, 0.1),
    sourceIds,
    ingredients: normalizedIngredients.map(({ reference, ...item }) => item),
  };
}
export function unknownNutrition(reason = '菜品尚无已审核营养资料') {
  return {
    status: 'unknown',
    basis: null,
    portionGrams: null,
    ranges: null,
    sourceType: null,
    sourceIds: [],
    reason,
  };
}

export function scaleNutritionRanges(nutrition, portion = {}) {
  if (!nutrition || nutrition.status === 'unknown' || !nutrition.ranges) return nutrition || unknownNutrition();
  const sizeFactor = { small: 0.75, regular: 1, large: 1.25 }[portion.size] || 1;
  const gramFactor = Number(portion.grams) > 0 && Number(nutrition.portionGrams) > 0
    ? Number(portion.grams) / Number(nutrition.portionGrams)
    : sizeFactor;
  return {
    ...nutrition,
    portionGrams: Number(portion.grams) > 0 ? Number(portion.grams) : nutrition.portionGrams ? rounded(nutrition.portionGrams * sizeFactor) : null,
    ranges: Object.fromEntries(Object.entries(nutrition.ranges).map(([key, range]) => [key, {
      ...range,
      min: rounded(Number(range.min || 0) * gramFactor),
      max: rounded(Number(range.max || 0) * gramFactor),
    }])),
  };
}
