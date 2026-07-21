const REGION_OVERRIDES = {
  cantonese: new Set(['d-fish-set', 'd-salad', 'd-egg-tomato']),
  southwest: new Set(['d-tofu', 'd-flavor-chicken']),
  northwest: new Set(['d-beef-noodle', 'd-liangpi']),
  eastAsian: new Set(['d-cold-noodle', 'd-musubi']),
  light: new Set(['d-chicken-bowl', 'd-salad', 'd-fish-set', 'd-oat', 'd-library-sandwich', 'd-breakfast-set']),
  campus: new Set(['d-innovation-rice', 'd-sports-pasta', 'd-bulk', 'd-egg-tomato'])
};

const REGION_MATCHERS = {
  cantonese: (text) => /粤菜|粤味|清鲜|鱼鲜|咸鲜|清淡/.test(text) && /鱼|虾|鸡蛋|蔬菜|清爽|低脂|低热量/.test(text),
  southwest: (text) => /川湘|湘菜|西南|麻辣|香辣|小炒/.test(text),
  northwest: (text) => /西北|清真|拉面|凉皮|面食/.test(text),
  eastAsian: (text) => /日式|韩式|寿司|冷面/.test(text),
  light: (text) => /轻食|早餐|低脂|低热量|高纤维|沙拉|三明治|粥点/.test(text),
  campus: (text) => /家常|快餐|运动餐|地方风味|套餐|盖饭|能量/.test(text)
};

export const REGION_DEFINITIONS = [
  {
    id: 'cantonese',
    name: '粤菜清鲜',
    subtitle: '鲜而不腻，轻松开胃',
    description: '从鱼鲜、蛋香到清爽蔬菜，适合想吃得清新一点的时刻。',
    icon: '🍵',
    tone: 'mint'
  },
  {
    id: 'southwest',
    name: '西南湘辣',
    subtitle: '香辣下饭，越吃越有味',
    description: '川湘风味与地方小炒集合，给午餐加一点热烈的满足感。',
    icon: '🌶️',
    tone: 'coral'
  },
  {
    id: 'northwest',
    name: '西北面食',
    subtitle: '热汤面香，饱腹有劲',
    description: '拉面、凉皮和清真面食，适合需要一份扎实能量的时候。',
    icon: '🍜',
    tone: 'amber'
  },
  {
    id: 'eastAsian',
    name: '日韩风味',
    subtitle: '清爽小食，换换口味',
    description: '日式饭团与韩式冷面，给熟悉的校园餐单换一种节奏。',
    icon: '🍙',
    tone: 'sky'
  },
  {
    id: 'light',
    name: '轻食早餐',
    subtitle: '低负担，也要有滋味',
    description: '轻食、早餐和高纤维选择，适合早课、学习间隙或轻盈的一餐。',
    icon: '🥗',
    tone: 'lime'
  },
  {
    id: 'campus',
    name: '校园快餐',
    subtitle: '熟悉的味道，快速解决',
    description: '家常盖饭、运动套餐和快捷餐品，赶课时也能吃得明白。',
    icon: '🍱',
    tone: 'violet'
  }
];

const REGION_IDS = new Set(REGION_DEFINITIONS.map((region) => region.id));

