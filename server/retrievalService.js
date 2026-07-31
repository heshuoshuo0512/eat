import { z } from 'zod';
import { normalizeProfile } from '../src/domain/recommendation.js';
import { deriveDishSemanticLabels, interpretCampusDiningQuery } from './campusDiningKnowledgeBase.js';
import { buildDishFacts, dishDataQuality, evaluateDishSafety, retrievalConfidence } from './diningFacts.js';
import { parseStructuredDiningQuery } from './queryUnderstanding.js';
import { businessDateTime } from './time.js';
import { budgetPriceForDish, normalizeDishPricing } from './dishPricing.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'sales'];
const PUBLIC_CATALOG_ITEM_TYPES = ['meal', 'snack', 'beverage'];
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
  itemType: z.enum(PUBLIC_CATALOG_ITEM_TYPES).optional(),
  catalogCategory: z.string().trim().min(1).max(80).optional(),
  catalogCategories: listSchema.optional(),
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
  dietaryPattern: z.enum(['unrestricted', 'balanced', 'pescatarian', 'vegetarian', 'vegan']).optional(),
  minProtein: optionalNumber(0, 1000),
  minFiber: optionalNumber(0, 1000),
  maxCalories: optionalNumber(0, 10000),
  maxFat: optionalNumber(0, 1000),
  maxCarbs: optionalNumber(0, 2000),
  maxSodium: optionalNumber(0, 100000),
  maxSugar: optionalNumber(0, 1000),
  minSpiceLevel: optionalNumber(0, 5),
  maxSpiceLevel: optionalNumber(0, 5),
  orderableOnly: z.coerce.boolean().optional(),
  preferLowCrowd: z.coerce.boolean().optional()
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
  const name = String(candidate?.name || '').replace(/^\s*\d+\s*[.、]\s*/u, '').trim();
  const itemType = String(candidate?.catalogItemType || candidate?.catalog_item_type || 'meal');
  const reviewStatus = String(candidate?.reviewStatus || candidate?.review_status || 'approved');
  return candidate?.status === 'active'
    && reviewStatus === 'approved'
    && !['addon', 'fee', 'variant', 'section'].includes(itemType)
    && !/^(?:\d+\s*[-~至‐‑–—]\s*\d+|\d+|单|双|多)\s*人份$/u.test(name);
}

function isMealCandidate(candidate) {
  return isActiveDish(candidate)
    && String(candidate?.catalogItemType || candidate?.catalog_item_type || 'meal') === 'meal';
}

function extractListAfter(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) return [];
  return match[1]
    .split(/[，,、;；和及与\s]+/)
    .map((item) => item.replace(/(?:的菜|食材|食品|菜品|都)?(?:过敏|不吃|不要|忌口)?$/g, '').trim())
    .filter((item) => item.length >= 1 && item.length <= 20);
}

function looksLikeNamedDishLookup(text) {
  return /(?:(?:帮我找|整点|来一份|来份|想吃|想来份|有没有|有木有|还有).{1,28}(?:饭|面|粉|粥|汤|饼|套餐|三明治|沙拉|水饺|饺子|馄饨|包子|虾|鸡|鸭|肉|菜)(?:吗|么|呢)?|(?:饭|面|粉|粥|汤|饼|套餐|三明治|沙拉|水饺|饺子|馄饨|包子).{0,8}(?:有吗|有没有|有木有|在哪))/u.test(text);
}

function inferQueryFilters(query) {
  const text = String(query || '').trim();
  const namedDishLookup = looksLikeNamedDishLookup(text);
  const structured = parseStructuredDiningQuery(text);
  const inferred = { ...structured.filters };
  let detected = [...structured.detected];
  if (namedDishLookup && inferred.includeIngredients?.length) {
    delete inferred.includeIngredients;
    detected = detected.filter((field) => field !== 'includeIngredients');
  }

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:到|至|[-~～])\s*(\d+(?:\.\d+)?)\s*元?/);
  const max = text.match(/(?:预算|价格)\s*(?:(?:改成|调整到|设为|变成)\s*)?(?:不超过|不高于|最多|低于|少于)?\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元?|(?:不超过|不高于|最多|低于|少于)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元|(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元\s*(?:内|以内|以下)/);
  const min = text.match(/(?:预算|价格)\s*(?:至少|不低于|最低)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元?|(?:至少|不低于|最低)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元|(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*元\s*(?:以上|起)/);
  if (range) {
    inferred.budgetMin = Math.min(Number(range[1]), Number(range[2]));
    inferred.budgetMax = Math.max(Number(range[1]), Number(range[2]));
    detected.push('budgetRange');
  } else {
    const maxValue = max && Number(max[1] || max[2] || max[3]);
    const minValue = min && Number(min[1] || min[2] || min[3]);
    if (Number.isFinite(maxValue)) { inferred.budgetMax = maxValue; detected.push('budgetMax'); }
    if (Number.isFinite(minValue)) { inferred.budgetMin = minValue; detected.push('budgetMin'); }
  }

  if (/早餐|早饭|早点|早八/.test(text)) { inferred.mealType = 'breakfast'; detected.push('mealType'); }
  else if (/晚餐|晚饭|夜宵|晚上\s*[八九十]?点/.test(text)) { inferred.mealType = 'dinner'; detected.push('mealType'); }
  else if (/午餐|午饭|中饭/.test(text)) { inferred.mealType = 'lunch'; detected.push('mealType'); }

  if (/清真/.test(text)) { inferred.halalOnly = true; detected.push('halalOnly'); }
  if (/(?:当前|现在|今天).{0,4}(?:能点|可点|有供应|可供应|有货|可下单)|(?:只看|只要|仅看|仅要).{0,6}(?:有供应|可供应|有货|可下单)|不要售罄|别要售罄|少排队|排队少|等待时间.{0,2}短|容易买到/.test(text)) { inferred.orderableOnly = true; detected.push('orderableOnly'); }
  if (/少排队|排队少|低拥挤|人少|等待时间.{0,2}短/.test(text)) { inferred.preferLowCrowd = true; detected.push('preferLowCrowd'); }
  if (/纯素|全素|vegan/i.test(text)) { inferred.dietaryPattern = 'vegan'; detected.push('dietaryPattern'); }
  else if (/素食|vegetarian/i.test(text)) { inferred.dietaryPattern = 'vegetarian'; detected.push('dietaryPattern'); }

  const taste = !namedDishLookup && TASTE_WORDS.find((word) => text.includes(word));
  if (taste) { inferred.taste = taste; detected.push('taste'); }

  if (!namedDishLookup && /高蛋白|蛋白质多/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.highProtein);
  if (!namedDishLookup && /高纤维|膳食纤维多/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.highFiber);
  if (!namedDishLookup && /低卡|低热量|热量低/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowCalorie);
  if (!namedDishLookup && /低脂|少油|脂肪低/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowFat);
  if (!namedDishLookup && /低钠|少盐/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowSodium);
  if (!namedDishLookup && /低糖|少糖/.test(text)) Object.assign(inferred, NUTRITION_DEFAULTS.lowSugar);
  if (Object.keys(inferred).some((key) => /^(min|max)(Protein|Fiber|Calories|Fat|Sodium|Sugar)$/.test(key))) detected.push('nutrition');

  return { filters: inferred, detected: [...new Set(detected)], structured };
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
  const source = typeof input === 'string' ? { query: input } : { ...(input || {}) };
  const raw = {
    ...source,
    filters: {
      ...(source.filters || {}),
      ...(source.itemType != null ? { itemType: source.itemType } : {}),
      ...(source.catalogCategory != null ? { catalogCategory: source.catalogCategory } : {}),
      ...(source.catalogCategories != null ? { catalogCategories: source.catalogCategories } : {}),
    },
  };
  const parsed = searchRequestSchema.safeParse(raw || {});
  if (!parsed.success) throw validationError(parsed);
  const query = parsed.data.query || parsed.data.filters?.keyword || '';
  const explicitFilters = { ...(parsed.data.filters || {}) };
  const partitionInferred = explicitFilters.itemType == null;
  explicitFilters.itemType ||= 'meal';
  explicitFilters.catalogCategories = uniqueStrings(explicitFilters.catalogCategory, explicitFilters.catalogCategories);
  if (!explicitFilters.catalogCategories.length) delete explicitFilters.catalogCategories;
  delete explicitFilters.catalogCategory;
  if (explicitFilters.budgetMax == null && explicitFilters.maxPrice != null) explicitFilters.budgetMax = explicitFilters.maxPrice;
  delete explicitFilters.keyword;
  delete explicitFilters.maxPrice;
  const inferred = inferQueryFilters(query);
  const campus = interpretCampusDiningQuery(query);
  const conceptHardFilters = looksLikeNamedDishLookup(query) ? {} : campus.hardFilters;
  const filters = mergeFilters(mergeFilters(conceptHardFilters, inferred.filters), explicitFilters);
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
      hardConstraints: filters,
      detected: inferred.detected,
      constraints: inferred.structured.constraints,
      conflicts: inferred.structured.conflicts,
      pendingConfirmations: inferred.structured.pendingConfirmations,
      parserVersion: inferred.structured.parserVersion,
      sort: parsed.data.sort,
      concepts: campus.concepts,
      conceptIds: campus.conceptIds,
      softSignals: campus.softSignals,
      expandedTerms: campus.expandedTerms,
      ruleVersion: campus.ruleVersion,
    },
    partition: {
      itemType: filters.itemType || 'meal',
      categories: filters.catalogCategories || [],
      inferred: partitionInferred,
    },
  };
}

