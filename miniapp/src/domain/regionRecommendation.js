const EXPLICIT_REGION_MAP = new Map([
  ['粤菜清鲜', 'cantonese'], ['粤菜', 'cantonese'],
  ['西南湘辣', 'southwest'], ['川湘', 'southwest'],
  ['西北面食', 'northwest'], ['西北', 'northwest'],
  ['日韩风味', 'eastAsian'], ['日韩', 'eastAsian'],
  ['轻食早餐', 'light'], ['轻食', 'light'],
  ['校园快餐', 'campus']
]);

const REGION_MATCHERS = {
  cantonese: (text) => /粤菜|粤味|清鲜|鱼鲜|咸鲜|清淡/.test(text) && /鱼|虾|鸡蛋|蔬菜|清爽|低脂|低热量/.test(text),
  southwest: (text) => /川湘|湘菜|西南|麻辣|香辣|小炒/.test(text),
  northwest: (text) => /西北|清真|拉面|凉皮|面食/.test(text),
  eastAsian: (text) => /日式|韩式|寿司|冷面|饭团/.test(text),
  light: (text) => /轻食|早餐|低脂|低热量|高纤维|沙拉|三明治|粥点/.test(text),
  campus: (text) => /家常|快餐|运动餐|地方风味|套餐|盖饭|能量/.test(text)
};

export const REGION_DEFINITIONS = [
  { id: 'cantonese', name: '粤菜清鲜', subtitle: '鲜而不腻', description: '鱼鲜、蛋香与清爽蔬菜。', tone: 'mint' },
  { id: 'southwest', name: '西南湘辣', subtitle: '香辣下饭', description: '川湘风味与地方小炒。', tone: 'coral' },
  { id: 'northwest', name: '西北面食', subtitle: '面香饱腹', description: '拉面、凉皮与清真面食。', tone: 'amber' },
  { id: 'eastAsian', name: '日韩风味', subtitle: '清爽换味', description: '日韩饭食与特色小吃。', tone: 'sky' },
  { id: 'light', name: '轻食早餐', subtitle: '轻盈有料', description: '早餐、轻食与高纤维选择。', tone: 'lime' },
  { id: 'campus', name: '校园快餐', subtitle: '快捷熟悉', description: '家常盖饭与校园快捷餐。', tone: 'violet' }
];

const REGION_IDS = new Set(REGION_DEFINITIONS.map((item) => item.id));
const activeDish = (dish) => dish && dish.status !== 'archived' && dish.status !== 'inactive';

export function getRegionById(id) {
  return REGION_DEFINITIONS.find((item) => item.id === id) || null;
}

export function getDishRegionIds(dish = {}) {
  const explicit = EXPLICIT_REGION_MAP.get(String(dish.regionalTaste || '').trim());
  if (explicit) return [explicit];
  const text = [dish.name, dish.cuisine, dish.taste, ...(dish.tags || []), ...(dish.ingredients || [])].filter(Boolean).join(' ').toLowerCase();
  const matches = REGION_DEFINITIONS.filter((item) => REGION_MATCHERS[item.id]?.(text)).map((item) => item.id);
  return matches.length ? matches : ['campus'];
}

export function getRegionDishes(regionId, dishes = []) {
  if (!REGION_IDS.has(regionId)) return [];
  return dishes.filter((dish) => activeDish(dish) && getDishRegionIds(dish).includes(regionId));
}

function decorate(dish, options) {
  const ranked = options.ratingById?.get?.(String(dish.id));
  const preference = (options.preferences || []).find((item) => String(item.dishId) === String(dish.id)) || {};
  const displayRating = Number(ranked?.computedRating ?? dish.rating ?? 0);
  const displayReviewCount = Number(ranked?.computedReviewCount ?? dish.reviewCount ?? 0);
  const fatigue = Math.max(0, Number(preference.drawnCount || 0) - Number(preference.eatenCount || 0) * 1.5);
  const personalScore = displayRating * 10 + Math.log10(Number(dish.sales || 0) + 1) * 4
    + Math.log10(displayReviewCount + 1) * 2 + (preference.favorite ? 12 : 0)
    + Math.min(Number(preference.eatenCount || 0), 10) * 0.8 - Math.min(fatigue, 8) * 0.4;
  return { ...dish, displayRating: Number(displayRating.toFixed(1)), displayReviewCount, personalScore, isFavorite: Boolean(preference.favorite), eatenCount: Number(preference.eatenCount || 0) };
}

export function rankRegionDishes(dishes = [], options = {}) {
  const sortBy = ['forYou', 'rating', 'hot', 'price'].includes(options.sortBy) ? options.sortBy : 'forYou';
  const list = dishes.filter(activeDish).map((dish) => decorate(dish, options));
  const ratingCompare = (a, b) => b.displayRating - a.displayRating || b.displayReviewCount - a.displayReviewCount || String(a.id).localeCompare(String(b.id));
  list.sort((a, b) => {
    if (sortBy === 'price') return Number(a.price || 0) - Number(b.price || 0) || ratingCompare(a, b);
    if (sortBy === 'hot') return Number(b.sales || 0) - Number(a.sales || 0) || ratingCompare(a, b);
    if (sortBy === 'rating') return ratingCompare(a, b);
    return b.personalScore - a.personalScore || ratingCompare(a, b);
  });
  return list;
}

export function summarizeRegions(dishes = [], options = {}) {
  return REGION_DEFINITIONS.map((region) => {
    const regionDishes = rankRegionDishes(getRegionDishes(region.id, dishes), { ...options, sortBy: 'hot' });
    const totalSales = regionDishes.reduce((sum, dish) => sum + Number(dish.sales || 0), 0);
    const averageRating = regionDishes.length ? regionDishes.reduce((sum, dish) => sum + dish.displayRating, 0) / regionDishes.length : 0;
    return { ...region, count: regionDishes.length, totalSales, averageRating: Number(averageRating.toFixed(1)), heroDish: regionDishes[0] || null, dishes: regionDishes };
  });
}
