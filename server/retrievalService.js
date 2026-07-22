import { z } from 'zod';
import { normalizeProfile } from '../src/domain/recommendation.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'sales'];
const TASTE_WORDS = ['清淡', '清爽', '咸鲜', '麻辣', '微辣', '酸辣', '酸甜', '黑椒', '酱香', '甜味'];
const NUTRITION_DEFAULTS = {
  highProtein: { minProtein: 25 },
  highFiber: { minFiber: 3 },
  lowCalorie: { maxCalories: 500 },
  lowFat: { maxFat: 15 },
  lowSodium: { maxSodium: 500 },
  lowSugar: { maxSugar: 5 }
};

const listSchema = z.preprocess(
  (value) => {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value;
    return String(value).split(/[，,、;；\s]+/).filter(Boolean);
  },
  z.array(z.string().trim().min(1).max(80)).max(30)
);

const optionalNumber = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => z.preprocess(
  (value) => value === '' || value == null ? undefined : value,
  z.coerce.number().finite().min(minimum).max(maximum).optional()
);

const filtersSchema = z.object({
  keyword: z.string().trim().max(500).optional(),
  maxPrice: optionalNumber(0, 10000),
  budgetMin: optionalNumber(0, 10000),
  budgetMax: optionalNumber(0, 10000),
  mealType: z.enum(MEAL_TYPES).optional(),
  primaryCanteenId: z.string().trim().max(128).optional(),
  canteenId: z.string().trim().max(128).optional(),
  canteenName: z.string().trim().max(128).optional(),
  stallId: z.string().trim().max(128).optional(),
  stallName: z.string().trim().max(128).optional(),
  halalOnly: z.coerce.boolean().optional(),
  taste: z.string().trim().max(80).optional(),
  tags: listSchema.optional(),
  includeIngredients: listSchema.optional(),
  avoidIngredients: listSchema.optional(),
  allergens: listSchema.optional(),
  dietaryPattern: z.enum(['balanced', 'vegetarian', 'vegan']).optional(),
  minProtein: optionalNumber(0, 1000),
  minFiber: optionalNumber(0, 1000),
  maxCalories: optionalNumber(0, 10000),
  maxFat: optionalNumber(0, 1000),
  maxCarbs: optionalNumber(0, 2000),
  maxSodium: optionalNumber(0, 100000),
  maxSugar: optionalNumber(0, 1000),
  orderableOnly: z.coerce.boolean().optional()
}).default({});

const searchRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).default('default'),
  query: z.string().trim().max(500).default(''),
  filters: filtersSchema,
  sort: z.enum(SEARCH_SORTS).default('relevance'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  candidates: z.array(z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).default({})
});

const recommendationRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128).default('default'),
  userId: z.string().trim().max(128).optional(),
  query: z.string().trim().max(500).default(''),
  profile: z.record(z.string(), z.unknown()).default({}),
  profileOverride: z.record(z.string(), z.unknown()).default({}),
  context: z.record(z.string(), z.unknown()).default({}),
  options: z.object({
    mode: z.enum(['alternatives', 'combination']).optional(),
    limit: z.coerce.number().int().min(1).max(10).default(3),
    combinationSize: z.coerce.number().int().min(2).max(3).default(3),
    requireOrderable: z.boolean().default(true),
    strictTaste: z.boolean().default(false)
  }).default({}),
  candidates: z.array(z.unknown()).optional()
});

function validationError(result) {
  const message = result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('；');
  return Object.assign(new Error(`检索请求参数不合法：${message}`), { status: 400, code: 'INVALID_RETRIEVAL_REQUEST' });
}

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function uniqueStrings(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value])
    .map((value) => String(value).trim()).filter(Boolean))];
}

function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function includesTerm(value, term) {
  const haystack = normalizedText(value);
  const needle = normalizedText(term);
  return Boolean(needle) && haystack.includes(needle);
}

function isActiveDish(candidate) {
  return candidate?.status === 'active';
}

function extractListAfter(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) return [];
  return match[1]
    .split(/[，,、;；和及与\s]+/)
    .map((item) => item.replace(/(?:的菜|食材|食品|菜品|都)?(?:过敏|不吃|不要|忌口)?$/g, '').trim())
    .filter((item) => item.length >= 1 && item.length <= 20);
}