/** Merge explicit conversation turns while keeping declared safety constraints sticky. */
export function mergeDiningConversationState(previous = {}, query = '') {
  const prior = previous?.filters || previous || {};
  const parsed = parseDishSearchRequest({ query: String(query || '') });
  const current = parsed.filters;
  const filters = { ...prior, ...current };
  filters.allergens = uniqueStrings(prior.allergens, current.allergens);
  filters.avoidIngredients = uniqueStrings(prior.avoidIngredients, current.avoidIngredients);
  filters.includeIngredients = uniqueStrings(prior.includeIngredients, current.includeIngredients);
  if (!filters.allergens.length) delete filters.allergens;
  if (!filters.avoidIngredients.length) delete filters.avoidIngredients;
  if (!filters.includeIngredients.length) delete filters.includeIngredients;
  if (prior.halalOnly) filters.halalOnly = true;

  const text = String(query || '');
  const relativeBudget = text.match(/(?:预算)?\s*(?:可以)?\s*(?:提高|增加|加)\s*(\d+(?:\.\d+)?)\s*元?/);
  if (relativeBudget && Number.isFinite(Number(prior.budgetMax))) {
    filters.budgetMax = Number(prior.budgetMax) + Number(relativeBudget[1]);
  }
  if (/(?:口味不限|不限制口味|撤销口味偏好)/.test(text)) delete filters.taste;
  if (/(?:可以|能接受|来点|稍微|有点)辣/.test(text)) {
    delete filters.taste;
    delete filters.maxSpiceLevel;
  }

  const attemptedSafetyRemoval = asSafetyRemoval(text, filters.allergens || []);
  const conflicts = [...parsed.interpreted.conflicts];
  const pendingConfirmations = [...parsed.interpreted.pendingConfirmations];
  if (attemptedSafetyRemoval.length) {
    conflicts.push({
      code: 'SAFETY_CONSTRAINT_REMOVAL_REJECTED',
      fields: ['allergens'],
      values: attemptedSafetyRemoval,
      message: `本轮不会撤销已声明过敏原：${attemptedSafetyRemoval.join('、')}。请在健康档案中明确修改后再重试。`,
    });
    pendingConfirmations.push({ code: 'CONFIRM_PROFILE_SAFETY_CHANGE', message: '过敏原只能通过明确的健康档案修改流程撤销。' });
  }

  return {
    filters,
    interpreted: {
      ...parsed.interpreted,
      filters,
      hardConstraints: filters,
      conflicts,
      pendingConfirmations,
      conversationMerged: true,
    },
  };
}

function asSafetyRemoval(text, allergens) {
  if (/(?:不能|不可|别)\s*(?:忽略|取消|撤销).{0,8}(?:过敏|忌口)/.test(text)) return [];
  if (!/(?:忽略|取消|撤销|不用管|不算).{0,8}(?:过敏|忌口)/.test(text)) return [];
  return allergens.filter((allergen) => text.includes(allergen) || !/[\u4e00-\u9fff]/.test(allergen));
}

function mapCandidate(raw, tenantId) {
  const nutrition = raw.nutrition || {};
  const menuItem = raw.menuItem || raw.menu_item || null;
  const explicitAvailability = raw.availability && typeof raw.availability === 'object' ? raw.availability : null;
  const pricing = normalizeDishPricing({
    pricingMode: raw.pricingMode ?? raw.pricing_mode,
    priceDisplay: raw.priceDisplay ?? raw.price_display,
    pricing: raw.pricing ?? raw.pricing_json,
  }, raw.price);
  const candidate = {
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
    reservationEnabled: Boolean(raw.reservationEnabled ?? raw.reservation_enabled),
    stallReservationEnabled: Boolean(raw.stallReservationEnabled ?? raw.stall_reservation_enabled),
    catalogItemType: String(raw.catalogItemType || raw.catalog_item_type || 'meal'),
    catalogCategory: String(raw.catalogCategory || raw.catalog_category || ''),
    parentDishId: raw.parentDishId || raw.parent_dish_id || null,
    name: String(raw.name || raw.dishName || raw.dish_name || ''),
    price: Number(raw.price ?? pricing.minAmount ?? 0),
    pricingMode: pricing.mode,
    priceDisplay: pricing.display,
    pricing,
    aliases: parseJson(raw.aliases || raw.aliases_json, []),
    taste: String(raw.taste || ''),
    cuisine: String(raw.cuisine || ''),
    regionalTaste: String(raw.regionalTaste || raw.regional_taste || ''),
    ingredients: parseJson(raw.ingredients || raw.ingredients_json, []),
    tags: parseJson(raw.tags || raw.tags_json, []),
    allergens: parseJson(raw.allergens || raw.allergens_json, []),
    dietaryLabels: parseJson(raw.dietaryLabels || raw.dietary_labels_json, []),
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
    semanticLabels: uniqueStrings(parseJson(raw.semanticLabels || raw.semantic_labels_json, []), deriveDishSemanticLabels(raw)),
    _menuEntries: parseJson(raw._menuEntries || raw.menuEntries || [], []),
    _menuItem: menuItem,
    _explicitAvailability: explicitAvailability
  };
  candidate.facts = buildDishFacts(raw);
  candidate.spiceLevel = candidate.facts.spiceLevel;
  return candidate;
}

function inferCurrentMeal(hour) {
  if (hour < 10) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}

function deriveAvailability(candidate, { date, mealType }) {
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

  const base = {
    menuItemId: null,
    menuId: null,
    date,
    mealType,
    price: Number(candidate.pricing?.minAmount ?? candidate.price ?? 0),
    priceDisplay: candidate.priceDisplay,
    budgetComparable: candidate.pricing?.budgetComparable !== false,
    paymentMethod: 'at_stall',
    supplyConfirmed: false,
  };
  const reservable = candidate.reservationEnabled && candidate.stallReservationEnabled;
  return reservable
    ? { ...base, orderable: true, status: 'reservable', reason: '可预约，到店支付' }
    : { ...base, orderable: false, status: 'reservation_paused', reason: '暂停预约' };
}

function publicCandidate(candidate) {
  const { _menuEntries, _menuItem, _explicitAvailability, ...dish } = candidate;
  return dish;
}

