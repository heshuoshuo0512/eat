const GOAL_LABELS = {
  fatLoss: '减脂',
  muscleGain: '增肌',
  maintain: '均衡',
  healthy: '健康'
};

const MEAL_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐'
};

function listText(value, fallback) {
  return Array.isArray(value) && value.length ? value.slice(0, 2).join('、') : fallback;
}

export function buildProfilePrompts(profile = {}, mode = 'search') {
  const goal = GOAL_LABELS[profile.goal] || '健康';
  const meal = MEAL_LABELS[profile.mealType] || '本餐';
  const budget = Number(profile.budgetMax || 20);
  const taste = profile.taste && profile.taste !== '不限' ? profile.taste : '清爽';
  const avoid = listText(profile.avoid, '不合适的食材');
  const crowd = profile.preferLowCrowd ? '并优先低人流档口' : '';
  const prefix = mode === 'recommend' ? '请结合我的健康档案和今日真实供应' : '请从当前真实菜品中';

  return [
    {
      id: 'profile-goal',
      label: `${goal}${meal}`,
      hint: '按目标和餐次匹配',
      query: `${prefix}推荐适合${goal}目标的${meal}，说明营养和选择理由。`
    },
    {
      id: 'budget',
      label: `¥${budget} 内`,
      hint: '预算内优先高分',
      query: `${prefix}找出 ${budget} 元以内评分较高、搭配均衡的${meal}。`
    },
    {
      id: 'taste',
      label: `${taste}口味`,
      hint: '贴合当前偏好',
      query: `${prefix}推荐偏${taste}口味的${meal}${crowd}。`
    },
    {
      id: 'safety',
      label: profile.avoid?.length ? '避开忌口' : '轻松少排队',
      hint: profile.avoid?.length ? `排除${avoid}` : '结合当前供应状态',
      query: profile.avoid?.length
        ? `${prefix}推荐${meal}，严格排除${avoid}${crowd}。`
        : `${prefix}推荐现在容易买到、等待时间较短的${meal}。`
    }
  ];
}

export function createRatingMap(rankedDishes = []) {
  return new Map(rankedDishes.map((dish) => [dish.id, dish]));
}

export function dishDisplayRating(dish, ratingById = new Map()) {
  const ranked = ratingById.get(dish?.id);
  const value = ranked?.computedRating ?? ranked?.rating ?? dish?.computedRating ?? dish?.rating ?? 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function sortDishesByRating(dishes = [], ratingById = new Map(), direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...dishes]
    .map((dish) => ({ ...dish, displayRating: dishDisplayRating(dish, ratingById) }))
    .sort((left, right) => {
      const ratingDelta = (left.displayRating - right.displayRating) * multiplier;
      if (ratingDelta) return ratingDelta;
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
    });
}

export function visibleCitations(citations = [], expanded = false, limit = 3) {
  return expanded ? citations : citations.slice(0, limit);
}

export function compactCitationSnippet(value, maxLength = 58) {
  const text = String(value || '来源于当前校园菜品库与已发布菜单。').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