function dishText(dish = {}) {
  return [dish.name, dish.cuisine, dish.taste, ...(dish.tags || []), ...(dish.ingredients || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function activeDish(dish) {
  return dish && dish.status !== 'archived' && dish.status !== 'inactive';
}

export function getRegionById(id) {
  return REGION_DEFINITIONS.find((region) => region.id === id) || null;
}

export function getDishRegionIds(dish) {
  if (!dish) return [];
  const text = dishText(dish);
  const matched = REGION_DEFINITIONS
    .filter((region) => REGION_MATCHERS[region.id]?.(text) || REGION_OVERRIDES[region.id]?.has(dish.id))
    .map((region) => region.id);
  return matched.length ? matched : ['campus'];
}

export function getRegionDishes(regionId, dishes = []) {
  if (!REGION_IDS.has(regionId)) return [];
  return dishes.filter((dish) => activeDish(dish) && getDishRegionIds(dish).includes(regionId));
}

function ratingFor(dish, ratingById) {
  const ranked = ratingById?.get?.(dish.id);
  return Number(ranked?.computedRating ?? dish.rating ?? 0);
}

function reviewCountFor(dish, ratingById) {
  const ranked = ratingById?.get?.(dish.id);
  return Number(ranked?.computedReviewCount ?? dish.reviewCount ?? 0);
}

function preferenceFor(dish, preferences) {
  return preferences.find((preference) => preference.dishId === dish.id) || {};
}

function decorateDish(dish, { ratingById, preferences }) {
  const rating = ratingFor(dish, ratingById);
  const reviewCount = reviewCountFor(dish, ratingById);
  const preference = preferenceFor(dish, preferences);
  const fatigue = Math.max(0, Number(preference.drawnCount || 0) - Number(preference.eatenCount || 0) * 1.5);
  const personalScore = rating * 10
    + Math.log10(Number(dish.sales || 0) + 1) * 4
    + Math.log10(reviewCount + 1) * 2
    + (preference.favorite ? 12 : 0)
    + Math.min(Number(preference.eatenCount || 0), 10) * 0.8
    - Math.min(fatigue, 8) * 0.4;

  return {
    ...dish,
    regionIds: getDishRegionIds(dish),
    displayRating: Number(rating.toFixed(1)),
    displayReviewCount: reviewCount,
    personalScore: Number(personalScore.toFixed(2)),
    isFavorite: Boolean(preference.favorite),
    eatenCount: Number(preference.eatenCount || 0)
  };
}

function compareStable(left, right, key) {
  if (left[key] !== right[key]) return right[key] - left[key];
  if (left.displayRating !== right.displayRating) return right.displayRating - left.displayRating;
  if (left.sales !== right.sales) return Number(right.sales || 0) - Number(left.sales || 0);
  return String(left.id).localeCompare(String(right.id));
}

function compareRating(left, right) {
  if (left.displayRating !== right.displayRating) return right.displayRating - left.displayRating;
  if (left.displayReviewCount !== right.displayReviewCount) return right.displayReviewCount - left.displayReviewCount;
  if (left.sales !== right.sales) return Number(right.sales || 0) - Number(left.sales || 0);
  return String(left.id).localeCompare(String(right.id));
}

function compareHot(left, right) {
  if (left.sales !== right.sales) return Number(right.sales || 0) - Number(left.sales || 0);
  if (left.displayReviewCount !== right.displayReviewCount) return right.displayReviewCount - left.displayReviewCount;
  if (left.displayRating !== right.displayRating) return right.displayRating - left.displayRating;
  return String(left.id).localeCompare(String(right.id));
}

export function rankRegionDishes(dishes = [], options = {}) {
  const sortBy = ['forYou', 'rating', 'hot', 'price'].includes(options.sortBy) ? options.sortBy : 'forYou';
  const decorated = dishes.filter(activeDish).map((dish) => decorateDish(dish, {
    ratingById: options.ratingById,
    preferences: Array.isArray(options.preferences) ? options.preferences : []
  }));

  const list = [...decorated];
  if (sortBy === 'rating') {
    list.sort(compareRating);
  } else if (sortBy === 'hot') {
    list.sort(compareHot);
  } else if (sortBy === 'price') {
    list.sort((left, right) => Number(left.price || 0) - Number(right.price || 0) || compareRating(left, right));
  } else {
    list.sort((left, right) => compareStable(left, right, 'personalScore'));
  }
  return list;
}

export function summarizeRegions(dishes = [], options = {}) {
  return REGION_DEFINITIONS.map((region) => {
    const regionDishes = rankRegionDishes(getRegionDishes(region.id, dishes), {
      ...options,
      sortBy: 'hot'
    });
    const totalSales = regionDishes.reduce((sum, dish) => sum + Number(dish.sales || 0), 0);
    const averageRating = regionDishes.length
      ? regionDishes.reduce((sum, dish) => sum + dish.displayRating, 0) / regionDishes.length
      : 0;
    return {
      ...region,
      count: regionDishes.length,
      totalSales,
      averageRating: Number(averageRating.toFixed(1)),
      heroDish: regionDishes[0] || null,
      dishes: regionDishes
    };
  });
}