async function loadCandidatesFromDatabase(db, tenantId, { date, mealType }) {
  if (!db?.prepare) throw Object.assign(new Error('未提供菜品候选或数据库适配器'), { status: 500, code: 'RETRIEVAL_SOURCE_UNAVAILABLE' });
  const dishRows = await db.prepare(`SELECT d.*, s.name AS stall_name, s.canteen_id AS canteen_id, s.open AS stall_open,
      s.reservation_enabled AS stall_reservation_enabled,
      c.name AS canteen_name, c.location AS canteen_location, c.crowd_level AS crowd_level,
      c.parent_id AS primary_canteen_id
      FROM dishes d
      LEFT JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = d.tenant_id
      LEFT JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = d.tenant_id
      LEFT JOIN canteens parent ON parent.id = c.parent_id AND parent.tenant_id = c.tenant_id
      WHERE d.tenant_id = ? AND d.status = 'active' AND d.review_status = 'approved'
        AND d.retrieval_eligible = 1
        AND s.review_status = 'approved' AND s.retrieval_eligible = 1 AND s.open = 1
        AND c.review_status = 'approved' AND c.retrieval_eligible = 1 AND c.operating_status = 'open'
        AND (c.parent_id IS NULL OR (
          parent.review_status = 'approved' AND parent.retrieval_eligible = 1 AND parent.operating_status = 'open'
        ))`).all(tenantId);
  return dishRows.map((row) => mapCandidate(row, tenantId));
}

async function loadCatalogCanteens(db, tenantId) {
  if (!db?.prepare) return [];
  return db.prepare('SELECT id, name FROM canteens WHERE tenant_id = ?').all(tenantId);
}

function candidateSearchText(candidate) {
  return [candidate.name, candidate.cuisine, candidate.taste, candidate.description, candidate.stallName, candidate.canteenName,
    ...(candidate.aliases || []), ...candidate.ingredients, ...candidate.tags, ...(candidate.dietaryLabels || []), ...(candidate.semanticLabels || [])].filter(Boolean).join(' ');
}

function chineseBigrams(text) {
  const compact = normalizedText(text);
  const grams = [];
  for (let index = 0; index < compact.length - 1; index += 1) grams.push(compact.slice(index, index + 2));
  return [...new Set(grams)];
}

