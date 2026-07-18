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
    avoid: Array.isArray(profile.avoid) ? profile.avoid.filter(Boolean) : String(profile.avoid || '').split(/[，,\s]+/).filter(Boolean),
    dietaryPattern: profile.dietaryPattern || 'balanced',
    spiceLevel: Number.isFinite(Number(profile.spiceLevel)) ? Number(profile.spiceLevel) : 3,
    nutritionFocus: Array.isArray(profile.nutritionFocus) ? profile.nutritionFocus : [],
    preferLowCrowd: Boolean(profile.preferLowCrowd),
    favoriteTags: Array.isArray(profile.favoriteTags) ? profile.favoriteTags : []
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

/**
 * Contextual recommendation with per-factor scoring and reasons.
 *
 * @param {Array} dishes - Available dish objects
 * @param {Object} context - { profile, environment, canteens, stalls, preferences, timeOfDay }
 * @returns {Array} Ranked dishes with scoreBreakdown and why
 */
export function contextualRankDishes(dishes, context) {
  const { profile: rawProfile, environment, canteens = [], stalls = [], preferences = [], timeOfDay } = context;
  const profile = normalizeProfile(rawProfile);
  const goal = goalProfiles[profile.goal] || goalProfiles.healthy;
  const temperature = environment?.temperature ?? 25;
  const weatherLabel = environment?.weatherLabel || '晴';
  const isHot = temperature >= 30;
  const isCold = temperature <= 10;

  return filterDishes(dishes, profile)
    .map((dish) => {
      const breakdown = {};
      const reasons = [];

      // 1. Goal/nutrition score
      const goalScore = goal.score(dish);
      breakdown.goal = Number(goalScore.toFixed(1));
      reasons.push(goal.reason);

      // 2. Rating/popularity score
      const ratingScore = dish.rating * 8 + Math.log10(dish.reviewCount + 1) * 6;
      breakdown.rating = Number(ratingScore.toFixed(1));

      // 3. Budget score
      const budgetRaw = Math.max(0, profile.budgetMax - dish.price) * 0.8;
      const budgetScore = budgetRaw;
      breakdown.budget = Number(budgetScore.toFixed(1));
      if (dish.price <= profile.budgetMax * 0.7) reasons.push(`价格${dish.price}元，低于预算较多`);

      // 4. Weather/temperature score
      let weatherScore = 0;
      if (isHot) {
        const coolTags = ['消暑', '清爽', '冷食', '凉'];
        const hotTags = ['热汤', '重油', '暖胃'];
        const coolMatch = dish.tags.filter((t) => coolTags.includes(t)).length;
        const hotMatch = dish.tags.filter((t) => hotTags.includes(t)).length;
        weatherScore += coolMatch * 8 - hotMatch * 5;
        if (coolMatch > 0) reasons.push(`${temperature}°C ${weatherLabel}，适合消暑菜品`);
      } else if (isCold) {
        const warmTags = ['热汤', '暖胃', '高碳水'];
        const coolTags = ['冷食', '消暑'];
        const warmMatch = dish.tags.filter((t) => warmTags.includes(t)).length;
        const coolMatch = dish.tags.filter((t) => coolTags.includes(t)).length;
        weatherScore += warmMatch * 6 - coolMatch * 4;
        if (warmMatch > 0) reasons.push(`${temperature}°C ${weatherLabel}，适合暖胃菜品`);
      }
      breakdown.weather = Number(weatherScore.toFixed(1));

      // 5. Crowd score (leaf canteen)
      let crowdScore = 0;
      const stall = stalls.find((s) => s.id === dish.stallId);
      const canteen = canteens.find((c) => c.id === stall?.canteenId);
      if (canteen && profile.preferLowCrowd) {
        crowdScore = Math.max(0, (100 - canteen.crowdLevel)) * 0.15;
        if (canteen.crowdLevel < 50) reasons.push(`${canteen.name}当前人少`);
      }
      breakdown.crowd = Number(crowdScore.toFixed(1));

      // 6. User interaction/preference score
      let prefScore = 0;
      const pref = preferences.find((p) => p.dishId === dish.id);
      if (pref) {
        if (pref.favorite) prefScore += 12;
        prefScore += Math.min(pref.eatenCount || 0, 10) * 0.5;
        // Fatigue: drawn but not eaten reduces interest
        const fatigue = Math.max(0, (pref.drawnCount || 0) - (pref.eatenCount || 0) * 1.5);
        prefScore -= Math.min(fatigue, 8) * 0.4;
        if (pref.favorite) reasons.push('已收藏');
        if ((pref.eatenCount || 0) >= 5) reasons.push(`吃过${pref.eatenCount}次`);
      }
      breakdown.preference = Number(prefScore.toFixed(1));

      // 7. Nutrition focus score
      let nutritionFocusScore = 0;
      const focus = profile.nutritionFocus;
      if (focus.includes('highProtein') && dish.nutrition.protein >= 30) { nutritionFocusScore += 8; reasons.push('高蛋白匹配'); }
      if (focus.includes('highFiber') && (dish.fiber || 0) >= 3) { nutritionFocusScore += 6; reasons.push('高纤维匹配'); }
      if (focus.includes('lowSodium') && (dish.sodium || 0) < 500) { nutritionFocusScore += 5; reasons.push('低钠匹配'); }
      if (focus.includes('lowSugar') && (dish.sugar || 0) < 5) { nutritionFocusScore += 5; reasons.push('低糖匹配'); }
      if (focus.includes('calcium') && (dish.calcium || 0) >= 100) { nutritionFocusScore += 5; reasons.push('高钙匹配'); }
      if (focus.includes('iron') && (dish.iron || 0) >= 3) { nutritionFocusScore += 5; reasons.push('高铁匹配'); }
      breakdown.nutritionFocus = Number(nutritionFocusScore.toFixed(1));

      // 8. Spice level match
      let spiceScore = 0;
      const spiceLevel = profile.spiceLevel;
      const dishSpicy = dish.taste.includes('麻辣') ? 5 : dish.taste.includes('辣') ? 4 : dish.taste.includes('微辣') ? 3 : 1;
      const spicePenalty = Math.abs(spiceLevel - dishSpicy);
      spiceScore -= spicePenalty * 2.5;
      if (spicePenalty === 0) reasons.push('辣度匹配');
      breakdown.spice = Number(spiceScore.toFixed(1));

      // 9. Favorite tags match
      let tagScore = 0;
      const favTags = profile.favoriteTags;
      const matchingTags = dish.tags.filter((t) => favTags.includes(t));
      tagScore += matchingTags.length * 4;
      if (matchingTags.length) reasons.push(`匹配标签：${matchingTags.join('、')}`);
      breakdown.tags = Number(tagScore.toFixed(1));

      // 10. Meal type time bonus
      let timeBonus = 0;
      if (timeOfDay) {
        if (timeOfDay === 'breakfast' && dish.mealTypes.includes('breakfast')) timeBonus += 5;
        if (timeOfDay === 'lunch' && dish.mealTypes.includes('lunch')) timeBonus += 3;
        if (timeOfDay === 'dinner' && dish.mealTypes.includes('dinner')) timeBonus += 3;
      }
      breakdown.timeBonus = Number(timeBonus.toFixed(1));

      const totalScore = goalScore + ratingScore + budgetScore + weatherScore + crowdScore + prefScore + nutritionFocusScore + spiceScore + tagScore + timeBonus;

      return {
        ...dish,
        contextualScore: Number(totalScore.toFixed(1)),
        scoreBreakdown: breakdown,
        why: reasons,
        canteenId: canteen?.id || null,
        canteenName: canteen?.name || null,
        stallName: stall?.name || null
      };
    })
    .sort((left, right) => right.contextualScore - left.contextualScore);
}