function inferQueryFilters(query) {
  const text = String(query || '').trim();
  const inferred = {};
  const detected = [];

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:到|至|[-~～])\s*(\d+(?:\.\d+)?)\s*元?/);
  const max = text.match(/(?:预算|不超过|不高于|最多|以内|低于|少于)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元?|(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元\s*(?:以内|以下)/);
  const min = text.match(/(?:至少|不低于|最低)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元?|(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元\s*(?:以上|起)/);
  if (range) {
    inferred.budgetMin = Math.min(Number(range[1]), Number(range[2]));
    inferred.budgetMax = Math.max(Number(range[1]), Number(range[2]));
    detected.push('budgetRange');
  } else {
    const maxValue = max && Number(max[1] || max[2]);
    const minValue = min && Number(min[1] || min[2]);
    if (Number.isFinite(maxValue)) { inferred.budgetMax = maxValue; detected.push('budgetMax'); }
    if (Number.isFinite(minValue)) { inferred.budgetMin = minValue; detected.push('budgetMin'); }
  }

  if (/早餐|早饭|早点/.test(text)) { inferred.mealType = 'breakfast'; detected.push('mealType'); }
  else if (/晚餐|晚饭|夜宵/.test(text)) { inferred.mealType = 'dinner'; detected.push('mealType'); }
  else if (/午餐|午饭|中饭/.test(text)) { inferred.mealType = 'lunch'; detected.push('mealType'); }

  if (/清真/.test(text)) { inferred.halalOnly = true; detected.push('halalOnly'); }
  if (/纯素|全素|vegan/i.test(text)) { inferred.dietaryPattern = 'vegan'; detected.push('dietaryPattern'); }
  else if (/素食|素菜|vegetarian/i.test(text)) { inferred.dietaryPattern = 'vegetarian'; detected.push('dietaryPattern'); }

  const taste = TASTE_WORDS.find((word) => text.includes(word));
  if (taste) { inferred.taste = taste; detected.push('taste'); }

  if (/高蛋白|蛋白质多/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.highProtein);
  if (/高纤维|膳食纤维多/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.highFiber);
  if (/低卡|低热量|热量低/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowCalorie);
  if (/低脂|少油|脂肪低/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowFat);
  if (/低钠|少盐/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowSodium);
  if (/低糖|少糖/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowSugar);
  if (Object.keys(inferred).some((key) => /^(min|max)(Protein|Fiber|Calories|Fat|Sodium|Sugar)$/.test(key))) detected.push('nutrition');

  const avoid = extractListAfter(text, /(?:不吃|不要|忌口|避开|去掉)\s*([^。！？!?，,]{1,60})/);
  const allergens = extractListAfter(text, /(?:对|有)?\s*([^。！？!?，,]{1,40})\s*(?:过敏|不能吃)/);
  if (avoid.length) { inferred.avoidIngredients = avoid; detected.push('avoidIngredients'); }
  if (allergens.length) { inferred.allergens = allergens; detected.push('allergens'); }

  return { filters: inferred, detected: [...new Set(detected)] };
}

function inferRecommendationProfile(query) {
  const text = String(query || '').trim();
  if (/减脂|减重|控卡|控制体重/.test(text)) return { profile: { goal: 'fatLoss' }, detected: ['goal'] };
  if (/增肌|增重|训练后|健身恢复/.test(text)) return { profile: { goal: 'muscleGain' }, detected: ['goal'] };
  if (/维持体重|保持体重/.test(text)) return { profile: { goal: 'maintain' }, detected: ['goal'] };
  return { profile: {}, detected: [] };
}

function mergeFilters(inferred, explicit) {
  const merged = { ...inferred, ...explicit };
  merged.includeIngredients = uniqueStrings(inferred.includeIngredients, explicit.includeIngredients);
  merged.avoidIngredients = uniqueStrings(inferred.avoidIngredients, explicit.avoidIngredients);
  merged.allergens = uniqueStrings(inferred.allergens, explicit.allergens);
  if (!merged.includeIngredients.length) delete merged.includeIngredients;
  if (!merged.avoidIngredients.length) delete merged.avoidIngredients;
  if (!merged.allergens.length) delete merged.allergens;
  return merged;
}

/** Validate and interpret a dish-search request without touching storage. */
export function parseDishSearchRequest(input = {}) {
  const raw = typeof input === 'string' ? { query: input } : input;
  const parsed = searchRequestSchema.safeParse(raw || {});
  if (!parsed.success) throw validationError(parsed);
  const query = parsed.data.query || parsed.data.filters?.keyword || '';
  const explicitFilters = { ...(parsed.data.filters || {}) };
  if (explicitFilters.budgetMax == null && explicitFilters.maxPrice != null) explicitFilters.budgetMax = explicitFilters.maxPrice;
  delete explicitFilters.keyword;
  delete explicitFilters.maxPrice;
  const inferred = inferQueryFilters(query);
  const filters = mergeFilters(inferred.filters, explicitFilters);
  if (filters.budgetMin != null && filters.budgetMax != null && filters.budgetMin > filters.budgetMax) {
    throw Object.assign(new Error('最低预算不能高于最高预算'), { status: 400, code: 'INVALID_BUDGET_RANGE' });
  }
  return {
    ...parsed.data,
    query,
    filters,
    interpreted: {
      query,
      normalizedQuery: normalizedText(query),
      filters,
      detected: inferred.detected,
      sort: parsed.data.sort
    }
  };
}

function mapCandidate(raw, tenantId) {
  const nutrition = raw.nutrition || {};
  const menuItem = raw.menuItem || raw.menu_item || null;
  const explicitAvailability = raw.availability && typeof raw.availability === 'object' ? raw.availability : null;
  return {
    ...raw,
    id: String(raw.id || raw.dishId || raw.dish_id || ''),
    tenantId: String(raw.tenantId || raw.tenant_id || tenantId),
    stallId: raw.stallId || raw.stall_id || null,
    stallName: raw.stallName || raw.stall_name || null,
    canteenId: raw.canteenId || raw.canteen_id || null,
    primaryCanteenId: raw.primaryCanteenId || raw.primary_canteen_id || null,
    canteenName: raw.canteenName || raw.canteen_name || null,
    canteenLocation: raw.canteenLocation || raw.canteen_location || raw.location || null,
    crowdLevel: Number(raw.crowdLevel ?? raw.crowd_level ?? 50),
    stallOpen: raw.stallOpen == null && raw.stall_open == null ? true : Boolean(raw.stallOpen ?? raw.stall_open),
    name: String(raw.name || raw.dishName || raw.dish_name || ''),
    price: Number(raw.price ?? 0),
    taste: String(raw.taste || ''),
    cuisine: String(raw.cuisine || ''),
    regionalTaste: String(raw.regionalTaste || raw.regional_taste || ''),
    ingredients: parseJson(raw.ingredients || raw.ingredients_json, []),
    tags: parseJson(raw.tags || raw.tags_json, []),
    allergens: parseJson(raw.allergens || raw.allergens_json, []),
    halal: Boolean(raw.halal),
    mealTypes: parseJson(raw.mealTypes || raw.meal_types_json, ['lunch', 'dinner']),
    nutrition: {
      calories: Number(nutrition.calories ?? raw.calories ?? 0),
      protein: Number(nutrition.protein ?? raw.protein ?? 0),
      fat: Number(nutrition.fat ?? raw.fat ?? 0),
      carbs: Number(nutrition.carbs ?? raw.carbs ?? 0)
    },
    fiber: Number(raw.fiber ?? 0),
    sodium: Number(raw.sodium ?? 0),
    sugar: Number(raw.sugar ?? 0),
    calcium: Number(raw.calcium ?? 0),
    iron: Number(raw.iron ?? 0),
    rating: Number(raw.rating ?? 0),
    reviewCount: Number(raw.reviewCount ?? raw.review_count ?? 0),
    sales: Number(raw.sales ?? 0),
    status: String(raw.status ?? '').trim().toLowerCase(),
    description: String(raw.description || ''),
    _menuEntries: parseJson(raw._menuEntries || raw.menuEntries || [], []),
    _menuItem: menuItem,
    _explicitAvailability: explicitAvailability
  };
}

function mapMenuEntry(row) {
  return {
    id: row.id || row.menuItemId || row.menu_item_id,
    menuId: row.menuId || row.menu_id || row.published_menu_id,
    dishId: row.dishId || row.dish_id,
    date: row.date || row.menuDate || row.menu_date,
    mealType: row.mealType || row.menuMealType || row.menu_meal_type,
    status: row.status || row.menuStatus || row.menu_status || 'published',
    price: Number(row.price ?? 0),
    supplyLimit: Number(row.supplyLimit ?? row.supply_limit ?? 0),
    supplyCount: Number(row.supplyCount ?? row.supply_count ?? 0),
    soldOut: Boolean(row.soldOut ?? row.sold_out),
    servingStart: row.servingStart || row.serving_start || '00:00',
    servingEnd: row.servingEnd || row.serving_end || '23:59'
  };
}

function localDateAndTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const pad = (part) => String(part).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    hour: date.getHours()
  };
}