function isSingleEditMatch(left, right) {
  const a = [...normalizedText(left)];
  const b = [...normalizedText(right)];
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < a.length && rightIndex < b.length) {
    if (a[leftIndex] === b[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) leftIndex += 1;
    else if (b.length > a.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  if (leftIndex < a.length || rightIndex < b.length) edits += 1;
  return edits === 1;
}

function isUnknownTaste(candidate) {
  const taste = normalizedText(candidate?.taste);
  return !taste || ['待核验', '未知', '未标注', '不限'].includes(taste);
}

/** Deterministic Chinese-friendly lexical ranking over already authorized candidates. */
export function lexicalRankDishes(query, candidates = []) {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return candidates.map((candidate, rank) => ({ id: candidate.id, rank, score: 0, matchReasons: [] }));
  const queryTerms = [...new Set(String(query).split(/\s+/u).map(normalizedText).filter((term) => term.length >= 2))];
  const matchesQueryTerm = (value) => {
    const normalizedValue = normalizedText(value);
    return normalizedValue && queryTerms.some((term) => normalizedValue.includes(term) || term.includes(normalizedValue));
  };
  const queryGrams = chineseBigrams(query);
  return candidates.map((candidate) => {
    const name = normalizedText(candidate.name);
    const searchText = normalizedText(candidateSearchText(candidate));
    const reasons = [];
    let score = 0;
    const aliases = candidate.aliases.map(normalizedText);
    const locationFields = [candidate.catalogCategory, candidate.stallName, candidate.canteenName].map(normalizedText).filter(Boolean);
    if (name === normalizedQuery) { score = 100; reasons.push('菜名完全匹配'); }
    else if (aliases.includes(normalizedQuery)) { score = 90; reasons.push('菜品别名匹配'); }
    else if ((normalizedQuery.includes(name) && name.length >= 2) || (name.includes(normalizedQuery) && normalizedQuery.length >= 2) || matchesQueryTerm(name)) {
      score = 80;
      reasons.push('菜名匹配');
    } else if (locationFields.some((value) => value.includes(normalizedQuery) || normalizedQuery.includes(value) || matchesQueryTerm(value))) {
      score = 50;
      reasons.push('分类或位置匹配');
    } else if (candidate.ingredients.some((item) => includesTerm(query, item) || includesTerm(item, query) || matchesQueryTerm(item))
      || candidate.tags.some((item) => includesTerm(query, item) || includesTerm(item, query) || matchesQueryTerm(item))) {
      score = 25;
      const ingredientMatches = candidate.ingredients.filter(matchesQueryTerm);
      reasons.push(ingredientMatches.length ? `食材匹配：${ingredientMatches.slice(0, 3).join('、')}` : '标签匹配');
    } else if ([candidate.description, candidate.taste, ...candidate.semanticLabels]
      .some((value) => includesTerm(query, value) || includesTerm(value, query) || matchesQueryTerm(value))) {
      score = 10;
      reasons.push('目录语义匹配');
    } else if (isSingleEditMatch(name, normalizedQuery) || candidate.aliases.some((alias) => isSingleEditMatch(alias, normalizedQuery))) {
      score = 70;
      reasons.push('菜名近似匹配');
    }

    if (score > 0 && queryGrams.length) {
      const overlap = queryGrams.filter((gram) => searchText.includes(gram)).length;
      score += (overlap / queryGrams.length) * 0.99;
    }
    return { id: candidate.id, score: Number(score.toFixed(4)), matchReasons: reasons };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((item, rank) => ({ ...item, rank }));
}

function exactRankDishes(query, candidates) {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return [];
  return candidates.map((candidate) => {
    const normalizedName = normalizedText(candidate.name);
    let score = 0;
    if (normalizedName === normalizedQuery) score = 3;
    else if (normalizedQuery.includes(normalizedName) && normalizedName.length >= 2) score = 2;
    else if (candidate.ingredients.some((item) => normalizedQuery.includes(normalizedText(item)))) score = 1;
    return { id: candidate.id, score, matchLength: score >= 2 ? normalizedName.length : 0 };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.matchLength - left.matchLength || left.id.localeCompare(right.id));
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

function matchesDietaryLabels(candidate, pattern) {
  if (!pattern || pattern === 'balanced' || pattern === 'unrestricted') return true;
  const labels = new Set(candidate.dietaryLabels || []);
  if (pattern === 'vegan') return labels.has('vegan');
  if (pattern === 'vegetarian') return labels.has('vegetarian') || labels.has('vegan');
  if (pattern === 'pescatarian') return labels.has('pescatarian') || labels.has('vegetarian') || labels.has('vegan');
  return true;
}

/** Apply database-truth hard constraints and report why rows were rejected. */
export function applyDishHardConstraints(candidates, filters = {}, { requireOrderable = false } = {}) {
  const rejections = {};
  const reject = (reason) => { rejections[reason] = (rejections[reason] || 0) + 1; return false; };
  const items = candidates.filter((candidate) => {
    const menuPrice = candidate.availability?.menuItemId ? Number(candidate.availability.price) : null;
    const price = menuPrice ?? budgetPriceForDish(candidate);
    if (!isActiveDish(candidate)) return reject('status');
    if (filters.itemType && candidate.catalogItemType !== filters.itemType) return reject('itemType');
    if (filters.catalogCategories?.length && !filters.catalogCategories.includes(candidate.catalogCategory)) return reject('catalogCategory');
    if (price != null && filters.budgetMin != null && price < filters.budgetMin) return reject('budgetMin');
    if (price != null && filters.budgetMax != null && price > filters.budgetMax) return reject('budgetMax');
    if (filters.mealType && !candidate.mealTypes.includes(filters.mealType)) return reject('mealType');
    if (filters.halalOnly && !candidate.halal) return reject('halalOnly');
    if (filters.taste && filters.taste !== '不限' && !isUnknownTaste(candidate)
      && candidate.taste !== filters.taste && !candidate.tags.some((tag) => includesTerm(tag, filters.taste))) return reject('taste');
    if (filters.canteenId && candidate.canteenId !== filters.canteenId) return reject('canteen');
    if (filters.primaryCanteenId && candidate.primaryCanteenId !== filters.primaryCanteenId && candidate.canteenId !== filters.primaryCanteenId) return reject('canteen');
    if (filters.canteenName && !includesTerm(candidate.canteenName, filters.canteenName)) return reject('canteen');
    if (filters.stallId && candidate.stallId !== filters.stallId) return reject('stall');
    if (filters.stallName && !includesTerm(candidate.stallName, filters.stallName)) return reject('stall');
    if (filters.tags?.length && !filters.tags.every((term) => candidate.tags.some((tag) => includesTerm(tag, term)))) return reject('tags');
    if (filters.includeIngredients?.length && !filters.includeIngredients.every((term) => candidate.ingredients.some((item) => includesTerm(item, term)))) return reject('includeIngredients');
    const avoidTerms = uniqueStrings(filters.avoidIngredients);
    if (avoidTerms.some((term) => [
      ...candidate.ingredients,
      ...(candidate.facts?.seasonings || []),
      ...(candidate.facts?.additives || []),
    ].some((item) => includesTerm(item, term)))) return reject('safety');
    candidate.safety = evaluateDishSafety(candidate, filters.allergens || []);
    if (candidate.safety.blocked) return reject('safety');
    if (!matchesDietaryLabels(candidate, filters.dietaryPattern)) return reject('dietaryPattern');
    if (filters.minSpiceLevel != null && candidate.spiceLevel != null && candidate.spiceLevel < filters.minSpiceLevel) return reject('minSpiceLevel');
    if (filters.maxSpiceLevel != null && candidate.spiceLevel != null && candidate.spiceLevel > filters.maxSpiceLevel) return reject('maxSpiceLevel');
    const hasNutritionFilter = ['minProtein', 'minFiber', 'maxCalories', 'maxFat', 'maxCarbs', 'maxSodium', 'maxSugar']
      .some((key) => filters[key] != null);
    if (hasNutritionFilter && candidate.facts?.factStatus?.nutrition === 'unknown') return reject('nutritionUnknown');
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
  if (rejections.nutritionUnknown) add('nutritionEvidence', '部分菜品缺少已核验营养数据，无法作确定的营养筛选');
  if (lexicalMiss) add('query', '可改用菜名、主要食材、口味或档口名称查询');
  if (rejections.itemType || lexicalMiss) {
    for (const itemType of PUBLIC_CATALOG_ITEM_TYPES.filter((value) => value !== filters.itemType)) {
      add('itemType', `可切换到${itemType === 'snack' ? '小吃' : itemType === 'beverage' ? '饮品' : '餐食'}分区继续查找`);
    }
  }
  return suggestions.slice(0, 5);
}

function semanticId(result) {
  return String(result.dishId || result.sourceId || result.metadata?.dishId || result.id || '');
}

async function runSemanticSearch(semanticSearch, { query, tenantId, candidateIds, limit, itemType, catalogCategories }) {
  if (!semanticSearch || !query) return { results: [], used: false, degradedReasons: [], trace: null };
  try {
    const allowed = new Set(candidateIds);
    const raw = await semanticSearch({ query, tenantId, limit, candidateIds, itemType, catalogCategories, sourceType: 'dish' });
    const results = (Array.isArray(raw) ? raw : raw?.items || raw?.results || [])
      .filter((item) => !item.sourceType || item.sourceType === 'dish')
      .map((item) => ({
        id: semanticId(item),
        score: Number(item.vectorScore ?? item.similarity ?? item.score ?? 0),
        fusedScore: Number(item.score ?? 0),
        source: 'semantic',
      }))
      .filter((item) => item.id && allowed.has(item.id))
      .sort((left, right) => right.score - left.score);
    const degradedReasons = (raw?.warnings || []).map((warning) => `${warning.code || 'retrieval_warning'}:${warning.message || 'degraded'}`);
    const vectorEnabled = !raw?.meta?.retrievalModes || raw.meta.retrievalModes.includes('vector');
    return { results, used: vectorEnabled && results.length > 0, degradedReasons, trace: raw?.meta?.trace || null, retrievalModes: raw?.meta?.retrievalModes || [] };
  } catch (error) {
    return { results: [], used: false, degradedReasons: [`semantic_search_failed:${error?.message || 'unknown'}`], trace: null };
  }
}

function sortSearchItems(items, sort, filters = {}) {
  if (sort === 'price_asc') return items.sort((a, b) => a.availability.price - b.availability.price || b.retrievalScore - a.retrievalScore);
  if (sort === 'price_desc') return items.sort((a, b) => b.availability.price - a.availability.price || b.retrievalScore - a.retrievalScore);
  if (sort === 'rating') return items.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
  if (sort === 'sales') return items.sort((a, b) => b.sales - a.sales || b.rating - a.rating);
  if (filters.preferLowCrowd) {
    return items.sort((a, b) => Number(b.availability.orderable) - Number(a.availability.orderable)
      || Number(a.crowdLevel ?? 100) - Number(b.crowdLevel ?? 100)
      || b.retrievalScore - a.retrievalScore
      || b.rating - a.rating);
  }
  return items.sort((a, b) => b.retrievalScore - a.retrievalScore || Number(b.availability.orderable) - Number(a.availability.orderable) || b.rating - a.rating);
}

function executionContext(context, nowProvider, requestedMealType) {
  const clock = businessDateTime(context.now || nowProvider());
  return {
    date: String(context.date || clock.date),
    time: String(context.time || clock.time),
    mealType: requestedMealType || context.mealType || inferCurrentMeal(clock.hour)
  };
}

/** Execute catalog search with hard filters, lexical/exact/semantic retrieval and RRF. */
export async function runDishSearchWorkflow(input = {}, dependencies = {}) {
  const request = parseDishSearchRequest(input);
  const retrievalQuery = [request.query, ...(request.interpreted.expandedTerms || [])].filter(Boolean).join(' ');
  const nowProvider = dependencies.now || (() => new Date());
  const exec = executionContext(request.context, nowProvider, request.filters.mealType);
  const sourceCandidates = request.candidates
    ? request.candidates.map((item) => mapCandidate(item, request.tenantId))
    : await loadCandidatesFromDatabase(dependencies.db, request.tenantId, exec);
  const candidates = sourceCandidates
    .filter((candidate) => candidate.id && candidate.tenantId === request.tenantId && isActiveDish(candidate))
    .map((candidate) => ({ ...candidate, availability: deriveAvailability(candidate, exec) }));
  const catalogCanteens = request.candidates ? [] : await loadCatalogCanteens(dependencies.db, request.tenantId);
  applyCatalogLocationMention(request, candidates, catalogCanteens);
  const interpretationWarnings = [];
  let llmSupplementUsed = false;
  const preliminaryExact = exactRankDishes(request.query, candidates);
  const preliminaryLexical = lexicalRankDishes(retrievalQuery, candidates);
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
  const hasConflicts = request.interpreted.conflicts.length > 0;
  if (hasConflicts) interpretationWarnings.push(...request.interpreted.conflicts.map((conflict) => ({
    code: conflict.code,
    message: conflict.message,
    requiresConfirmation: true,
  })));
  const constrained = hasConflicts
    ? { items: [], rejections: { conflict: candidates.length } }
    : applyDishHardConstraints(candidates, request.filters);
  const lexical = lexicalRankDishes(retrievalQuery, constrained.items);
  const exact = exactRankDishes(request.query, constrained.items).map((item) => ({ ...item, source: 'exact' }));
  const semantic = await runSemanticSearch(dependencies.semanticSearch, {
    query: retrievalQuery,
    tenantId: request.tenantId,
    candidateIds: constrained.items.map((item) => item.id),
    limit: Math.max(request.limit * 3, 30),
    itemType: request.filters.itemType,
    catalogCategories: request.filters.catalogCategories,
  });
  const structuredOnly = request.interpreted.detected.length > 0 || !request.query;
  const baseline = structuredOnly
    ? [...constrained.items].sort((a, b) => Number(b.availability.orderable) - Number(a.availability.orderable) || b.rating - a.rating).map((item) => ({ id: item.id, source: 'baseline' }))
    : [];
  const fused = reciprocalRankFusion([exact, lexical.map((item) => ({ ...item, source: 'lexical' })), semantic.results, baseline], { weights: [2.4, 1.5, 1.2, 0.25] });
  const rerankLimit = Math.min(100, Math.max(20, request.offset + request.limit));
  const byId = new Map(constrained.items.map((candidate) => [candidate.id, candidate]));
  const lexicalById = new Map(lexical.map((item) => [item.id, item]));
  const semanticById = new Map(semantic.results.map((item) => [item.id, item.score]));
  const ranked = fused.slice(0, rerankLimit).map((entry, index) => {
    const candidate = byId.get(entry.id);
    if (!candidate) return null;
    const exactBoost = exact.findIndex((item) => item.id === entry.id);
    const availabilityBoost = candidate.availability.orderable ? 0.02 : 0;
    const exactScore = exactBoost === 0 ? 0.03 : 0;
    const semanticScore = Math.max(0, semanticById.get(entry.id) || 0) * 0.01;
    const ratingBoost = Math.max(0, Number(candidate.rating || 0)) / 5 * 0.008
      + Math.min(0.004, Math.log10(Number(candidate.reviewCount || 0) + 1) * 0.001);
    const supplyAdjustment = candidate.availability.status === 'limited' ? -0.003 : 0;
    const retrievalScore = entry.rrfScore + availabilityBoost + exactScore + semanticScore + ratingBoost + supplyAdjustment;
    const nextRrf = Number(fused[index + 1]?.rrfScore || 0);
    const rankMargin = entry.rrfScore > 0 ? Math.max(0, (entry.rrfScore - nextRrf) / entry.rrfScore) : 0;
    const dataQuality = dishDataQuality(candidate, nowProvider());
    const confidence = retrievalConfidence({
      lexicalMatched: lexicalById.has(entry.id) || exactBoost >= 0,
      semanticScore: semanticById.get(entry.id) || 0,
      rankMargin,
      quality: dataQuality,
      sourceVerified: Object.values(candidate.facts?.factStatus || {}).some((status) => status === 'verified'),
    });
    const matchReasons = uniqueStrings(
      lexicalById.get(entry.id)?.matchReasons,
      semanticById.has(entry.id) ? ['语义相关'] : [],
      candidate.availability.orderable ? ['当前可下单'] : []
    );
    return {
      ...publicCandidate(candidate),
      availability: candidate.availability,
      safety: candidate.safety || evaluateDishSafety(candidate, request.filters.allergens || []),
      dataQuality,
      confidence,
      matchReasons,
      retrievalScore: Number(retrievalScore.toFixed(6)),
      retrievalBreakdown: {
        rrf: Number(entry.rrfScore.toFixed(6)),
        exact: Number(exactScore.toFixed(6)),
        semantic: Number(semanticScore.toFixed(6)),
        availability: Number(availabilityBoost.toFixed(6)),
        rating: Number(ratingBoost.toFixed(6)),
        supply: Number(supplyAdjustment.toFixed(6)),
      },
    };
  }).filter(Boolean);
  sortSearchItems(ranked, request.sort, request.filters);
  const pageItems = ranked.slice(request.offset, request.offset + request.limit);
  const safetyWarnings = pageItems
    .filter((item) => item.safety?.status === 'unknown')
    .map((item) => ({
      code: 'ALLERGEN_UNVERIFIED',
      dishId: item.id,
      allergens: item.safety.unknownAllergens,
      message: `${item.name}的相关过敏原信息尚未由食堂确认，请现场核实配方和交叉接触风险。`,
    }));
  if (!pageItems.length && request.filters.allergens?.length) {
    safetyWarnings.push({
      code: 'ALLERGEN_UNVERIFIED',
      allergens: request.filters.allergens,
      message: `当前区域没有可用于核验${request.filters.allergens.join('、')}过敏风险的菜品记录，不能据此判断可安全食用。`,
    });
  }
  const reservationWarnings = pageItems
    .filter((item) => item.availability?.status === 'reservation_paused')
    .map((item) => ({ code: 'RESERVATION_PAUSED', dishId: item.id, message: `${item.name}当前暂停预约，可查看目录信息。` }));
  const budgetWarnings = (request.filters.budgetMin != null || request.filters.budgetMax != null)
    ? pageItems.filter((item) => item.availability?.budgetComparable === false).map((item) => ({
        code: 'BUDGET_UNVERIFIED',
        dishId: item.id,
        message: `${item.name}按重量计价，无法仅凭单价确认整份是否符合预算。`,
      }))
    : [];
  const tasteWarnings = request.filters.taste && request.filters.taste !== '不限'
    ? pageItems.filter(isUnknownTaste).map((item) => ({
        code: 'TASTE_UNVERIFIED',
        dishId: item.id,
        taste: request.filters.taste,
        message: `${item.name}的口味信息尚未核验，无法确认是否符合“${request.filters.taste}”。`,
      }))
    : [];
  const lexicalMiss = Boolean(request.query) && !request.interpreted.detected.length && !exact.length && !lexical.length && !semantic.results.length;
  return {
    interpreted: request.interpreted,
    items: pageItems,
    confidence: pageItems[0]?.confidence || retrievalConfidence(),
    warnings: [...interpretationWarnings, ...safetyWarnings, ...reservationWarnings, ...budgetWarnings, ...tasteWarnings],
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
      retrievalTrace: semantic.trace,
      llmSupplementUsed,
      degradedReasons: semantic.degradedReasons,
      sourceCandidateCount: candidates.length,
      filteredCandidateCount: constrained.items.length,
      rerankedCandidateCount: ranked.length,
      hardConstraintRejections: constrained.rejections,
      date: exec.date,
      mealType: exec.mealType,
      indexVersion: dependencies.indexVersion || null,
      partition: request.partition,
    }
  };
}

function recommendationFilters(queryFilters, profile, options) {
  const explicitTaste = queryFilters.taste;
  const profileComplete = profile.onboardingStatus !== 'pending' && profile.onboardingStatus !== 'deferred';
  return {
    budgetMax: queryFilters.budgetMax ?? (profileComplete ? profile.budgetMax : undefined),
    budgetMin: queryFilters.budgetMin,
    mealType: queryFilters.mealType || profile.mealType,
    orderableOnly: queryFilters.orderableOnly,
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
    maxSugar: queryFilters.maxSugar,
    minSpiceLevel: queryFilters.minSpiceLevel,
    maxSpiceLevel: queryFilters.maxSpiceLevel
  };
}

function preferenceFor(preferences, dishId) {
  return preferences.find((item) => (item.dishId || item.dish_id) === dishId) || null;
}

function scoreRecommendation(candidate, { profile, context, semanticScore = 0, softSignals = [] }) {
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
  const budget = Number(profile.budgetMax);
  breakdown.budget = Number.isFinite(budget) && budget > 0 && profile.onboardingStatus === 'completed'
    ? Math.max(0, budget - candidate.availability.price) * 0.7
    : 0;
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
  if (profile.nutritionFocus.includes('lowFat') && nutrition.fat > 0 && nutrition.fat <= 15) { nutritionFocusScore += 6; why.push('低脂匹配'); }
  if (profile.nutritionFocus.includes('lowCarb') && nutrition.carbs > 0 && nutrition.carbs <= 50) { nutritionFocusScore += 6; why.push('低碳水匹配'); }
  if (profile.nutritionFocus.includes('highFiber') && candidate.fiber >= 3) { nutritionFocusScore += 6; why.push('高纤维匹配'); }
  if (profile.nutritionFocus.includes('lowSodium') && candidate.sodium > 0 && candidate.sodium < 500) { nutritionFocusScore += 5; why.push('低钠匹配'); }
  if (profile.nutritionFocus.includes('lowSugar') && candidate.sugar > 0 && candidate.sugar < 5) { nutritionFocusScore += 5; why.push('低糖匹配'); }
  if (profile.nutritionFocus.includes('calcium') && candidate.calcium >= 100) { nutritionFocusScore += 5; why.push('高钙匹配'); }
  if (profile.nutritionFocus.includes('iron') && candidate.iron >= 3) { nutritionFocusScore += 5; why.push('高铁匹配'); }
  breakdown.nutritionFocus = nutritionFocusScore;

  const dishSpiceLevel = candidate.taste.includes('微辣') ? 2 : candidate.taste.includes('麻辣') ? 5 : candidate.taste.includes('辣') ? 4 : 1;
  const preferredSpiceLevel = Number(profile.spiceLevel || 0);
  const spiceDistance = preferredSpiceLevel > 0 ? Math.abs(preferredSpiceLevel - dishSpiceLevel) : 0;
  breakdown.spice = preferredSpiceLevel > 0 ? -spiceDistance * 2.5 : 0;
  if (preferredSpiceLevel > 0 && spiceDistance === 0) why.push('辣度匹配');

  const favoriteMatches = candidate.tags.filter((tag) => profile.favoriteTags.includes(tag));
  breakdown.tags = favoriteMatches.length * 4;
  if (favoriteMatches.length) why.push(`匹配标签：${favoriteMatches.join('、')}`);

  const timeOfDay = context.timeOfDay;
  breakdown.timeBonus = timeOfDay && candidate.mealTypes.includes(timeOfDay)
    ? (timeOfDay === 'breakfast' ? 5 : 3)
    : 0;
  breakdown.semantic = Math.max(0, semanticScore) * 30;
  if (semanticScore > 0) why.push('与本次需求语义相关');
  const candidateText = normalizedText(candidateSearchText(candidate));
  const matchedCampusSignals = softSignals.filter((signal) => candidateText.includes(normalizedText(signal)));
  breakdown.campusContext = Math.min(12, matchedCampusSignals.length * 3);
  if (matchedCampusSignals.length) why.push(`匹配校园语义：${matchedCampusSignals.slice(0, 2).join('、')}`);
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

function knowledgeAuthority(sourceType, metadata = {}) {
  if (sourceType === 'campus_policy') return 5;
  if (sourceType === 'health_knowledge' && /中国|国家|学校/.test(`${metadata.publisher || ''} ${metadata.sourceVersion || ''}`)) return 4;
  if (sourceType === 'health_knowledge') return 3;
  if (sourceType === 'food_composition_reference') return 2;
  if (sourceType === 'campus_dining_knowledge') return 1;
  return 0;
}

function normalizeKnowledgeResults(results = []) {
  return results.filter((item) => !['dish', 'stall', 'canteen'].includes(item.sourceType)).map((item) => {
    const metadata = item.metadata || {};
    const sourceType = item.sourceType || 'knowledge';
    return {
      id: item.id || item.sourceId,
      sourceId: item.sourceId || item.id,
      sourceType,
      tenantId: item.tenantId || metadata.tenantId || null,
      evidenceType: item.evidenceType || metadata.evidenceType || 'knowledge_reference',
      title: item.title || item.name || '健康知识',
      snippet: item.snippet || String(item.content || '').slice(0, 180),
      score: Number(item.score ?? item.similarity ?? 0),
      knowledgeDomain: metadata.knowledgeDomain || metadata.category || null,
      publisher: metadata.publisher || null,
      version: metadata.version || metadata.sourceVersion || null,
      reviewedAt: metadata.reviewedAt || null,
      license: metadata.license || null,
      factStatus: metadata.factStatus || null,
      citation: metadata.citation || metadata.sourceUrl || null,
      authority: knowledgeAuthority(sourceType, metadata),
      metadata,
    };
  });
}

/** Route each question to evidence sources that are allowed to answer that domain. */
export function routeDiningKnowledgeSources(query = '') {
  const text = String(query || '').trim();
  const policy = /退款|投诉|失物|应急|服务台|营业(?:时间|规则|安排)|开放时间|停业|闭店|规章|校内制度|价格争议|意见反馈|反馈渠道/.test(text);
  const allergy = /过敏|过敏原|交叉接触|交叉污染|致敏|不能吃|忌口|放心吃|确认不含|不含.{0,8}(?:花生|牛奶|鸡蛋|小麦|大豆|芝麻|坚果|虾|蟹|鱼)/.test(text);
  const nutrition = /营养|减脂|增肌|健身|运动|训练|蛋白|热量|卡路里|脂肪|碳水|膳食|低卡|低脂|低糖|低钠|少盐|摄入|均衡/.test(text);
  const foodComposition = /成分|食材|配方|每\s*100\s*克|FDC|FoodOn/i.test(text) || nutrition;
  if (policy) {
    return {
      intent: 'campus_policy',
      routes: [{ id: 'tenant_policy', scope: 'tenant', sourceTypes: ['campus_policy'], weight: 1.5 }],
      includeFoodComposition: false,
    };
  }
  if (allergy) {
    return {
      intent: 'allergy_safety',
      routes: [
        { id: 'global_health', scope: 'global', sourceTypes: ['health_knowledge'], weight: 1.5 },
        { id: 'global_concepts', scope: 'global', sourceTypes: ['campus_dining_knowledge'], weight: 0.7 },
      ],
      includeFoodComposition: foodComposition,
    };
  }
  if (nutrition || foodComposition || /健康|饮食原则|均衡饮食|食物多样|规律进餐|食物分类|食材别名|同义词|未标注|待核验|unknown|补剂|呼吸困难|医疗|医学|疾病|食品安全|食物安全|世界卫生组织|WHO/i.test(text)) {
    return {
      intent: 'nutrition_and_health',
      routes: [
        { id: 'global_health', scope: 'global', sourceTypes: ['health_knowledge'], weight: 1.35 },
        { id: 'global_concepts', scope: 'global', sourceTypes: ['campus_dining_knowledge'], weight: 0.8 },
      ],
      includeFoodComposition: foodComposition,
    };
  }
  return {
    intent: 'dish_semantics',
    routes: [{ id: 'global_concepts', scope: 'global', sourceTypes: ['campus_dining_knowledge'], weight: 1 }],
    includeFoodComposition: false,
  };
}

/** Exact structured lookup for reference-only FDC/FoodOn records. */
export function matchFoodCompositionReferencesForQuery(query = '', references = [], limit = 5) {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return [];
  return references.map((reference) => {
    const terms = [
      String(reference.canonicalName || '').replace(/参考食材$/, ''),
      ...(reference.aliases || []),
    ].map((term) => String(term).trim()).filter((term) => normalizedText(term).length >= 2);
    const matchedTerms = terms.filter((term) => normalizedQuery.includes(normalizedText(term)));
    const matchLength = matchedTerms.reduce((maximum, term) => Math.max(maximum, normalizedText(term).length), 0);
    return { reference, matchedTerms, matchLength };
  }).filter((item) => item.matchLength > 0)
    .sort((left, right) => right.matchLength - left.matchLength || left.reference.id.localeCompare(right.reference.id))
    .slice(0, limit)
    .map(({ reference, matchedTerms, matchLength }, index) => ({
      id: `food-reference:${reference.id}`,
      sourceId: reference.id,
      sourceType: 'food_composition_reference',
      tenantId: '__global__',
      evidenceType: 'reference_only',
      title: reference.canonicalName,
      content: `FDC/FoodOn参考食材，每${reference.basisGrams}克基准；只能用于结构化参考，不得覆盖校内菜品事实。`,
      score: Number((1 - index * 0.03 + Math.min(0.2, matchLength / 100)).toFixed(4)),
      metadata: {
        evidenceType: 'reference_only',
        factStatus: reference.factStatus,
        campusDishFactPolicy: reference.campusDishFactPolicy,
        basisGrams: reference.basisGrams,
        nutrients: reference.nutrients,
        fdcId: reference.fdcId,
        foodOnId: reference.foodOnId,
        sourceIds: reference.sourceIds,
        provenance: reference.provenance,
        matchedTerms,
        citation: `FDC:${reference.fdcId}; ${reference.foodOnId}`,
        license: `${reference.provenance?.fdc?.license || ''}; ${reference.provenance?.foodOn?.license || ''}`,
        version: `${reference.provenance?.fdc?.sourceVersion || ''}; ${reference.provenance?.foodOn?.sourceVersion || ''}`,
      },
    }));
}

function applyCatalogLocationMention(request, candidates, catalogCanteens = []) {
  const query = String(request.query || '');
  const normalizedQuery = normalizedText(query);
  const canteens = new Map();
  for (const candidate of candidates) {
    if (candidate.canteenId && candidate.canteenName) canteens.set(candidate.canteenId, String(candidate.canteenName));
  }
  for (const canteen of catalogCanteens) {
    const id = canteen.id || canteen.canteenId || canteen.canteen_id;
    const name = canteen.name || canteen.canteenName || canteen.canteen_name;
    if (id && name) canteens.set(String(id), String(name));
  }
  const matches = [...canteens.entries()].filter(([, name]) => {
    const aliases = [
      name,
      name.replace(/^.*?大学/, ''),
      name.replace(/^.*?校区/, ''),
    ].filter((value) => value.length >= 3);
    return aliases.some((alias) => query.includes(alias));
  });
  if (matches.length === 1) {
    const [canteenId, canteenName] = matches[0];
    const matchedText = [canteenName, canteenName.replace(/^.*?大学/, ''), canteenName.replace(/^.*?校区/, '')]
      .find((alias) => alias.length >= 3 && query.includes(alias)) || canteenName;
    const filters = request.filters || (request.filters = {});
    const interpreted = request.interpreted || (request.interpreted = {});
    filters.canteenId = canteenId;
    interpreted.filters = filters;
    interpreted.hardConstraints = filters;
    interpreted.detected = [...new Set([...(interpreted.detected || []), 'canteenId'])];
    interpreted.constraints = [...(interpreted.constraints || []), {
      field: 'canteenId', value: canteenId, polarity: 'include', strength: 'hard',
      scope: 'location', source: 'tenant_catalog', matchedText,
    }];
  }

  const activeCanteenId = request.filters?.canteenId;
  const stalls = new Map();
  for (const candidate of candidates) {
    if (!candidate.stallId || !candidate.stallName) continue;
    if (activeCanteenId && candidate.canteenId !== activeCanteenId) continue;
    stalls.set(candidate.stallId, { name: String(candidate.stallName), canteenId: candidate.canteenId });
  }
  const stallMatches = [...stalls.entries()].filter(([, stall]) => {
    const normalizedName = normalizedText(stall.name);
    return normalizedName.length >= 3 && normalizedQuery.includes(normalizedName);
  });
  if (stallMatches.length === 1 && !request.filters?.stallId) {
    const [stallId, stall] = stallMatches[0];
    const filters = request.filters || (request.filters = {});
    const interpreted = request.interpreted || (request.interpreted = {});
    filters.stallId = stallId;
    interpreted.filters = filters;
    interpreted.hardConstraints = filters;
    interpreted.detected = [...new Set([...(interpreted.detected || []), 'stallId'])];
    interpreted.constraints = [...(interpreted.constraints || []), {
      field: 'stallId', value: stallId, polarity: 'include', strength: 'hard',
      scope: 'location', source: 'tenant_catalog', matchedText: stall.name,
    }];
  }
}

/** Produce a grounded deterministic knowledge answer; callers may replace only the prose with an LLM. */
export function buildKnowledgeAnswer({ query = '', results = [] } = {}) {
  const citations = normalizeKnowledgeResults(results);
  if (!citations.length) return { answer: '当前没有检索到可引用的知识依据，推荐结果仅依据校园目录和用户约束生成。', citations: [] };
  return {
    answer: `关于“${String(query).slice(0, 80)}”，已检索到 ${citations.slice(0, 3).map((item) => item.title).join('、')} 等依据；通用知识仅用于解释，不覆盖校内过敏原、目录价格和预约状态。`,
    citations
  };
}

export async function retrieveRoutedKnowledge(input = {}, dependencies = {}) {
  const query = String(input.query || '').trim();
  const tenantId = String(input.tenantId || 'default');
  const limit = Math.max(1, Math.min(10, Number(input.limit || 5)));
  if (!query) return { results: [], degradedReasons: [], trace: { routing: null, sources: [] } };
  const routing = routeDiningKnowledgeSources(query);
  const routeResults = await Promise.all(routing.routes.map(async (route) => {
    if (!dependencies.knowledgeSearch) return { route, items: [], warnings: [], trace: null };
    try {
      const raw = await dependencies.knowledgeSearch({
        query,
        tenantId,
        limit: Math.max(limit, 5),
        sourceTypes: route.sourceTypes,
      });
      return {
        route,
        items: normalizeKnowledgeResults(Array.isArray(raw) ? raw : raw?.items || raw?.results || []),
        warnings: raw?.warnings || [],
        trace: raw?.meta?.trace || null,
      };
    } catch (error) {
      return { route, items: [], warnings: [], trace: null, error };
    }
  }));
  let structured = [];
  if (routing.includeFoodComposition && dependencies.foodCompositionLookup) {
    try {
      structured = normalizeKnowledgeResults(await dependencies.foodCompositionLookup({ query, limit }));
    } catch (error) {
      routeResults.push({
        route: { id: 'food_composition_reference', scope: 'global', sourceTypes: ['food_composition_reference'], weight: 0.9 },
        items: [], warnings: [], trace: null, error,
      });
    }
  }

  const fused = new Map();
  const add = (item, route, rank) => {
    const key = `${item.sourceType}:${item.sourceId || item.id}`;
    const contribution = Number(route.weight || 1) / (60 + rank + 1);
    const existing = fused.get(key);
    if (!existing) {
      fused.set(key, { ...item, routeId: route.id, fusedScore: contribution });
      return;
    }
    existing.fusedScore += contribution;
    if (item.score > existing.score) Object.assign(existing, item);
  };
  for (const result of routeResults) result.items.forEach((item, rank) => add(item, result.route, rank));
  // A canonical-name/alias match is a structured lookup, so it must not be
  // displaced by several broad semantic documents in a small Top-K window.
  structured.forEach((item, rank) => add(item, { id: 'food_composition_reference', weight: 2 }, rank));
  const results = [...fused.values()]
    .sort((left, right) => (right.fusedScore + right.authority * 0.001) - (left.fusedScore + left.authority * 0.001))
    .slice(0, limit)
    .map((item) => ({ ...item, score: Number(item.fusedScore.toFixed(6)) }));
  const degradedReasons = [
    ...routeResults.filter((item) => item.error).map((item) => `${item.route.id}_failed:${item.error?.message || 'unknown'}`),
    ...routeResults.flatMap((item) => item.warnings.map((warning) => `${warning.code || 'retrieval_warning'}:${warning.message || 'degraded'}`)),
  ];
  return {
    results,
    degradedReasons,
    trace: {
      routing,
      sources: routeResults.map((item) => ({
        routeId: item.route.id,
        sourceTypes: item.route.sourceTypes,
        resultCount: item.items.length,
        failed: Boolean(item.error),
        trace: item.trace,
      })),
      structuredReferenceCount: structured.length,
    },
  };
}

async function retrieveKnowledge(knowledgeSearch, request, foodCompositionLookup) {
  return retrieveRoutedKnowledge({ query: request.query, tenantId: request.tenantId, limit: 5 }, {
    knowledgeSearch,
    foodCompositionLookup,
  });
}

/** Execute personalized recommendation over the stable semester catalog. */
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
  const campus = interpretCampusDiningQuery(request.query);
  const inferredProfile = inferRecommendationProfile(request.query);
  const profile = normalizeProfile({ ...request.profile, ...inferredProfile.profile, ...request.profileOverride });
  const filters = recommendationFilters(mergeFilters(campus.hardFilters, inferred.filters), profile, request.options);
  const mode = request.options.mode || (/搭配|套餐|组合|一荤一素|配餐/.test(request.query) ? 'combination' : 'alternatives');
  const nowProvider = dependencies.now || (() => new Date());
  const exec = executionContext(request.context, nowProvider, filters.mealType);
  const sourceCandidates = request.candidates
    ? request.candidates.map((item) => mapCandidate(item, request.tenantId))
    : await loadCandidatesFromDatabase(dependencies.db, request.tenantId, exec);
  const candidates = sourceCandidates
    .filter((candidate) => candidate.id && candidate.tenantId === request.tenantId && isMealCandidate(candidate))
    .map((candidate) => ({ ...candidate, availability: deriveAvailability(candidate, exec) }));
  const catalogCanteens = request.candidates ? [] : await loadCatalogCanteens(dependencies.db, request.tenantId);
  const locationInterpretation = {
    query: request.query,
    filters,
    interpreted: {
      filters,
      hardConstraints: filters,
      detected: [...new Set([...inferred.detected, ...inferredProfile.detected])],
      constraints: inferred.structured.constraints,
    },
  };
  applyCatalogLocationMention(locationInterpretation, candidates, catalogCanteens);
  const hasConflicts = inferred.structured.conflicts.length > 0;
  const hard = hasConflicts
    ? { items: [], rejections: { conflict: candidates.length } }
    : applyDishHardConstraints(candidates, filters, { requireOrderable: request.options.requireOrderable });
  const semanticPromise = runSemanticSearch(dependencies.semanticSearch, {
    query: [request.query, ...campus.expandedTerms].filter(Boolean).join(' '),
    tenantId: request.tenantId,
    candidateIds: hard.items.map((item) => item.id),
    limit: 30
  });
  const knowledgePromise = retrieveKnowledge(dependencies.knowledgeSearch, request, dependencies.foodCompositionLookup);
  const [semantic, knowledge] = await Promise.all([semanticPromise, knowledgePromise]);
  const semanticScores = new Map(semantic.results.map((item) => [item.id, item.score]));
  let source = 'stable_catalog';
  let warnings = profile.onboardingStatus === 'pending' || profile.onboardingStatus === 'deferred'
    ? [{ code: 'PROFILE_INCOMPLETE', message: '健康档案尚未完善，当前使用通用推荐，不应用默认预算或辣度偏好。' }]
    : [];
  if (hasConflicts) warnings.push(...inferred.structured.conflicts.map((conflict) => ({
    code: conflict.code,
    message: conflict.message,
    requiresConfirmation: true,
  })));
  let pool = hard.items;
  let fallbackRejections = hard.rejections;

  if (!pool.length && request.options.requireOrderable && !hasConflicts) {
    const fallback = applyDishHardConstraints(candidates, filters, { requireOrderable: false });
    pool = fallback.items;
    fallbackRejections = fallback.rejections;
    source = 'stable_catalog';
    warnings.push({ code: 'NO_RESERVABLE_DISH', message: '当前没有满足条件且可预约的菜品，以下为校园目录参考。' });
  }

  const rankedBase = pool.map((candidate) => scoreRecommendation(candidate, {
    profile: { ...profile, budgetMax: filters.budgetMax ?? profile.budgetMax },
    context: request.context,
    semanticScore: semanticScores.get(candidate.id) || 0,
    softSignals: campus.softSignals,
  })).sort((left, right) => right.recommendationScore - left.recommendationScore || right.rating - left.rating);
  const ranked = rankedBase.map((candidate, index) => {
    const nextScore = Number(rankedBase[index + 1]?.recommendationScore || 0);
    const rankMargin = candidate.recommendationScore > 0
      ? Math.max(0, (candidate.recommendationScore - nextScore) / candidate.recommendationScore)
      : 0;
    const dataQuality = dishDataQuality(candidate, nowProvider());
    return {
      ...candidate,
      safety: candidate.safety || evaluateDishSafety(candidate, filters.allergens || []),
      dataQuality,
      confidence: retrievalConfidence({
        lexicalMatched: false,
        semanticScore: semanticScores.get(candidate.id) || 0,
        rankMargin,
        quality: dataQuality,
        sourceVerified: Object.values(candidate.facts?.factStatus || {}).some((status) => status === 'verified'),
      }),
    };
  });

  let recommendations;
  let mealPlan;
  if (mode === 'combination') {
    const combinationBudget = Number(filters.budgetMax ?? profile.budgetMax);
    const effectiveCombinationBudget = Number.isFinite(combinationBudget) && combinationBudget > 0 ? combinationBudget : 10000;
    const combination = bestCombination(ranked, effectiveCombinationBudget, request.options.combinationSize);
    recommendations = combination?.dishes || [];
    mealPlan = {
      mode: 'combination',
      budgetMax: filters.budgetMax == null ? null : Number(filters.budgetMax),
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
    metadata: {
      tenantId: request.tenantId,
      evidenceType: 'tenant_dish_fact',
      orderable: dish.availability.orderable,
      menuItemId: dish.availability.menuItemId,
      safetyStatus: dish.safety?.status || 'not_applicable',
      unknownAllergens: dish.safety?.unknownAllergens || [],
      confidenceLevel: dish.confidence?.level || 'low',
      dataVersion: dish.dataQuality?.dataVersion || null,
    }
  }));
  const noResults = recommendations.length === 0;
  const safetyWarnings = recommendations
    .filter((dish) => dish.safety?.status === 'unknown')
    .map((dish) => ({
      code: 'ALLERGEN_UNVERIFIED',
      dishId: dish.id,
      allergens: dish.safety.unknownAllergens,
      message: `${dish.name}的相关过敏原信息尚未由食堂确认，请现场核实配方和交叉接触风险。`,
    }));
  warnings = [...warnings, ...safetyWarnings];
  const suggestedRelaxations = noResults ? relaxationSuggestions({ ...fallbackRejections, ...hard.rejections }, filters) : [];
  const degradedReasons = [...semantic.degradedReasons, ...knowledge.degradedReasons];
  const quotaExhausted = degradedReasons.some((reason) => reason.startsWith('AI_QUOTA_EXHAUSTED:'));
  if (quotaExhausted) warnings = [...warnings, { code: 'AI_QUOTA_EXHAUSTED', message: 'AI 额度已用完，已使用规则和词法检索返回结果。' }];
  if (degradedReasons.length) warnings = [...warnings, { code: 'RETRIEVAL_DEGRADED', message: '部分语义或知识检索不可用，已使用规则和词法能力降级。' }];

  return {
    recommendations,
    mealPlan,
    confidence: recommendations[0]?.confidence || retrievalConfidence(),
    evidence: { dishes: dishEvidence, knowledge: knowledge.results },
    warnings,
    suggestedRelaxations,
    meta: {
      tenantId: request.tenantId,
      mode,
      source,
      orderable: recommendations.some((dish) => dish.availability?.orderable),
      semanticUsed: semantic.used,
      retrievalTrace: {
        dish: semantic.trace,
        knowledge: knowledge.trace,
      },
      quotaExhausted,
      degradedReasons,
      sourceCandidateCount: candidates.length,
      eligibleCandidateCount: ranked.length,
      date: exec.date,
      mealType: exec.mealType,
      profile,
      interpreted: {
        query: request.query,
        filters,
        hardConstraints: filters,
        detected: locationInterpretation.interpreted.detected,
        constraints: locationInterpretation.interpreted.constraints,
        conflicts: inferred.structured.conflicts,
        pendingConfirmations: inferred.structured.pendingConfirmations,
        parserVersion: inferred.structured.parserVersion,
        concepts: campus.concepts,
        conceptIds: campus.conceptIds,
        softSignals: campus.softSignals,
        expandedTerms: campus.expandedTerms,
        ruleVersion: campus.ruleVersion,
      },
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
    searchKnowledge: (input) => retrieveRoutedKnowledge(input, dependencies),
    buildKnowledgeAnswer
  };
}