export function buildMealPlan(dishes, profile) {
  const normalized = normalizeProfile(profile);
  const ranked = rankDishes(dishes, normalized);
  const fallback = rankDishes(dishes, { ...normalized, taste: '不限', halalOnly: normalized.halalOnly });
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
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];

/**
 * Build a deterministic multi-day health meal plan.
 * Avoids repeating the same dish in adjacent meals (prev meal of same day or last meal of previous day).
 *
 * @param {Array} dishes - Available dish pool
 * @param {Object} profile - User health profile
 * @param {number} days - 1, 3, or 7
 * @returns {{ days, meals, dayTotals, planTotals, goalLabel, days: number }}
 */
export function buildHealthPlan(dishes, profile, days = 1) {
  const clampedDays = Math.max(1, Math.min(7, Math.round(days)));
  const normalized = normalizeProfile(profile);
  const goal = goalProfiles[normalized.goal] || goalProfiles.healthy;

  const planDays = [];
  const usedRecent = []; // dish IDs used in the immediately preceding meal
  const allDayTotals = [];

  for (let d = 0; d < clampedDays; d++) {
    const meals = [];
    const dayUsed = new Set();

    for (const mealType of MEAL_SLOTS) {
      const mealProfile = { ...normalized, mealType };
      const ranked = rankDishes(dishes, mealProfile);
      const fallback = ranked.length ? ranked : rankDishes(dishes, { ...mealProfile, taste: '不限', halalOnly: normalized.halalOnly });

      // Filter out dishes used in the previous meal to avoid adjacent repetition
      const avoidSet = new Set(usedRecent);
      const filtered = fallback.filter((dish) => !avoidSet.has(dish.id));
      const picks = (filtered.length ? filtered : fallback).slice(0, 3);

      const mealTotals = picks.reduce(
        (sum, dish) => ({
          calories: sum.calories + dish.nutrition.calories,
          protein: sum.protein + dish.nutrition.protein,
          fat: sum.fat + dish.nutrition.fat,
          carbs: sum.carbs + dish.nutrition.carbs,
          price: sum.price + dish.price
        }),
        { calories: 0, protein: 0, fat: 0, carbs: 0, price: 0 }
      );

      meals.push({
        mealType,
        mealTypeLabel: mealType === 'breakfast' ? '早餐' : mealType === 'lunch' ? '午餐' : '晚餐',
        dishes: picks,
        totals: mealTotals
      });

      // Track used dish IDs for adjacent-meal avoidance
      usedRecent.length = 0;
      for (const dish of picks) {
        usedRecent.push(dish.id);
        dayUsed.add(dish.id);
      }
    }

    const dayTotals = meals.reduce(
      (sum, m) => ({
        calories: sum.calories + m.totals.calories,
        protein: sum.protein + m.totals.protein,
        fat: sum.fat + m.totals.fat,
        carbs: sum.carbs + m.totals.carbs,
        price: sum.price + m.totals.price
      }),
      { calories: 0, protein: 0, fat: 0, carbs: 0, price: 0 }
    );

    allDayTotals.push(dayTotals);
    planDays.push({ dayIndex: d, meals, dayTotals });
  }

  const planTotals = allDayTotals.reduce(
    (sum, dt) => ({
      calories: sum.calories + dt.calories,
      protein: sum.protein + dt.protein,
      fat: sum.fat + dt.fat,
      carbs: sum.carbs + dt.carbs,
      price: sum.price + dt.price
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0, price: 0 }
  );

  return {
    days: clampedDays,
    goalLabel: goal.label,
    reason: `${goal.reason} 已为您规划 ${clampedDays} 天餐单，预算上限 ${normalized.budgetMax} 元/餐。`,
    planDays,
    dayTotals: allDayTotals,
    planTotals
  };
}