function inferCurrentMeal(hour) {
  if (hour < 10) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}

function isWithinServingTime(time, start, end) {
  if (!start || !end) return true;
  if (start <= end) return time >= start && time <= end;
  return time >= start || time <= end;
}

function deriveAvailability(candidate, { date, mealType, time }) {
  if (!isActiveDish(candidate)) {
    return {
      ...(candidate._explicitAvailability || {}),
      orderable: false,
      status: 'dish_inactive',
      reason: 'dish_inactive'
    };
  }

  if (candidate._explicitAvailability) {
    return {
      orderable: Boolean(candidate._explicitAvailability.orderable),
      status: candidate._explicitAvailability.status || (candidate._explicitAvailability.orderable ? 'available' : 'unavailable'),
      reason: candidate._explicitAvailability.reason || null,
      ...candidate._explicitAvailability
    };
  }

  const direct = candidate._menuItem ? mapMenuEntry({
    ...candidate._menuItem,
    dishId: candidate.id,
    date: candidate._menuItem.date || date,
    mealType: candidate._menuItem.mealType || mealType,
    status: candidate._menuItem.status || 'published'
  }) : null;
  const entries = [...candidate._menuEntries.map(mapMenuEntry), ...(direct ? [direct] : [])]
    .filter((entry) => (!entry.date || entry.date === date) && (!mealType || !entry.mealType || entry.mealType === mealType));
  const hasStock = (item) => !item.soldOut && (item.supplyLimit <= 0 || item.supplyCount < item.supplyLimit);
  const entry = entries.find((item) => item.status === 'published' && hasStock(item) && isWithinServingTime(time, item.servingStart, item.servingEnd))
    || entries.find((item) => item.status === 'published' && hasStock(item))
    || entries[0];
  const base = {
    menuItemId: entry?.id || null,
    menuId: entry?.menuId || null,
    date,
    mealType,
    price: Number(entry?.price ?? candidate.price),
    supplyLimit: Number(entry?.supplyLimit || 0),
    supplyCount: Number(entry?.supplyCount || 0),
    remaining: entry?.supplyLimit > 0 ? Math.max(0, entry.supplyLimit - entry.supplyCount) : null,
    servingStart: entry?.servingStart || null,
    servingEnd: entry?.servingEnd || null
  };

  if (!candidate.stallOpen) return { ...base, orderable: false, status: 'stall_closed', reason: 'stall_closed' };
  if (!entry || entry.status !== 'published') return { ...base, orderable: false, status: 'not_on_menu', reason: 'not_on_menu' };
  if (entry.soldOut || (entry.supplyLimit > 0 && entry.supplyCount >= entry.supplyLimit)) return { ...base, orderable: false, status: 'sold_out', reason: 'sold_out' };
  if (!isWithinServingTime(time, entry.servingStart, entry.servingEnd)) return { ...base, orderable: false, status: 'outside_serving_time', reason: 'outside_serving_time' };
  const limited = entry.supplyLimit > 0 && entry.supplyCount >= entry.supplyLimit * 0.8;
  return { ...base, orderable: true, status: limited ? 'limited' : 'available', reason: null };
}

function publicCandidate(candidate) {
  const { _menuEntries, _menuItem, _explicitAvailability, ...dish } = candidate;
  return dish;
}

async function loadCandidatesFromDatabase(db, tenantId, { date, mealType }) {
  if (!db?.prepare) throw Object.assign(new Error('未提供菜品候选或数据库适配器'), { status: 500, code: 'RETRIEVAL_SOURCE_UNAVAILABLE' });
  const [dishRows, menuRows] = await Promise.all([
    db.prepare(`SELECT d.*, s.name AS stall_name, s.canteen_id AS canteen_id, s.open AS stall_open,
      c.name AS canteen_name, c.location AS canteen_location, c.crowd_level AS crowd_level,
      c.parent_id AS primary_canteen_id
      FROM dishes d
      LEFT JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
      LEFT JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
      WHERE d.tenant_id = ? AND d.status = 'active'`).all(tenantId),
    db.prepare(`SELECT mi.*, m.id AS published_menu_id, m.date AS menu_date,
      m.meal_type AS menu_meal_type, m.status AS menu_status
      FROM menu_items mi
      JOIN menus m ON m.id = mi.menu_id AND m.tenant_id = mi.tenant_id
      WHERE mi.tenant_id = ? AND m.date = ? AND m.status = 'published'`).all(tenantId, date)
  ]);
  const menuByDish = new Map();
  for (const row of menuRows) {
    if (mealType && row.menu_meal_type !== mealType) continue;
    menuByDish.set(row.dish_id, [...(menuByDish.get(row.dish_id) || []), mapMenuEntry(row)]);
  }
  return dishRows.map((row) => mapCandidate({ ...row, _menuEntries: menuByDish.get(row.id) || [] }, tenantId));
}

function candidateSearchText(candidate) {
  return [candidate.name, candidate.cuisine, candidate.taste, candidate.description, candidate.stallName, candidate.canteenName,
    ...candidate.ingredients, ...candidate.tags].filter(Boolean).join(' ');
}

function chineseBigrams(text) {
  const compact = normalizedText(text);
  const grams = [];
  for (let index = 0; index < compact.length - 1; index += 1) grams.push(compact.slice(index, index + 2));
  return [...new Set(grams)];
}

