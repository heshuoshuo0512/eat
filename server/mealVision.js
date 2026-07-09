import { buildMealPlan, normalizeProfile } from '../src/domain/recommendation.js';

function textSet(value) {
  return new Set((Array.isArray(value) ? value : String(value || '').split(/[，,、\s]+/)).map((item) => String(item || '').trim()).filter(Boolean));
}

function overlap(left, right) {
  const rightSet = textSet(right);
  return [...textSet(left)].filter((item) => rightSet.has(item) || [...rightSet].some((candidate) => candidate.includes(item) || item.includes(candidate)));
}

function nutritionDistance(a = {}, b = {}) {
  const calories = Math.abs(Number(a.calories || 0) - Number(b.calories || 0)) / 700;
  const protein = Math.abs(Number(a.protein || 0) - Number(b.protein || 0)) / 60;
  const fat = Math.abs(Number(a.fat || 0) - Number(b.fat || 0)) / 50;
  const carbs = Math.abs(Number(a.carbs || 0) - Number(b.carbs || 0)) / 120;
  return Math.min(1, (calories + protein + fat + carbs) / 4);
}

function mealTypeLabel(mealType) {
  if (mealType === 'breakfast') return '早餐';
  if (mealType === 'dinner') return '晚餐';
  return '午餐';
}

function locationFor(dish, stalls = [], canteens = []) {
  const stall = stalls.find((item) => item.id === dish.stallId) || null;
  const canteen = stall ? canteens.find((item) => item.id === stall.canteenId) || null : null;
  return { stall, canteen };
}

function publicDish(dish, stalls, canteens, extra = {}) {
  const { stall, canteen } = locationFor(dish, stalls, canteens);
  return {
    id: dish.id,
    name: dish.name,
    price: dish.price,
    taste: dish.taste,
    cuisine: dish.cuisine,
    tags: dish.tags,
    ingredients: dish.ingredients,
    nutrition: dish.nutrition,
    halal: dish.halal,
    image: dish.image,
    imageUrl: dish.imageUrl,
    rating: dish.rating,
    canteen: canteen ? { id: canteen.id, name: canteen.name, location: canteen.location } : null,
    stall: stall ? { id: stall.id, name: stall.name, floor: stall.floor, category: stall.category } : null,
    ...extra
  };
}

export function assessPhotoMeal(suggestion = {}, profile = {}) {
  const normalized = normalizeProfile(profile);
  const nutrition = suggestion.nutrition || {};
  const calories = Number(nutrition.calories || 0);
  const protein = Number(nutrition.protein || 0);
  const fat = Number(nutrition.fat || 0);
  const carbs = Number(nutrition.carbs || 0);
  const positives = [];
  const cautions = [];
  let score = 72;

  if (protein >= 30) { positives.push('蛋白质较充足，饱腹感和训练恢复更友好。'); score += 8; }
  else if (normalized.goal === 'muscleGain') { cautions.push('蛋白质可能偏低，增肌目标建议搭配高蛋白菜品。'); score -= 8; }

  if (normalized.goal === 'fatLoss' && calories > 650) { cautions.push('热量偏高，减脂期建议控制主食和油脂份量。'); score -= 12; }
  if (normalized.goal === 'fatLoss' && fat > 24) { cautions.push('脂肪偏高，建议优先选择少油做法或搭配蔬菜。'); score -= 8; }
  if (normalized.goal === 'muscleGain' && carbs >= 70) { positives.push('碳水较充足，适合训练后补充能量。'); score += 5; }
  if (normalized.goal === 'healthy' && calories >= 380 && calories <= 650 && fat <= 22) { positives.push('热量和脂肪处于较均衡区间。'); score += 6; }
  if (carbs > 105) { cautions.push('碳水较高，血糖敏感或久坐场景建议减少主食。'); score -= 5; }
  if (suggestion.confidence < 0.55) { cautions.push('图片识别置信度较低，请结合窗口菜名或手动搜索确认。'); score -= 10; }
  if (!positives.length) positives.push('已完成营养估算，可作为点餐前参考。');
  if (!cautions.length) cautions.push('未发现明显风险，但图片估算不能替代实际营养标识。');

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const level = boundedScore >= 80 ? '适合' : boundedScore >= 60 ? '可选' : '谨慎';
  return {
    score: boundedScore,
    level,
    mealType: normalized.mealType,
    summary: `${level}${mealTypeLabel(normalized.mealType)}场景：按你的${normalized.goal === 'fatLoss' ? '减脂' : normalized.goal === 'muscleGain' ? '增肌' : normalized.goal === 'maintain' ? '维持体重' : '健康饮食'}目标给出参考。`,
    positives,
    cautions
  };
}

