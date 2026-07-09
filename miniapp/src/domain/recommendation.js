const goalProfiles = {
  fatLoss: {
    label: '减脂',
    score(dish) {
      return dish.nutrition.protein * 2.2 - dish.nutrition.calories * 0.035 - dish.nutrition.fat * 1.4;
    },
    reason: '优先低热量、高蛋白、低脂菜品，帮助控制总热量同时保留饱腹感。'
  },
  muscleGain: {
    label: '增肌',
    score(dish) {
      return dish.nutrition.protein * 2.5 + dish.nutrition.carbs * 0.35 + dish.nutrition.calories * 0.018;
    },
    reason: '优先高蛋白和适量碳水，适合训练后恢复和肌肉合成。'
  },
  maintain: {
    label: '维持体重',
    score(dish) {
      const balancePenalty = Math.abs(dish.nutrition.calories - 520) * 0.04 + Math.abs(dish.nutrition.fat - 16) * 0.7;
      return dish.nutrition.protein * 1.4 - balancePenalty;
    },
    reason: '优先热量适中、蛋白充足、脂肪不过高的均衡餐。'
  },
  healthy: {
    label: '健康饮食',
    score(dish) {
      const variety = new Set([...dish.ingredients, ...dish.tags]).size;
      return variety * 3 + dish.nutrition.protein * 1.1 - dish.nutrition.fat * 0.8;
    },
    reason: '优先食材多样、营养结构均衡且油脂负担较低的餐品。'
  }
};

export function normalizeProfile(profile = {}) {
  return {
    goal: profile.goal || 'healthy',
    budgetMax: Number(profile.budgetMax || 20),
    mealType: profile.mealType || 'lunch',
    taste: profile.taste || '不限',
    halalOnly: Boolean(profile.halalOnly),
    avoid: Array.isArray(profile.avoid) ? profile.avoid.filter(Boolean) : String(profile.avoid || '').split(/[，,\s]+/).filter(Boolean)
  };
}

export function filterDishes(dishes, profile) {
  const normalized = normalizeProfile(profile);
  return dishes.filter((dish) => {
    if (dish.price > normalized.budgetMax) return false;
    if (normalized.halalOnly && !dish.halal) return false;
    if (!dish.mealTypes.includes(normalized.mealType)) return false;
    if (normalized.taste !== '不限' && dish.taste !== normalized.taste && !dish.tags.includes(normalized.taste)) return false;
    if (normalized.avoid.some((word) => dish.ingredients.some((item) => item.includes(word)))) return false;
    return true;
  });
}

export function rankDishes(dishes, profile) {
  const normalized = normalizeProfile(profile);
  const goal = goalProfiles[normalized.goal] || goalProfiles.healthy;
  return filterDishes(dishes, normalized)
    .map((dish) => {
      const ratingScore = dish.rating * 8 + Math.log10(dish.reviewCount + 1) * 6;
      const budgetScore = Math.max(0, normalized.budgetMax - dish.price) * 0.8;
      const score = goal.score(dish) + ratingScore + budgetScore;
      return { ...dish, recommendationScore: Number(score.toFixed(1)) };
    })
    .sort((left, right) => right.recommendationScore - left.recommendationScore || right.rating - left.rating);
}

export function supplyStatusLabel(dish) {
  const item = dish.menuItem;
  if (!item) return '';
  if (item.soldOut) return '已售罄';
  if (item.supplyLimit > 0 && item.supplyRemaining !== undefined) return `剩余 ${item.supplyRemaining} 份`;
  if (item.supplyLimit > 0) return `限量 ${item.supplyLimit} 份`;
  return '供应中';
}

export function availableDishes(dishes) {
  return dishes.filter((dish) => !dish.menuItem?.soldOut);
}

export function buildMealPlan(dishes, profile) {
  const normalized = normalizeProfile(profile);
  const pool = availableDishes(dishes);
  const ranked = rankDishes(pool, normalized);
  const fallback = rankDishes(pool, { ...normalized, taste: '不限', halalOnly: normalized.halalOnly });
  const picks = (ranked.length ? ranked : fallback).slice(0, 3);
  const totals = picks.reduce(
    (sum, dish) => ({
      calories: sum.calories + dish.nutrition.calories,
      protein: sum.protein + dish.nutrition.protein,
      fat: sum.fat + dish.nutrition.fat,
      carbs: sum.carbs + dish.nutrition.carbs,
      price: sum.price + dish.price
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0, price: 0 }
  );
  const goal = goalProfiles[normalized.goal] || goalProfiles.healthy;
  return {
    goalLabel: goal.label,
    reason: picks.length
      ? `${goal.reason} 本次只从真实档口菜品中筛选，预算上限 ${normalized.budgetMax} 元，已匹配 ${normalized.mealType === 'breakfast' ? '早餐' : normalized.mealType === 'dinner' ? '晚餐' : '午餐'} 场景。`
      : '当前条件没有匹配菜品，请放宽预算、口味或清真限制。',
    dishes: picks,
    totals
  };
}

export function calculateRanking(items, reviewsByTarget = new Map()) {
  return [...items]
    .map((item) => {
      const reviews = reviewsByTarget.get(item.id) || [];
      const reviewAverage = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : item.rating || 0;
      const reviewCount = reviews.length || item.reviewCount || 0;
      const score = reviewAverage * 0.7 + Math.log10(reviewCount + 1) * 0.3;
      return { ...item, rankScore: Number(score.toFixed(2)), computedRating: Number(reviewAverage.toFixed(1)), computedReviewCount: reviewCount };
    })
    .sort((left, right) => right.rankScore - left.rankScore);
}