/** Deterministic Chinese-friendly lexical ranking over already authorized candidates. */
export function lexicalRankDishes(query, candidates = []) {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return candidates.map((candidate, rank) => ({ id: candidate.id, rank, score: 0, matchReasons: [] }));
  const queryGrams = chineseBigrams(query);
  return candidates.map((candidate) => {
    const name = normalizedText(candidate.name);
    const searchText = normalizedText(candidateSearchText(candidate));
    const reasons = [];
    let score = 0;
    if (name === normalizedQuery) { score += 220; reasons.push('菜名完全匹配'); }
    else if (normalizedQuery.includes(name) && name.length >= 2) { score += 130; reasons.push('问题中点名菜品'); }
    else if (name.includes(normalizedQuery) && normalizedQuery.length >= 2) { score += 105; reasons.push('菜名匹配'); }

    const ingredientMatches = candidate.ingredients.filter((item) => includesTerm(query, item) || includesTerm(item, query));
    if (ingredientMatches.length) { score += 45 + ingredientMatches.length * 8; reasons.push(`食材匹配：${ingredientMatches.slice(0, 3).join('、')}`); }
    const tagMatches = candidate.tags.filter((item) => includesTerm(query, item));
    if (tagMatches.length) { score += 25 + tagMatches.length * 5; reasons.push(`标签匹配：${tagMatches.slice(0, 3).join('、')}`); }
    if (includesTerm(query, candidate.taste)) { score += 18; reasons.push(`口味匹配：${candidate.taste}`); }
    if (includesTerm(query, candidate.canteenName) || includesTerm(query, candidate.stallName)) { score += 30; reasons.push('位置匹配'); }

    if (queryGrams.length) {
      const overlap = queryGrams.filter((gram) => searchText.includes(gram)).length;
      score += (overlap / queryGrams.length) * 35;
    }
    return { id: candidate.id, score: Number(score.toFixed(4)), matchReasons: reasons };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((item, rank) => ({ ...item, rank }));
}

function exactRankDishes(query, candidates) {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return [];
  return candidates.map((candidate) => {
    let score = 0;
    if (normalizedText(candidate.name) === normalizedQuery) score = 3;
    else if (normalizedQuery.includes(normalizedText(candidate.name)) && normalizedText(candidate.name).length >= 2) score = 2;
    else if (candidate.ingredients.some((item) => normalizedQuery.includes(normalizedText(item)))) score = 1;
    return { id: candidate.id, score };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score);
}

/** Merge ranked lists using weighted Reciprocal Rank Fusion. */
export function reciprocalRankFusion(resultLists, { k = 60, weights = [] } = {}) {
  const fused = new Map();
  resultLists.forEach((list, listIndex) => {
    const weight = Number(weights[listIndex] ?? 1);
    list.forEach((item, rank) => {
      const id = String(item.id || item.dishId || item.sourceId || item.metadata?.dishId || '');
      if (!id) return;
      const current = fused.get(id) || { id, rrfScore: 0, sources: [] };
      current.rrfScore += weight / (k + rank + 1);
      current.sources.push(item.source || `list_${listIndex + 1}`);
      fused.set(id, current);
    });
  });
  return [...fused.values()].sort((left, right) => right.rrfScore - left.rrfScore || left.id.localeCompare(right.id));
}

function vegetarianConflict(candidate, vegan = false) {
  const text = normalizedText([...candidate.ingredients, ...candidate.tags, candidate.name].join(' '));
  const animal = /猪|牛|羊|鸡|鸭|鹅|鱼|虾|蟹|贝|肉|火腿|培根|海鲜/;
  const animalProduct = /蛋|奶|乳|芝士|黄油|蜂蜜/;
  return animal.test(text) || (vegan && animalProduct.test(text));
}

/** Apply database-truth hard constraints and report why rows were rejected. */
export function applyDishHardConstraints(candidates, filters = {}, { requireOrderable = false } = {}) {
  const rejections = {};
  const reject = (reason) => { rejections[reason] = (rejections[reason] || 0) + 1; return false; };
  const items = candidates.filter((candidate) => {
    const price = Number(candidate.availability?.price ?? candidate.price ?? 0);
    if (!isActiveDish(candidate)) return reject('status');
    if (filters.budgetMin != null && price < filters.budgetMin) return reject('budgetMin');
    if (filters.budgetMax != null && price > filters.budgetMax) return reject('budgetMax');
    if (filters.mealType && !candidate.mealTypes.includes(filters.mealType)) return reject('mealType');
    if (filters.halalOnly && !candidate.halal) return reject('halalOnly');
    if (filters.taste && filters.taste !== '不限' && candidate.taste !== filters.taste && !candidate.tags.some((tag) => includesTerm(tag, filters.taste))) return reject('taste');
    if (filters.canteenId && candidate.canteenId !== filters.canteenId) return reject('canteen');
    if (filters.primaryCanteenId && candidate.primaryCanteenId !== filters.primaryCanteenId && candidate.canteenId !== filters.primaryCanteenId) return reject('canteen');
    if (filters.canteenName && !includesTerm(candidate.canteenName, filters.canteenName)) return reject('canteen');
    if (filters.stallId && candidate.stallId !== filters.stallId) return reject('stall');
    if (filters.stallName && !includesTerm(candidate.stallName, filters.stallName)) return reject('stall');
    if (filters.tags?.length && !filters.tags.every((term) => candidate.tags.some((tag) => includesTerm(tag, term)))) return reject('tags');
    if (filters.includeIngredients?.length && !filters.includeIngredients.every((term) => candidate.ingredients.some((item) => includesTerm(item, term)))) return reject('includeIngredients');
    const safetyTerms = uniqueStrings(filters.avoidIngredients, filters.allergens);
    if (safetyTerms.some((term) => candidate.ingredients.some((item) => includesTerm(item, term)) || candidate.allergens.some((item) => includesTerm(item, term)))) return reject('safety');
    if (filters.dietaryPattern === 'vegetarian' && vegetarianConflict(candidate, false)) return reject('dietaryPattern');
    if (filters.dietaryPattern === 'vegan' && vegetarianConflict(candidate, true)) return reject('dietaryPattern');
    if (filters.minProtein != null && candidate.nutrition.protein < filters.minProtein) return reject('minProtein');
    if (filters.minFiber != null && candidate.fiber < filters.minFiber) return reject('minFiber');
    if (filters.maxCalories != null && candidate.nutrition.calories > filters.maxCalories) return reject('maxCalories');
    if (filters.maxFat != null && candidate.nutrition.fat > filters.maxFat) return reject('maxFat');
    if (filters.maxCarbs != null && candidate.nutrition.carbs > filters.maxCarbs) return reject('maxCarbs');
    if (filters.maxSodium != null && candidate.sodium > filters.maxSodium) return reject('maxSodium');
    if (filters.maxSugar != null && candidate.sugar > filters.maxSugar) return reject('maxSugar');
    if ((requireOrderable || filters.orderableOnly) && !candidate.availability?.orderable) return reject('orderable');
    return true;
  });
  return { items, rejections };
}

function relaxationSuggestions(rejections, filters, { lexicalMiss = false } = {}) {
  const suggestions = [];
  const add = (filter, message) => suggestions.push({ filter, message });
  if (rejections.orderable) add('orderableOnly', '当前时段没有可下单菜品，可查看其他餐次或稍后再试');
  if (rejections.budgetMax) add('budgetMax', `可将预算上限从 ${filters.budgetMax} 元适当提高`);
  if (rejections.mealType) add('mealType', '可切换早餐、午餐或晚餐范围');
  if (rejections.taste) add('taste', '可取消严格口味限制');
  if (rejections.canteen || rejections.stall) add('location', '可扩大到其他食堂或档口');
  if (rejections.halalOnly) add('halalOnly', '当前范围没有满足清真条件的菜品，请更换食堂或餐次');
  if (rejections.safety) add('safety', '未找到同时满足全部忌口条件的菜品，请人工确认可替代食材，系统不会自动放宽过敏原约束');
  if (rejections.minProtein || rejections.minFiber || rejections.maxCalories || rejections.maxFat || rejections.maxSodium || rejections.maxSugar) add('nutrition', '可适当放宽营养阈值');
  if (lexicalMiss) add('query', '可改用菜名、主要食材、口味或档口名称查询');
  return suggestions.slice(0, 5);
}

function semanticId(result) {
  return String(result.dishId || result.sourceId || result.metadata?.dishId || result.id || '');
}

async function runSemanticSearch(semanticSearch, { query, tenantId, candidateIds, limit }) {
  if (!semanticSearch || !query) return { results: [], used: false, degradedReasons: [] };
  try {
    const allowed = new Set(candidateIds);
    const raw = await semanticSearch({ query, tenantId, limit, candidateIds, sourceType: 'dish' });
    const results = (Array.isArray(raw) ? raw : raw?.items || raw?.results || [])
      .filter((item) => !item.sourceType || item.sourceType === 'dish')
      .map((item) => ({ id: semanticId(item), score: Number(item.score ?? item.similarity ?? 0), source: 'semantic' }))
      .filter((item) => item.id && allowed.has(item.id))
      .sort((left, right) => right.score - left.score);
    const degradedReasons = (raw?.warnings || []).map((warning) => `${warning.code || 'retrieval_warning'}:${warning.message || 'degraded'}`);
    const vectorEnabled = !raw?.meta?.retrievalModes || raw.meta.retrievalModes.includes('vector');
    return { results, used: vectorEnabled && results.length > 0, degradedReasons };
  } catch (error) {
    return { results: [], used: false, degradedReasons: [`semantic_search_failed:${error?.message || 'unknown'}`] };
  }
}

function sortSearchItems(items, sort) {
  if (sort === 'price_asc') return items.sort((a, b) => a.availability.price - b.availability.price || b.retrievalScore - a.retrievalScore);
  if (sort === 'price_desc') return items.sort((a, b) => b.availability.price - a.availability.price || b.retrievalScore - a.retrievalScore);
  if (sort === 'rating') return items.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
  if (sort === 'sales') return items.sort((a, b) => b.sales - a.sales || b.rating - a.rating);
  return items.sort((a, b) => b.retrievalScore - a.retrievalScore || Number(b.availability.orderable) - Number(a.availability.orderable) || b.rating - a.rating);
}

function executionContext(context, nowProvider, requestedMealType) {
  const clock = localDateAndTime(context.now || nowProvider());
  return {
    date: String(context.date || clock.date),
    time: String(context.time || clock.time),
    mealType: requestedMealType || context.mealType || inferCurrentMeal(clock.hour)
  };
}

/** Execute catalog search with hard filters, lexical/exact/semantic retrieval and RRF. */
export async function runDishSearchWorkflow(input = {}, dependencies = {}) {
  const request = parseDishSearchRequest(input);
  const nowProvider = dependencies.now || (() => new Date());
  const exec = executionContext(request.context, nowProvider, request.filters.mealType);
  const sourceCandidates = request.candidates
    ? request.candidates.map((item) => mapCandidate(item, request.tenantId))
    : await loadCandidatesFromDatabase(dependencies.db, request.tenantId, exec);
  const candidates = sourceCandidates
    .filter((candidate) => candidate.id && candidate.tenantId === request.tenantId && isActiveDish(candidate))
    .map((candidate) => ({ ...candidate, availability: deriveAvailability(candidate, exec) }));
  const interpretationWarnings = [];
  let llmSupplementUsed = false;
  const preliminaryExact = exactRankDishes(request.query, candidates);
  const preliminaryLexical = lexicalRankDishes(request.query, candidates);
  const shouldInterpret = Boolean(request.query)
    && request.interpreted.detected.length === 0
    && preliminaryExact.length === 0
    && preliminaryLexical.length === 0;
  if (shouldInterpret && dependencies.interpretQuery) {
    try {
      const supplementResult = await dependencies.interpretQuery({ query: request.query, tenantId: request.tenantId });
      if (supplementResult?.warning) interpretationWarnings.push(supplementResult.warning);
      const supplement = supplementResult?.filters || supplementResult || {};
      const parsedSupplement = filtersSchema.safeParse(supplement);
      if (!parsedSupplement.success) {
        interpretationWarnings.push({ code: 'QUERY_INTERPRETATION_INVALID', message: '语义补充结果未通过参数校验，已忽略。' });
      } else {
        const merged = mergeFilters(parsedSupplement.data, request.filters);
        if (merged.budgetMin != null && merged.budgetMax != null && merged.budgetMin > merged.budgetMax) {
          interpretationWarnings.push({ code: 'QUERY_INTERPRETATION_INVALID', message: '语义补充产生了无效预算范围，已忽略。' });
        } else {
          const supplementKeys = Object.keys(parsedSupplement.data).filter((key) => parsedSupplement.data[key] !== undefined);
          if (supplementKeys.length) {
            request.filters = merged;
            request.interpreted.filters = merged;
            request.interpreted.detected = [...new Set([...request.interpreted.detected, 'llmSupplement'])];
            llmSupplementUsed = true;
          }
        }
      }
    } catch (error) {
      interpretationWarnings.push({ code: 'QUERY_INTERPRETATION_FAILED', message: `语义补充不可用，已降级：${error?.message || 'unknown'}` });
    }
  }
  const constrained = applyDishHardConstraints(candidates, request.filters);
  const lexical = lexicalRankDishes(request.query, constrained.items);
  const exact = exactRankDishes(request.query, constrained.items).map((item) => ({ ...item, source: 'exact' }));
  const semantic = await runSemanticSearch(dependencies.semanticSearch, {
    query: request.query,
    tenantId: request.tenantId,
    candidateIds: constrained.items.map((item) => item.id),
    limit: Math.max(request.limit * 3, 30)
  });
  const structuredOnly = request.interpreted.detected.length > 0 || !request.query;
  const baseline = structuredOnly
    ? [...constrained.items].sort((a, b) => Number(b.availability.orderable) - Number(a.availability.orderable) || b.rating - a.rating).map((item) => ({ id: item.id, source: 'baseline' }))
    : [];
  const fused = reciprocalRankFusion([exact, lexical.map((item) => ({ ...item, source: 'lexical' })), semantic.results, baseline], { weights: [2.4, 1.5, 1.2, 0.25] });
  const byId = new Map(constrained.items.map((candidate) => [candidate.id, candidate]));
  const lexicalById = new Map(lexical.map((item) => [item.id, item]));
  const semanticById = new Map(semantic.results.map((item) => [item.id, item.score]));
  const ranked = fused.map((entry) => {
    const candidate = byId.get(entry.id);
    if (!candidate) return null;
    const exactBoost = exact.findIndex((item) => item.id === entry.id);
    const availabilityBoost = candidate.availability.orderable ? 0.02 : 0;
    const retrievalScore = entry.rrfScore + availabilityBoost + (exactBoost === 0 ? 0.03 : 0) + Math.max(0, semanticById.get(entry.id) || 0) * 0.01;
    const matchReasons = uniqueStrings(
      lexicalById.get(entry.id)?.matchReasons,
      semanticById.has(entry.id) ? ['语义相关'] : [],
      candidate.availability.orderable ? ['当前可下单'] : []
    );
    return { ...publicCandidate(candidate), availability: candidate.availability, matchReasons, retrievalScore: Number(retrievalScore.toFixed(6)) };
  }).filter(Boolean);
  sortSearchItems(ranked, request.sort);
  const pageItems = ranked.slice(request.offset, request.offset + request.limit);
  const lexicalMiss = Boolean(request.query) && !request.interpreted.detected.length && !exact.length && !lexical.length && !semantic.results.length;
  return {
    interpreted: request.interpreted,
    items: pageItems,
    warnings: interpretationWarnings,
    availability: {
      orderableCount: ranked.filter((item) => item.availability.orderable).length,
      totalCount: ranked.length,
      date: exec.date,
      mealType: exec.mealType,
      asOf: `${exec.date}T${exec.time}`
    },
    matchReasons: Object.fromEntries(pageItems.map((item) => [item.id, item.matchReasons])),
    suggestedRelaxations: ranked.length ? [] : relaxationSuggestions(constrained.rejections, request.filters, { lexicalMiss }),
    page: { limit: request.limit, offset: request.offset, total: ranked.length, hasMore: request.offset + pageItems.length < ranked.length },
    meta: {
      tenantId: request.tenantId,
      retrieval: ['exact', 'lexical', ...(semantic.used ? ['semantic'] : []), ...(baseline.length ? ['baseline'] : [])],
      semanticUsed: semantic.used,
      llmSupplementUsed,
      degradedReasons: semantic.degradedReasons,
      sourceCandidateCount: candidates.length,
      filteredCandidateCount: constrained.items.length,
      date: exec.date,
      mealType: exec.mealType,
      indexVersion: dependencies.indexVersion || null
    }
  };
}

function recommendationFilters(queryFilters, profile, options) {
  const explicitTaste = queryFilters.taste;
  return {
    budgetMax: queryFilters.budgetMax ?? profile.budgetMax,
    budgetMin: queryFilters.budgetMin,
    mealType: queryFilters.mealType || profile.mealType,
    halalOnly: Boolean(queryFilters.halalOnly || profile.halalOnly),
    avoidIngredients: uniqueStrings(profile.avoid, queryFilters.avoidIngredients),
    allergens: uniqueStrings(profile.allergies, queryFilters.allergens),
    dietaryPattern: queryFilters.dietaryPattern || profile.dietaryPattern,
    taste: explicitTaste || (options.strictTaste && profile.taste !== '不限' ? profile.taste : undefined),
    minProtein: queryFilters.minProtein,
    minFiber: queryFilters.minFiber,
    maxCalories: queryFilters.maxCalories,
    maxFat: queryFilters.maxFat,
    maxCarbs: queryFilters.maxCarbs,
    maxSodium: queryFilters.maxSodium,
    maxSugar: queryFilters.maxSugar
  };
}

function preferenceFor(preferences, dishId) {
  return preferences.find((item) => (item.dishId || item.dish_id) === dishId) || null;
}

function scoreRecommendation(candidate, { profile, context, semanticScore = 0 }) {
  const nutrition = candidate.nutrition;
  const breakdown = {};
  const why = [];
  let goalScore = 0;
  if (profile.goal === 'fatLoss') {
    goalScore = nutrition.protein * 1.8 - nutrition.calories * 0.025 - nutrition.fat * 1.1;
    why.push('符合减脂时优先高蛋白、低热量和低脂的原则');
  } else if (profile.goal === 'muscleGain') {
    goalScore = nutrition.protein * 2.2 + nutrition.carbs * 0.25 + nutrition.calories * 0.008;
    why.push('蛋白质和碳水结构适合增肌恢复');
  } else if (profile.goal === 'maintain') {
    goalScore = nutrition.protein * 1.3 - Math.abs(nutrition.calories - 520) * 0.025 - Math.abs(nutrition.fat - 16) * 0.5;
    why.push('热量和蛋白质较均衡');
  } else {
    goalScore = new Set([...candidate.ingredients, ...candidate.tags]).size * 2 + nutrition.protein - nutrition.fat * 0.6;
    why.push('食材多样且营养结构较均衡');
  }
  breakdown.goal = goalScore;

  breakdown.rating = candidate.rating * 7 + Math.log10(candidate.reviewCount + 1) * 5;
  breakdown.budget = Math.max(0, Number(profile.budgetMax || 20) - candidate.availability.price) * 0.7;
  breakdown.taste = profile.taste && profile.taste !== '不限' && (candidate.taste === profile.taste || candidate.tags.includes(profile.taste)) ? 9 : 0;
  if (breakdown.taste) why.push(`匹配偏好口味：${profile.taste}`);

  const temperature = Number(context.environment?.temperature ?? context.temperature ?? 25);
  const weatherText = normalizedText([...candidate.tags, candidate.description].join(' '));
  breakdown.weather = temperature >= 30 && /清爽|消暑|凉|冷/.test(weatherText) ? 7 : temperature <= 10 && /暖胃|热汤|炖/.test(weatherText) ? 6 : 0;
  if (breakdown.weather) why.push(`适合当前 ${temperature}°C 的天气`);

  breakdown.crowd = profile.preferLowCrowd ? Math.max(0, 100 - candidate.crowdLevel) * 0.12 : 0;
  if (breakdown.crowd >= 6) why.push(`${candidate.canteenName || '所在食堂'}当前相对不拥挤`);

  const preference = preferenceFor(context.preferences || [], candidate.id);
  let preferenceScore = 0;
  if (preference) {
    if (preference.favorite) { preferenceScore += 12; why.push('已收藏'); }
    preferenceScore += Math.min(Number(preference.eatenCount ?? preference.eaten_count ?? 0), 10) * 0.5;
    const fatigue = Math.max(0, Number(preference.drawnCount ?? preference.drawn_count ?? 0) - Number(preference.eatenCount ?? preference.eaten_count ?? 0) * 1.5);
    preferenceScore -= Math.min(fatigue, 10) * 0.5;
  }
  breakdown.preference = preferenceScore;

  let nutritionFocusScore = 0;
  if (profile.nutritionFocus.includes('highProtein') && nutrition.protein >= 30) { nutritionFocusScore += 8; why.push('高蛋白匹配'); }
  if (profile.nutritionFocus.includes('highFiber') && candidate.fiber >= 3) { nutritionFocusScore += 6; why.push('高纤维匹配'); }
  if (profile.nutritionFocus.includes('lowSodium') && candidate.sodium < 500) { nutritionFocusScore += 5; why.push('低钠匹配'); }
  if (profile.nutritionFocus.includes('lowSugar') && candidate.sugar < 5) { nutritionFocusScore += 5; why.push('低糖匹配'); }
  if (profile.nutritionFocus.includes('calcium') && candidate.calcium >= 100) { nutritionFocusScore += 5; why.push('高钙匹配'); }
  if (profile.nutritionFocus.includes('iron') && candidate.iron >= 3) { nutritionFocusScore += 5; why.push('高铁匹配'); }
  breakdown.nutritionFocus = nutritionFocusScore;

  const dishSpiceLevel = candidate.taste.includes('麻辣') ? 5 : candidate.taste.includes('辣') ? 4 : candidate.taste.includes('微辣') ? 3 : 1;
  const spiceDistance = Math.abs(Number(profile.spiceLevel || 3) - dishSpiceLevel);
  breakdown.spice = -spiceDistance * 2.5;
  if (spiceDistance === 0) why.push('辣度匹配');

  const favoriteMatches = candidate.tags.filter((tag) => profile.favoriteTags.includes(tag));
  breakdown.tags = favoriteMatches.length * 4;
  if (favoriteMatches.length) why.push(`匹配标签：${favoriteMatches.join('、')}`);

  const timeOfDay = context.timeOfDay;
  breakdown.timeBonus = timeOfDay && candidate.mealTypes.includes(timeOfDay)
    ? (timeOfDay === 'breakfast' ? 5 : 3)
    : 0;
  breakdown.semantic = Math.max(0, semanticScore) * 30;
  if (semanticScore > 0) why.push('与本次需求语义相关');
  breakdown.supply = candidate.availability.status === 'limited' ? -2 : 0;

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    ...publicCandidate(candidate),
    availability: candidate.availability,
    recommendationScore: Number(total.toFixed(2)),
    contextualScore: Number(total.toFixed(2)),
    scoreBreakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Number(value.toFixed(2))])),
    why: uniqueStrings(why).slice(0, 5)
  };
}