export function matchDishesFromSuggestion(suggestion = {}, dishes = [], stalls = [], canteens = [], limit = 5) {
  const name = String(suggestion.name || '').trim();
  const ingredients = suggestion.ingredients || [];
  const tags = suggestion.tags || [];
  const nutrition = suggestion.nutrition || {};
  return dishes
    .map((dish) => {
      let rawScore = 0;
      const reasons = [];
      if (name && dish.name === name) { rawScore += 45; reasons.push('菜名完全一致'); }
      else if (name && (dish.name.includes(name) || name.includes(dish.name))) { rawScore += 32; reasons.push('菜名高度相似'); }

      const ingredientHits = overlap(ingredients, dish.ingredients);
      if (ingredientHits.length) { rawScore += Math.min(28, ingredientHits.length * 9); reasons.push(`食材重合：${ingredientHits.join('、')}`); }

      const tagHits = overlap(tags, dish.tags);
      if (tagHits.length) { rawScore += Math.min(16, tagHits.length * 6); reasons.push(`标签相近：${tagHits.join('、')}`); }

      if (suggestion.taste && (dish.taste === suggestion.taste || dish.tags.includes(suggestion.taste))) { rawScore += 8; reasons.push('口味匹配'); }
      if (suggestion.cuisine && (dish.cuisine === suggestion.cuisine || dish.tags.includes(suggestion.cuisine))) { rawScore += 6; reasons.push('菜系匹配'); }

      const distance = nutritionDistance(nutrition, dish.nutrition);
      if (distance < 0.35) { rawScore += Math.round((0.35 - distance) * 32); reasons.push('营养结构接近'); }

      return { dish, score: Number(Math.min(1, rawScore / 100).toFixed(2)), reasons };
    })
    .filter((item) => item.score >= 0.18)
    .sort((left, right) => right.score - left.score || right.dish.rating - left.dish.rating)
    .slice(0, limit)
    .map((item) => ({ ...publicDish(item.dish, stalls, canteens), matchScore: item.score, matchReasons: item.reasons }));
}

export function buildStudentMealAnalysis({ suggestion, dishes = [], stalls = [], canteens = [], profile = {}, menuSource = 'fallback' }) {
  const normalizedProfile = normalizeProfile(profile);
  const assessment = assessPhotoMeal(suggestion, normalizedProfile);
  const matches = matchDishesFromSuggestion(suggestion, dishes, stalls, canteens, 5);
  const candidatePool = matches.length ? matches.map((match) => dishes.find((dish) => dish.id === match.id)).filter(Boolean) : dishes;
  const plan = buildMealPlan(candidatePool, normalizedProfile);
  const picks = plan.dishes.map((dish) => publicDish(dish, stalls, canteens, { recommendationScore: dish.recommendationScore }));
  return {
    suggestion,
    assessment,
    matches,
    plan: { ...plan, dishes: picks, picks },
    guidance: matches.length
      ? '已把图片识别结果和校内真实菜品库做匹配，优先展示可直接购买的相似菜品。'
      : '图片识别结果未匹配到现有菜品，已按你的健康档案从真实菜品库生成替代推荐。',
    source: {
      vision: 'ai-provider',
      grounding: matches.length ? 'dish-match' : 'profile-recommendation',
      databaseOnlyRecommendations: true,
      menuSource
    }
  };
}