function mealTotals(dishes) {
  return dishes.reduce((totals, dish) => ({
    price: totals.price + Number(dish.availability?.price ?? dish.price ?? 0),
    calories: totals.calories + Number(dish.nutrition?.calories || 0),
    protein: totals.protein + Number(dish.nutrition?.protein || 0),
    fat: totals.fat + Number(dish.nutrition?.fat || 0),
    carbs: totals.carbs + Number(dish.nutrition?.carbs || 0)
  }), { price: 0, calories: 0, protein: 0, fat: 0, carbs: 0 });
}

function bestCombination(ranked, budget, targetSize) {
  const pool = ranked.slice(0, 18);
  let best = null;
  const visit = (start, selected) => {
    if (selected.length >= 2) {
      const totals = mealTotals(selected);
      if (totals.price <= budget) {
        const diversity = new Set(selected.flatMap((dish) => dish.tags || [])).size * 1.5;
        const score = selected.reduce((sum, dish) => sum + dish.recommendationScore, 0) + diversity;
        if (!best || selected.length > best.dishes.length || (selected.length === best.dishes.length && score > best.score)) best = { dishes: [...selected], totals, score };
      }
    }
    if (selected.length >= targetSize) return;
    for (let index = start; index < pool.length; index += 1) {
      const next = pool[index];
      const nextPrice = mealTotals([...selected, next]).price;
      if (nextPrice <= budget) visit(index + 1, [...selected, next]);
    }
  };
  visit(0, []);
  return best;
}

function normalizeKnowledgeResults(results = []) {
  return results.filter((item) => !item.sourceType || item.sourceType !== 'dish').map((item) => ({
    id: item.id || item.sourceId,
    sourceId: item.sourceId || item.id,
    sourceType: item.sourceType || 'knowledge',
    title: item.title || item.name || '健康知识',
    snippet: item.snippet || String(item.content || '').slice(0, 180),
    score: Number(item.score ?? item.similarity ?? 0),
    metadata: item.metadata || {}
  }));
}

/** Produce a grounded deterministic knowledge answer; callers may replace only the prose with an LLM. */
export function buildKnowledgeAnswer({ query = '', results = [] } = {}) {
  const citations = normalizeKnowledgeResults(results);
  if (!citations.length) return { answer: '当前没有检索到可引用的健康知识，推荐结果仅依据实时菜品数据和用户约束生成。', citations: [] };
  return {
    answer: `关于“${String(query).slice(0, 80)}”，已检索到 ${citations.slice(0, 3).map((item) => item.title).join('、')} 等依据；健康知识仅用于解释，不覆盖过敏原、价格、库存和供应状态。`,
    citations
  };
}

async function retrieveKnowledge(knowledgeSearch, request) {
  if (!knowledgeSearch || !request.query) return { results: [], degradedReasons: [] };
  try {
    const raw = await knowledgeSearch({ query: request.query, tenantId: request.tenantId, limit: 5, sourceTypes: ['health', 'knowledge'] });
    return {
      results: normalizeKnowledgeResults(Array.isArray(raw) ? raw : raw?.items || raw?.results || []),
      degradedReasons: (raw?.warnings || []).map((warning) => `${warning.code || 'retrieval_warning'}:${warning.message || 'degraded'}`)
    };
  } catch (error) {
    return { results: [], degradedReasons: [`knowledge_search_failed:${error?.message || 'unknown'}`] };
  }
}

/** Execute personalized recommendation over current, published and orderable menu candidates. */
export async function runMealRecommendationWorkflow(input = {}, dependencies = {}) {
  const parsed = recommendationRequestSchema.safeParse(input || {});
  if (!parsed.success) throw validationError(parsed);
  const request = {
    ...parsed.data,
    options: {
      limit: 3,
      combinationSize: 3,
      requireOrderable: true,
      strictTaste: false,
      ...(parsed.data.options || {})
    }
  };
  const inferred = inferQueryFilters(request.query);
  const inferredProfile = inferRecommendationProfile(request.query);
  const profile = normalizeProfile({ ...request.profile, ...inferredProfile.profile, ...request.profileOverride });
  const filters = recommendationFilters(inferred.filters, profile, request.options);
  const mode = request.options.mode || (/搭配|套餐|组合|一荤一素|配餐/.test(request.query) ? 'combination' : 'alternatives');
  const nowProvider = dependencies.now || (() => new Date());
  const exec = executionContext(request.context, nowProvider, filters.mealType);
  const sourceCandidates = request.candidates
    ? request.candidates.map((item) => mapCandidate(item, request.tenantId))
    : await loadCandidatesFromDatabase(dependencies.db, request.tenantId, exec);
  const candidates = sourceCandidates
    .filter((candidate) => candidate.id && candidate.tenantId === request.tenantId && isActiveDish(candidate))
    .map((candidate) => ({ ...candidate, availability: deriveAvailability(candidate, exec) }));
  const hard = applyDishHardConstraints(candidates, filters, { requireOrderable: request.options.requireOrderable });
  const semanticPromise = runSemanticSearch(dependencies.semanticSearch, {
    query: request.query,
    tenantId: request.tenantId,
    candidateIds: hard.items.map((item) => item.id),
    limit: 30
  });
  const knowledgePromise = retrieveKnowledge(dependencies.knowledgeSearch, request);
  const [semantic, knowledge] = await Promise.all([semanticPromise, knowledgePromise]);
  const semanticScores = new Map(semantic.results.map((item) => [item.id, item.score]));
  let source = 'menu';
  let warnings = [];
  let pool = hard.items;
  let fallbackRejections = hard.rejections;

  if (!pool.length && request.options.requireOrderable) {
    const fallback = applyDishHardConstraints(candidates, filters, { requireOrderable: false });
    pool = fallback.items;
    fallbackRejections = fallback.rejections;
    source = 'catalog_fallback';
    warnings.push({ code: 'NO_ORDERABLE_MENU', message: '当前没有满足条件且可下单的菜单菜品，以下仅为菜品库参考。' });
  }

  const ranked = pool.map((candidate) => scoreRecommendation(candidate, {
    profile: { ...profile, budgetMax: filters.budgetMax ?? profile.budgetMax },
    context: request.context,
    semanticScore: semanticScores.get(candidate.id) || 0
  })).sort((left, right) => right.recommendationScore - left.recommendationScore || right.rating - left.rating);

  let recommendations;
  let mealPlan;
  if (mode === 'combination') {
    const combination = bestCombination(ranked, Number(filters.budgetMax ?? profile.budgetMax), request.options.combinationSize);
    recommendations = combination?.dishes || [];
    mealPlan = {
      mode: 'combination',
      budgetMax: Number(filters.budgetMax ?? profile.budgetMax),
      dishes: recommendations,
      totals: combination ? Object.fromEntries(Object.entries(combination.totals).map(([key, value]) => [key, Number(value.toFixed(2))])) : mealTotals([])
    };
    if (!combination && ranked.length) warnings.push({ code: 'NO_COMBINATION_WITHIN_BUDGET', message: '候选菜品均满足单品预算，但无法在总预算内组成至少两道菜的搭配。' });
  } else {
    recommendations = ranked.slice(0, request.options.limit);
    mealPlan = {
      mode: 'alternatives',
      options: recommendations.map((dish) => ({ dishId: dish.id, name: dish.name, price: dish.availability.price, orderable: dish.availability.orderable }))
    };
  }

  const dishEvidence = recommendations.map((dish) => ({
    id: `dish:${request.tenantId}:${dish.id}`,
    sourceId: dish.id,
    sourceType: 'dish',
    title: dish.name,
    snippet: `${dish.canteenName || '食堂'} · ${dish.stallName || '档口'} · ¥${dish.availability.price} · ${dish.availability.status}`,
    score: dish.recommendationScore,
    metadata: { tenantId: request.tenantId, orderable: dish.availability.orderable, menuItemId: dish.availability.menuItemId }
  }));
  const noResults = recommendations.length === 0;
  const suggestedRelaxations = noResults ? relaxationSuggestions({ ...fallbackRejections, ...hard.rejections }, filters) : [];
  const degradedReasons = [...semantic.degradedReasons, ...knowledge.degradedReasons];
  const quotaExhausted = degradedReasons.some((reason) => reason.startsWith('AI_QUOTA_EXHAUSTED:'));
  if (quotaExhausted) warnings = [...warnings, { code: 'AI_QUOTA_EXHAUSTED', message: 'AI 额度已用完，已使用规则和词法检索返回结果。' }];
  if (degradedReasons.length) warnings = [...warnings, { code: 'RETRIEVAL_DEGRADED', message: '部分语义或知识检索不可用，已使用规则和词法能力降级。' }];

  return {
    recommendations,
    mealPlan,
    evidence: { dishes: dishEvidence, knowledge: knowledge.results },
    warnings,
    suggestedRelaxations,
    meta: {
      tenantId: request.tenantId,
      mode,
      source,
      orderable: source === 'menu',
      semanticUsed: semantic.used,
      quotaExhausted,
      degradedReasons,
      sourceCandidateCount: candidates.length,
      eligibleCandidateCount: ranked.length,
      date: exec.date,
      mealType: exec.mealType,
      profile,
      interpreted: { query: request.query, filters, detected: [...new Set([...inferred.detected, ...inferredProfile.detected])] },
      indexVersion: dependencies.indexVersion || null
    }
  };
}

/** Bound service facade for app/agent wiring. */
export function createRetrievalService(dependencies = {}) {
  return {
    parseDishSearchRequest,
    searchDishes: (input) => runDishSearchWorkflow(input, dependencies),
    recommendMeals: (input) => runMealRecommendationWorkflow(input, dependencies),
    buildKnowledgeAnswer
  };
}
