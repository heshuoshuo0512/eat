import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadCampusDiningCorpus } from './campusDiningKnowledgeBase.js';
import { parseJson, rowToCanteen, rowToDish, rowToStall, serializeJson } from './database.js';

export const CATALOG_INTRODUCTION_PROMPT_VERSION = 'catalog-introduction-v4';
export const CATALOG_INTRODUCTION_ENTITY_TYPES = Object.freeze(['dish', 'stall', 'canteen']);
export const CATALOG_INTRODUCTION_LEVELS = Object.freeze(['dish', 'stall', 'area', 'venue']);
export const CATALOG_INTRODUCTION_STATUSES = Object.freeze(['generated', 'schema_validated', 'approved', 'rejected', 'retired']);

const claimSchema = z.object({
  text: z.string().trim().min(4).max(180),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
}).strict();

export const catalogIntroductionCandidateSchema = z.object({
  entityType: z.enum(['dish', 'stall', 'canteen']),
  entityId: z.string().trim().min(1).max(240),
  factualClaims: z.array(claimSchema).min(1).max(4),
  recommendationClaims: z.array(claimSchema).min(1).max(3),
  semanticLabels: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  boundaryCodes: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
}).strict();

export const catalogIntroductionBatchSchema = z.object({
  introductions: z.array(catalogIntroductionCandidateSchema).min(1).max(10),
}).strict();

export const CATALOG_INTRODUCTION_BATCH_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['introductions'],
  properties: {
    introductions: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entityType', 'entityId', 'factualClaims', 'recommendationClaims', 'semanticLabels'],
        properties: {
          entityType: { type: 'string', enum: CATALOG_INTRODUCTION_ENTITY_TYPES },
          entityId: { type: 'string' },
          factualClaims: {
            type: 'array', minItems: 1, maxItems: 4,
            items: { type: 'object', additionalProperties: false, required: ['text', 'evidenceIds'], properties: { text: { type: 'string' }, evidenceIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } } } },
          },
          recommendationClaims: {
            type: 'array', minItems: 1, maxItems: 3,
            items: { type: 'object', additionalProperties: false, required: ['text', 'evidenceIds'], properties: { text: { type: 'string' }, evidenceIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } } } },
          },
          semanticLabels: { type: 'array', maxItems: 10, items: { type: 'string' } },
          boundaryCodes: { type: 'array', maxItems: 12, items: { type: 'string' } },
        },
      },
    },
  },
});

const FORBIDDEN_CLAIMS = [
  /确认不含|可以放心|放心吃|安全食用|绝对安全/,
  /清真认证|已通过清真|符合清真认证/,
  /今日有售|正在供应|库存充足|现货充足/,
  /销量(?:最高|领先|很好)|最受欢迎|人气(?:最高|很高)|必吃|招牌(?:菜|产品)?/,
  /正宗|地道|新鲜|现做|品质(?:优秀|很好)|口碑(?:很好|优秀)/,
  /高蛋白|低脂|低糖|低钠|低卡|营养丰富/,
  /\d+(?:\.\d+)?\s*(?:kcal|千卡|卡路里|克蛋白|g蛋白)/i,
];
const UNCERTAINTY_MARKER = /可能|可供|可优先|可留意|从.{0,12}(?:目录|菜单|名称|结构)看|待核验|尚未|暂无足够|目录显示/;
const BOUNDARY_CODES = new Set([
  'CATALOG_DERIVED', 'SUPPLY_UNCONFIRMED', 'RECIPE_UNKNOWN', 'ALLERGEN_UNKNOWN',
  'NUTRITION_UNKNOWN', 'HALAL_UNKNOWN', 'DIETARY_UNKNOWN', 'MENU_MISSING',
  'OPERATING_STATUS_ONLY', 'AI_ESTIMATED_SOFT_SEMANTICS', 'ENTITY_NAME_REVIEW_REQUIRED',
]);
const SUPPLY_LANGUAGE = /(?:有售|供应|售卖|可购买|可下单|可点单)/;
const SUPPLY_UNCERTAINTY = /(?:有售|供应|售卖|购买|下单|点单).{0,12}(?:待核验|未确认|尚未确认|未知|不明|不代表)|(?:待核验|未确认|尚未确认|未知|不明|不代表|无法确认|不能确认|未提供).{0,12}(?:有售|供应|售卖|购买|下单|点单)/;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

export function stableCatalogIntroductionHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function uniqueText(values, limit = Number.MAX_SAFE_INTEGER) {
  return [...new Set((values || []).map((value) => String(value || '').normalize('NFKC').trim()).filter(Boolean))].slice(0, limit);
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s·•,，。、“”‘’（）()\-_/]+/g, '');
}

function catalogEntityNameReviewReason(value) {
  const name = String(value || '').normalize('NFKC').trim();
  if (/^\d+(?:\s*[-~至‐‑–—]\s*\d+)?\s*人份$/u.test(name)) return 'serving_tier_without_product';
  if (/^(?:单价|售价|计价|价格|基础套餐|第[一二三四五六七八九十]+组小锅)$/u.test(name)) return 'pricing_rule_without_product';
  return null;
}

function evidenceId(type, id) {
  return `${type}:${String(id)}`;
}

function rounded(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function priceSummary(dishes) {
  const comparable = dishes.filter((dish) => dish.pricing?.budgetComparable && Number.isFinite(Number(dish.pricing?.minAmount)));
  const values = comparable.map((dish) => Number(dish.pricing.minAmount)).sort((left, right) => left - right);
  const modes = {};
  for (const dish of dishes) modes[dish.pricingMode || 'fixed'] = (modes[dish.pricingMode || 'fixed'] || 0) + 1;
  return {
    comparableCount: values.length,
    minimum: values.length ? rounded(values[0]) : null,
    maximum: values.length ? rounded(values.at(-1)) : null,
    median: values.length ? rounded(values[Math.floor((values.length - 1) / 2)]) : null,
    pricingModes: modes,
  };
}

function topCounts(items, valuesFor, limit = 8) {
  const counts = new Map();
  for (const item of items) for (const value of valuesFor(item)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN')).slice(0, limit).map(([label, count]) => ({ label, count }));
}

function representativeDishes(dishes, limit = 12) {
  const sorted = [...dishes].sort((left, right) => String(left.name).localeCompare(String(right.name), 'zh-CN') || String(left.id).localeCompare(String(right.id)));
  const selected = [];
  const seenGroups = new Set();
  for (const dish of sorted) {
    const group = `${dish.semanticLabels?.[0] || 'unclassified'}:${dish.pricingMode || 'fixed'}`;
    if (seenGroups.has(group)) continue;
    selected.push(dish);
    seenGroups.add(group);
    if (selected.length >= limit) return selected;
  }
  for (const dish of sorted) {
    if (selected.some((item) => item.id === dish.id)) continue;
    selected.push(dish);
    if (selected.length >= limit) break;
  }
  return selected;
}

function conceptMatcher() {
  const concepts = loadCampusDiningCorpus().concepts.filter((concept) => concept.status === 'approved');
  return (dish) => {
    const haystack = normalizeSearchText([dish.name, ...(dish.aliases || []), ...(dish.semanticLabels || [])].join(' '));
    if (!haystack) return [];
    const matched = concepts.filter((concept) => {
      const terms = [concept.canonicalName, ...(concept.aliases || []), ...(concept.softTags || [])]
        .map(normalizeSearchText).filter((term) => term.length >= 2 && term.length <= 16);
      return terms.some((term) => haystack.includes(term));
    });
    return matched.slice(0, 6).map((concept) => ({ id: concept.id, name: concept.canonicalName, category: concept.category }));
  };
}

function confidenceForEvidence(level, evidence) {
  const hierarchy = evidence.hierarchy?.length >= (level === 'dish' ? 2 : 1) ? 0.3 : 0.15;
  const menuPrice = level === 'dish'
    ? (evidence.entity?.priceDisplay ? 0.3 : 0)
    : (Number(evidence.menu?.dishCount || 0) > 0 ? 0.3 : 0);
  const semantics = (evidence.semanticLabels?.length || evidence.concepts?.length) ? 0.25 : 0;
  const relations = (evidence.siblingDishes?.length || evidence.menu?.representativeDishes?.length || evidence.children?.length) ? 0.15 : 0;
  let score = rounded(hierarchy + menuPrice + semantics + relations);
  if (evidence.boundaryCodes?.some((code) => ['MENU_MISSING', 'ENTITY_NAME_REVIEW_REQUIRED'].includes(code))) {
    score = Math.min(score, 0.39);
  }
  return { score, level: score >= 0.8 ? 'high' : score >= 0.6 ? 'medium' : 'low', factors: { hierarchy, menuPrice, semantics, relations } };
}

function entityEvidenceBase({ entityType, hierarchyLevel, entity, hierarchy, semanticLabels, concepts, boundaryCodes, extra }) {
  const allowedEvidenceIds = uniqueText([
    evidenceId(entityType, entity.id),
    ...hierarchy.map((item) => evidenceId('canteen', item.id)),
    ...(concepts || []).map((item) => evidenceId('concept', item.id)),
    ...(extra.allowedEvidenceIds || []),
  ]);
  const evidence = {
    entityType,
    hierarchyLevel,
    entity,
    hierarchy,
    semanticLabels: uniqueText(semanticLabels, 12),
    concepts: concepts || [],
    boundaryCodes: uniqueText(['CATALOG_DERIVED', 'SUPPLY_UNCONFIRMED', ...boundaryCodes]),
    ...extra,
    allowedEvidenceIds,
  };
  const confidence = confidenceForEvidence(hierarchyLevel, evidence);
  const inputHash = stableCatalogIntroductionHash(evidence);
  return { ...evidence, confidence, inputHash };
}

export async function loadCatalogIntroductionEvidence(db, { tenantId = 'default' } = {}) {
  const [canteenRows, stallRows, dishRows] = await Promise.all([
    db.prepare('SELECT * FROM canteens WHERE tenant_id = ? ORDER BY parent_id, display_order, name, id').all(tenantId),
    db.prepare('SELECT * FROM stalls WHERE tenant_id = ? ORDER BY canteen_id, name, id').all(tenantId),
    db.prepare("SELECT * FROM dishes WHERE tenant_id = ? AND status = 'active' ORDER BY stall_id, name, id").all(tenantId),
  ]);
  const canteens = canteenRows.map((row) => ({ ...rowToCanteen(row), updatedAt: row.updated_at || null }));
  const stalls = stallRows.map((row) => ({ ...rowToStall(row), updatedAt: row.updated_at || null }));
  const dishes = dishRows.map((row) => ({ ...rowToDish(row), updatedAt: row.updated_at || null }));
  const canteenById = new Map(canteens.map((item) => [item.id, item]));
  const stallById = new Map(stalls.map((item) => [item.id, item]));
  const stallsByCanteen = new Map();
  const dishesByStall = new Map();
  for (const stall of stalls) stallsByCanteen.set(stall.canteenId, [...(stallsByCanteen.get(stall.canteenId) || []), stall]);
  for (const dish of dishes) dishesByStall.set(dish.stallId, [...(dishesByStall.get(dish.stallId) || []), dish]);
  const matchConcepts = conceptMatcher();
  const conceptsByDish = new Map(dishes.map((dish) => [dish.id, matchConcepts(dish)]));
  const evidence = [];

  for (const dish of dishes) {
    const stall = stallById.get(dish.stallId);
    const area = canteenById.get(stall?.canteenId);
    const venue = area?.parentId ? canteenById.get(area.parentId) : area;
    const hierarchy = uniqueHierarchy([venue, area]).map((item) => ({ id: item.id, name: item.name, location: item.location, operatingStatus: item.operatingStatus }));
    const entityNameReviewReason = catalogEntityNameReviewReason(dish.name);
    const siblings = entityNameReviewReason
      ? []
      : representativeDishes((dishesByStall.get(dish.stallId) || []).filter((item) => item.id !== dish.id), 12);
    const normalizedDishName = normalizeSearchText(dish.name);
    const concepts = entityNameReviewReason
      ? []
      : (conceptsByDish.get(dish.id) || []).filter((item) => normalizeSearchText(item.name) !== normalizedDishName);
    const semanticLabels = entityNameReviewReason
      ? []
      : (dish.semanticLabels || []).filter((label) => normalizeSearchText(label) !== normalizedDishName);
    evidence.push(entityEvidenceBase({
      entityType: 'dish', hierarchyLevel: 'dish',
      entity: { id: dish.id, name: dish.name, aliases: dish.aliases, priceDisplay: dish.priceDisplay, pricingMode: dish.pricingMode, updatedAt: dish.updatedAt },
      hierarchy,
      semanticLabels,
      concepts,
      boundaryCodes: [
        'RECIPE_UNKNOWN', 'ALLERGEN_UNKNOWN', 'NUTRITION_UNKNOWN', 'HALAL_UNKNOWN', 'DIETARY_UNKNOWN',
        entityNameReviewReason ? 'ENTITY_NAME_REVIEW_REQUIRED' : null,
      ].filter(Boolean),
      extra: {
        entityNameReviewReason,
        stall: stall ? { id: stall.id, name: stall.name, floor: stall.floor, category: stall.category } : null,
        siblingDishes: siblings.map((item) => ({ id: item.id, name: item.name, priceDisplay: item.priceDisplay, semanticLabels: item.semanticLabels?.slice(0, 3) || [] })),
        allowedEvidenceIds: [stall && evidenceId('stall', stall.id), ...siblings.map((item) => evidenceId('dish', item.id))].filter(Boolean),
      },
    }));
  }

  for (const stall of stalls) {
    const area = canteenById.get(stall.canteenId);
    const venue = area?.parentId ? canteenById.get(area.parentId) : area;
    const hierarchy = uniqueHierarchy([venue, area]).map((item) => ({ id: item.id, name: item.name, location: item.location, operatingStatus: item.operatingStatus }));
    const menu = dishesByStall.get(stall.id) || [];
    const representatives = representativeDishes(menu, 12);
    const semantics = topCounts(menu, (dish) => dish.semanticLabels || []).map((item) => item.label);
    const menuMissing = menu.length === 0;
    evidence.push(entityEvidenceBase({
      entityType: 'stall', hierarchyLevel: 'stall',
      entity: { id: stall.id, name: stall.name, aliases: stall.aliases, floor: stall.floor, category: stall.category, updatedAt: stall.updatedAt },
      hierarchy,
      semanticLabels: semantics,
      concepts: [],
      boundaryCodes: menuMissing ? ['MENU_MISSING'] : ['RECIPE_UNKNOWN', 'ALLERGEN_UNKNOWN', 'NUTRITION_UNKNOWN'],
      extra: {
        menu: { dishCount: menu.length, price: priceSummary(menu), semanticGroups: topCounts(menu, (dish) => dish.semanticLabels || []), representativeDishes: representatives.map((dish) => ({ id: dish.id, name: dish.name, priceDisplay: dish.priceDisplay, semanticLabels: dish.semanticLabels?.slice(0, 3) || [] })) },
        allowedEvidenceIds: representatives.map((dish) => evidenceId('dish', dish.id)),
      },
    }));
  }

  const descendantsFor = (canteen) => canteen.parentId
    ? [canteen]
    : [canteen, ...canteens.filter((item) => item.parentId === canteen.id)];
  for (const canteen of [...canteens].sort((left, right) => Number(Boolean(left.parentId)) - Number(Boolean(right.parentId)))) {
    const hierarchyLevel = canteen.parentId ? 'area' : 'venue';
    const venue = canteen.parentId ? canteenById.get(canteen.parentId) : canteen;
    const hierarchy = uniqueHierarchy([venue, canteen]).map((item) => ({ id: item.id, name: item.name, location: item.location, operatingStatus: item.operatingStatus }));
    const descendants = descendantsFor(canteen);
    const childIds = new Set(descendants.map((item) => item.id));
    const relatedStalls = stalls.filter((stall) => childIds.has(stall.canteenId));
    const relatedDishes = relatedStalls.flatMap((stall) => dishesByStall.get(stall.id) || []);
    const representatives = representativeDishes(relatedDishes, 12);
    const childCanteens = canteens.filter((item) => item.parentId === canteen.id);
    const semantics = topCounts(relatedDishes, (dish) => dish.semanticLabels || []).map((item) => item.label);
    const menuMissing = relatedDishes.length === 0;
    evidence.push(entityEvidenceBase({
      entityType: 'canteen', hierarchyLevel,
      entity: { id: canteen.id, name: canteen.name, displayName: canteen.displayName, location: canteen.location, venueKind: canteen.venueKind, operatingStatus: canteen.operatingStatus, updatedAt: canteen.updatedAt },
      hierarchy,
      semanticLabels: semantics,
      concepts: [],
      boundaryCodes: [canteen.operatingStatus !== 'open' ? 'OPERATING_STATUS_ONLY' : null, menuMissing ? 'MENU_MISSING' : null].filter(Boolean),
      extra: {
        children: childCanteens.map((item) => ({ id: item.id, name: item.name, operatingStatus: item.operatingStatus })),
        menu: { stallCount: relatedStalls.length, dishCount: relatedDishes.length, price: priceSummary(relatedDishes), semanticGroups: topCounts(relatedDishes, (dish) => dish.semanticLabels || []), representativeStalls: relatedStalls.slice(0, 12).map((item) => ({ id: item.id, name: item.name, floor: item.floor })), representativeDishes: representatives.map((dish) => ({ id: dish.id, name: dish.name, priceDisplay: dish.priceDisplay })) },
        allowedEvidenceIds: [...childCanteens.map((item) => evidenceId('canteen', item.id)), ...relatedStalls.slice(0, 12).map((item) => evidenceId('stall', item.id)), ...representatives.map((dish) => evidenceId('dish', dish.id))],
      },
    }));
  }

  const order = { dish: 0, stall: 1, area: 2, venue: 3 };
  evidence.sort((left, right) => order[left.hierarchyLevel] - order[right.hierarchyLevel] || left.entity.id.localeCompare(right.entity.id));
  return {
    tenantId,
    evidence,
    counts: { dishes: dishes.length, stalls: stalls.length, canteens: canteens.length, total: evidence.length },
    catalogDataVersion: uniqueText(dishes.map((dish) => dish.dataVersion))[0] || 'unknown',
    snapshotHash: stableCatalogIntroductionHash(evidence.map((item) => ({ entityType: item.entityType, entityId: item.entity.id, inputHash: item.inputHash }))),
  };
}

function uniqueHierarchy(items) {
  const byId = new Map();
  for (const item of items.filter(Boolean)) byId.set(item.id, item);
  return [...byId.values()];
}

function sentence(value) {
  const text = String(value || '').normalize('NFKC').trim().replace(/[。；;，,\s]+$/g, '');
  return text ? `${text}。` : '';
}

function collectAllowedNumbers(value, key = '', result = new Set()) {
  if (/id|hash|version|updatedat/i.test(key)) return result;
  if (typeof value === 'number' && Number.isFinite(value)) result.add(String(value));
  else if (typeof value === 'string') for (const match of value.matchAll(/\d+(?:\.\d+)?/g)) result.add(match[0]);
  else if (Array.isArray(value)) for (const item of value) collectAllowedNumbers(item, key, result);
  else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) collectAllowedNumbers(child, childKey, result);
  return result;
}

function evidenceBackedCatalogNames(evidence) {
  return uniqueText([
    evidence.entity?.name,
    ...(evidence.entity?.aliases || []),
    evidence.stall?.name,
    ...(evidence.hierarchy || []).map((item) => item.name),
    ...(evidence.siblingDishes || []).map((item) => item.name),
    ...(evidence.menu?.representativeDishes || []).map((item) => item.name),
    ...(evidence.menu?.representativeStalls || []).map((item) => item.name),
    ...(evidence.children || []).map((item) => item.name),
  ]).sort((left, right) => right.length - left.length);
}

function maskEvidenceBackedCatalogNames(text, evidence) {
  let masked = String(text || '').normalize('NFKC');
  for (const name of evidenceBackedCatalogNames(evidence)) {
    masked = masked.replaceAll(name.normalize('NFKC'), '[CATALOG_NAME]');
  }
  return masked;
}

function assertClaimText(text, { recommendation, evidence }) {
  const policyText = maskEvidenceBackedCatalogNames(text, evidence);
  for (const pattern of FORBIDDEN_CLAIMS) {
    if (pattern.test(policyText)) throw Object.assign(new Error(`介绍包含无依据或禁止断言：${text}`), { code: 'FORBIDDEN_CATALOG_CLAIM' });
  }
  if (recommendation && !UNCERTAINTY_MARKER.test(text)) {
    throw Object.assign(new Error(`推荐文案缺少推测边界：${text}`), { code: 'INTRODUCTION_BOUNDARY_REQUIRED' });
  }
  if (evidence.boundaryCodes?.includes('SUPPLY_UNCONFIRMED')) {
    const unsupportedSupply = policyText
      .split(/[。！？!?；;\n]+/)
      .some((segment) => SUPPLY_LANGUAGE.test(segment) && !SUPPLY_UNCERTAINTY.test(segment));
    if (unsupportedSupply) {
      throw Object.assign(new Error(`介绍把目录归属写成了未经核验的供应事实：${text}`), {
        code: 'UNSUPPORTED_CATALOG_SUPPLY_CLAIM',
      });
    }
  }
  const allowedNumbers = collectAllowedNumbers(evidence);
  for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowedNumbers.has(match[0])) throw Object.assign(new Error(`介绍数字没有目录证据：${match[0]}`), { code: 'UNSUPPORTED_CATALOG_NUMBER' });
  }
}

function includesEvidenceText(text, value) {
  const needle = String(value || '').normalize('NFKC').trim();
  return needle.length > 0 && String(text || '').normalize('NFKC').includes(needle);
}

function assertMeaningfulCatalogEvidence(evidence, factualSummary) {
  if (!includesEvidenceText(factualSummary, evidence.entity.name)) {
    throw Object.assign(new Error('事实摘要必须明确写出当前目录实体名称'), {
      code: 'CATALOG_INTRODUCTION_ENTITY_NAME_REQUIRED',
    });
  }
  if (evidence.boundaryCodes.includes('MENU_MISSING')) return;
  if (evidence.hierarchyLevel === 'dish') {
    const evidenceKinds = [
      includesEvidenceText(factualSummary, evidence.entity.priceDisplay),
      [evidence.stall?.name, ...(evidence.hierarchy || []).map((item) => item.name)]
        .some((value) => includesEvidenceText(factualSummary, value)),
      (evidence.siblingDishes || []).some((item) => includesEvidenceText(factualSummary, item.name)),
    ].filter(Boolean).length;
    if (evidenceKinds < 2) {
      throw Object.assign(new Error('菜品事实摘要必须实际使用价格、位置或同档口菜单中的至少两类证据'), {
        code: 'CATALOG_INTRODUCTION_DISH_CONTEXT_REQUIRED',
      });
    }
    return;
  }
  const menu = evidence.menu || {};
  const menuSpecificValues = [
    String(menu.dishCount || ''),
    String(menu.stallCount || ''),
    ...(menu.representativeDishes || []).map((item) => item.name),
    ...(menu.representativeStalls || []).map((item) => item.name),
    ...(menu.semanticGroups || []).map((item) => item.label),
    ...(evidence.children || []).map((item) => item.name),
  ].filter((value) => value && value !== '0');
  if (!menuSpecificValues.some((value) => includesEvidenceText(factualSummary, value))) {
    throw Object.assign(new Error('有菜单实体的事实摘要必须写出具体数量、代表菜、档口或下级场所'), {
      code: 'CATALOG_INTRODUCTION_MENU_CONTEXT_REQUIRED',
    });
  }
}

export function validateCatalogIntroductionCandidate(candidate, evidence) {
  const parsed = catalogIntroductionCandidateSchema.parse(candidate);
  if (parsed.entityType !== evidence.entityType || parsed.entityId !== evidence.entity.id) {
    throw Object.assign(new Error('模型返回的目录实体与输入不一致'), { code: 'CATALOG_INTRODUCTION_ENTITY_MISMATCH' });
  }
  const allowedIds = new Set(evidence.allowedEvidenceIds);
  const validateClaims = (claims, recommendation) => claims.map((claim) => {
    const evidenceIds = uniqueText(claim.evidenceIds);
    if (!evidenceIds.length || evidenceIds.some((id) => !allowedIds.has(id))) {
      throw Object.assign(new Error(`介绍引用了白名单外证据：${evidenceIds.filter((id) => !allowedIds.has(id)).join(', ')}`), { code: 'INVALID_CATALOG_INTRODUCTION_REFERENCE' });
    }
    assertClaimText(claim.text, { recommendation, evidence });
    return { type: recommendation ? 'recommendation' : 'fact', text: sentence(claim.text), evidenceIds };
  });
  const factualClaims = validateClaims(parsed.factualClaims, false);
  const recommendationClaims = validateClaims(parsed.recommendationClaims, true);
  const factualText = factualClaims.map((claim) => claim.text).join('');
  const recommendationText = recommendationClaims.map((claim) => claim.text).join('');
  const catalogNames = uniqueText([
    evidence.entity?.name,
    evidence.stall?.name,
    ...(evidence.hierarchy || []).map((item) => item.name),
    ...(evidence.siblingDishes || []).map((item) => item.name),
  ]).map(normalizeSearchText).filter(Boolean);
  const softSignals = uniqueText([
    ...(evidence.semanticLabels || []),
    ...(evidence.concepts || []).map((item) => item.name),
  ]).filter((label) => {
    const normalized = normalizeSearchText(label);
    return normalized && !catalogNames.some((name) => name.includes(normalized) || normalized.includes(name));
  });
  if (softSignals.some((label) => includesEvidenceText(factualText, label))) {
    throw Object.assign(new Error('派生语义标签只能用于推测性推荐文案，不能写入事实摘要'), {
      code: 'SOFT_SEMANTIC_FACT_CLAIM',
    });
  }
  if (softSignals.some((label) => includesEvidenceText(recommendationText, label))
    && !/(?:可能|可按|可作为|从.{0,12}(?:标签|名称|菜单结构)看)/.test(recommendationText)) {
    throw Object.assign(new Error('使用派生语义标签时必须明确标注为推测'), {
      code: 'SOFT_SEMANTIC_BOUNDARY_REQUIRED',
    });
  }
  if (evidence.boundaryCodes.includes('ENTITY_NAME_REVIEW_REQUIRED')) {
    const combinedText = `${factualText}${recommendationText}`;
    if (!/(?:目录条目)?名称待核验|具体菜品名称.{0,6}待核验/.test(combinedText)) {
      throw Object.assign(new Error('规格型目录名称必须明确标记为名称待核验'), {
        code: 'CATALOG_ENTITY_NAME_REVIEW_WARNING_REQUIRED',
      });
    }
    const policyText = maskEvidenceBackedCatalogNames(combinedText, evidence);
    if (/套餐|(?:属于|归为|划分为|是|为).{0,12}(?:主食|小吃|热菜|饮品|菜品|蛋白质|蔬菜|汤)/.test(policyText)) {
      throw Object.assign(new Error('规格型目录名称不得被推断为具体套餐或菜品类别'), {
        code: 'CATALOG_ENTITY_NAME_CLASSIFICATION_FORBIDDEN',
      });
    }
  }
  if (!evidence.boundaryCodes.includes('MENU_MISSING') && factualClaims.length < 2) {
    throw Object.assign(new Error('有目录内容的实体至少需要两条事实声明'), { code: 'CATALOG_INTRODUCTION_TOO_SHALLOW' });
  }
  if (evidence.hierarchyLevel === 'dish') {
    const factualEvidenceIds = new Set(factualClaims.flatMap((claim) => claim.evidenceIds));
    const ownId = evidenceId('dish', evidence.entity.id);
    const relatedIds = new Set([
      evidence.stall?.id ? evidenceId('stall', evidence.stall.id) : null,
      ...(evidence.hierarchy || []).map((item) => evidenceId('canteen', item.id)),
      ...(evidence.siblingDishes || []).map((item) => evidenceId('dish', item.id)),
    ].filter(Boolean));
    if (!factualEvidenceIds.has(ownId) || ![...factualEvidenceIds].some((id) => relatedIds.has(id))) {
      throw Object.assign(new Error('菜品事实摘要必须同时引用菜品自身与位置或同档口菜单证据'), { code: 'CATALOG_INTRODUCTION_EVIDENCE_DIVERSITY_REQUIRED' });
    }
  }
  const allowedLabels = new Set(uniqueText([
    ...evidence.semanticLabels,
    ...(evidence.concepts || []).map((item) => item.name),
    ...(evidence.menu?.semanticGroups || []).map((item) => item.label),
  ]));
  const semanticLabels = evidence.boundaryCodes.includes('ENTITY_NAME_REVIEW_REQUIRED')
    ? []
    : uniqueText(parsed.semanticLabels).filter((label) => allowedLabels.has(label));
  const boundaryCodes = uniqueText([...evidence.boundaryCodes, ...parsed.boundaryCodes.filter((code) => BOUNDARY_CODES.has(code))]);
  const claims = [...factualClaims, ...recommendationClaims];
  const factualSummary = factualText;
  const recommendationCopy = recommendationText;
  assertMeaningfulCatalogEvidence(evidence, factualSummary);
  return {
    entityType: evidence.entityType,
    hierarchyLevel: evidence.hierarchyLevel,
    entityId: evidence.entity.id,
    factualSummary,
    recommendationCopy,
    claims,
    semanticLabels,
    evidenceIds: uniqueText(claims.flatMap((claim) => claim.evidenceIds)),
    evidenceSnapshot: evidence,
    boundaryCodes,
    confidence: evidence.confidence,
    inputHash: evidence.inputHash,
    contentHash: stableCatalogIntroductionHash({ factualSummary, recommendationCopy, claims, semanticLabels, boundaryCodes }),
  };
}

export function validateCatalogIntroductionBatch(value, evidenceBatch) {
  const parsed = catalogIntroductionBatchSchema.parse(value);
  const byKey = new Map(parsed.introductions.map((item) => [`${item.entityType}:${item.entityId}`, item]));
  if (byKey.size !== evidenceBatch.length) throw Object.assign(new Error('模型返回介绍数量与输入不一致'), { code: 'CATALOG_INTRODUCTION_BATCH_MISMATCH' });
  return evidenceBatch.map((evidence) => {
    const item = byKey.get(`${evidence.entityType}:${evidence.entity.id}`);
    if (!item) throw Object.assign(new Error(`模型缺少实体 ${evidence.entityType}:${evidence.entity.id}`), { code: 'CATALOG_INTRODUCTION_BATCH_MISMATCH' });
    return validateCatalogIntroductionCandidate(item, evidence);
  });
}

export async function generateValidatedCatalogIntroductionBatch({ evidenceBatch, generate, repair }) {
  if (typeof generate !== 'function' || typeof repair !== 'function') throw new TypeError('generate and repair functions are required');
  let first;
  try {
    first = await generate(evidenceBatch);
  } catch (initialGenerationError) {
    if (initialGenerationError?.code !== 'AI_PROVIDER_INVALID_JSON') throw initialGenerationError;
    const repairedOutput = await repair({
      evidenceBatch,
      previousOutput: { invalidJson: String(initialGenerationError.rawOutput || '').slice(0, 4_000) },
      validationError: initialGenerationError,
    });
    return {
      generated: repairedOutput,
      candidates: validateCatalogIntroductionBatch({ introductions: repairedOutput?.introductions }, evidenceBatch),
      repaired: true,
      initialValidationError: initialGenerationError,
    };
  }
  try {
    return {
      generated: first,
      candidates: validateCatalogIntroductionBatch({ introductions: first?.introductions }, evidenceBatch),
      repaired: false,
    };
  } catch (initialValidationError) {
    const repairedOutput = await repair({
      evidenceBatch,
      previousOutput: { introductions: first?.introductions },
      validationError: initialValidationError,
    });
    return {
      generated: repairedOutput,
      candidates: validateCatalogIntroductionBatch({ introductions: repairedOutput?.introductions }, evidenceBatch),
      repaired: true,
      initialValidationError,
    };
  }
}

export function mapCatalogIntroductionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    batchId: row.batch_id,
    entityType: row.entity_type,
    hierarchyLevel: row.hierarchy_level,
    entityId: row.entity_id,
    version: Number(row.version),
    factualSummary: row.factual_summary,
    recommendationCopy: row.recommendation_copy,
    claims: parseJson(row.claim_evidence_json, []),
    semanticLabels: parseJson(row.semantic_labels_json, []),
    evidenceIds: parseJson(row.evidence_ids_json, []),
    evidenceSnapshot: parseJson(row.evidence_snapshot_json, {}),
    boundaryCodes: parseJson(row.boundary_codes_json, []),
    confidence: { score: Number(row.confidence_score || 0), level: row.confidence_level || 'low' },
    model: row.model,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    contentHash: row.content_hash,
    status: row.status,
    previousIntroductionId: row.previous_introduction_id || null,
    error: row.error || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicCatalogIntroduction(record) {
  if (!record || record.status !== 'approved') return null;
  return {
    factualSummary: record.factualSummary,
    recommendationCopy: record.recommendationCopy,
    positioningStatement: record.recommendationCopy,
    hierarchyLevel: record.hierarchyLevel,
    semanticLabels: record.semanticLabels,
    evidenceIds: record.evidenceIds,
    provenance: 'catalog_derived',
    provenanceLabel: '基于目录整理',
    confidence: record.confidence,
    boundaryCodes: record.boundaryCodes,
    version: record.version,
    approvedAt: record.reviewedAt,
  };
}

export function applyCatalogIntroduction(entity, record) {
  const introduction = publicCatalogIntroduction(record);
  return {
    ...entity,
    displayDescription: introduction?.factualSummary || entity.description || '',
    displayTagline: introduction?.positioningStatement || '',
    introduction,
  };
}

export async function loadCatalogIntroductionMap(db, {
  tenantId = 'default', entityType = '', statuses = ['approved'], batchId = '', entityIds = [],
  requireCurrent = false, currentInputHashes = null,
} = {}) {
  const result = new Map();
  let expectedHashes = currentInputHashes;
  if (requireCurrent && !expectedHashes) {
    const catalog = await loadCatalogIntroductionEvidence(db, { tenantId });
    expectedHashes = new Map(catalog.evidence.map((item) => [`${item.entityType}:${item.entity.id}`, item.inputHash]));
  }
  const normalizedIds = uniqueText(entityIds);
  const idChunks = normalizedIds.length
    ? Array.from({ length: Math.ceil(normalizedIds.length / 400) }, (_, index) => normalizedIds.slice(index * 400, (index + 1) * 400))
    : [[]];
  for (const ids of idChunks) {
    const clauses = ['tenant_id = ?'];
    const params = [tenantId];
    if (entityType) { clauses.push('entity_type = ?'); params.push(entityType); }
    if (statuses.length) { clauses.push(`status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
    if (batchId) { clauses.push('batch_id = ?'); params.push(batchId); }
    if (ids.length) { clauses.push(`entity_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    const rows = await db.prepare(`SELECT * FROM catalog_entity_introductions WHERE ${clauses.join(' AND ')} ORDER BY version DESC`).all(...params);
    for (const row of rows) {
      const record = mapCatalogIntroductionRow(row);
      const key = `${record.entityType}:${record.entityId}`;
      if (requireCurrent && expectedHashes?.get(key) !== record.inputHash) continue;
      if (!result.has(key)) result.set(key, record);
    }
  }
  return result;
}

export async function loadCatalogIntroductionInputHashes(db, tenantId = 'default') {
  const catalog = await loadCatalogIntroductionEvidence(db, { tenantId });
  return new Map(catalog.evidence.map((item) => [`${item.entityType}:${item.entity.id}`, item.inputHash]));
}

export async function nextCatalogIntroductionVersions(db, tenantId = 'default') {
  const rows = await db.prepare('SELECT entity_type, entity_id, MAX(version) AS version FROM catalog_entity_introductions WHERE tenant_id = ? GROUP BY entity_type, entity_id').all(tenantId);
  return new Map(rows.map((row) => [`${row.entity_type}:${row.entity_id}`, Number(row.version || 0) + 1]));
}

export async function createCatalogIntroductionBatch(db, {
  id = `catalog-intro-${randomUUID()}`, tenantId = 'default', model, promptVersion = CATALOG_INTRODUCTION_PROMPT_VERSION,
  catalogDataVersion = '', snapshotHash, entityCount, createdBy = null,
}) {
  const existingById = await db.prepare('SELECT * FROM catalog_introduction_batches WHERE id = ?').get(id);
  if (existingById) {
    const sameBatch = existingById.tenant_id === tenantId
      && existingById.catalog_snapshot_hash === snapshotHash
      && existingById.prompt_version === promptVersion
      && existingById.model === model;
    if (!sameBatch) {
      throw Object.assign(new Error('目录介绍批次 ID 已用于其他目录快照或模型配置'), {
        status: 409,
        code: 'CATALOG_INTRODUCTION_BATCH_ID_CONFLICT',
      });
    }
    return existingById;
  }
  const timestamp = new Date().toISOString();
  await db.prepare(`INSERT INTO catalog_introduction_batches (
    id, tenant_id, model, prompt_version, catalog_data_version, catalog_snapshot_hash, status,
    entity_count, completed_count, failed_count, concurrency_json, metrics_json, error,
    created_by, reviewed_by, approved_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'preparing', ?, 0, 0, '{}', '{}', NULL, ?, NULL, NULL, ?, ?)
  ON CONFLICT(tenant_id, catalog_snapshot_hash, prompt_version, model) DO NOTHING`).run(
    id, tenantId, model, promptVersion, catalogDataVersion, snapshotHash, Number(entityCount || 0), createdBy, timestamp, timestamp,
  );
  return db.prepare('SELECT * FROM catalog_introduction_batches WHERE tenant_id = ? AND catalog_snapshot_hash = ? AND prompt_version = ? AND model = ?').get(tenantId, snapshotHash, promptVersion, model);
}

export async function updateCatalogIntroductionBatch(db, batchId, tenantId, fields = {}) {
  const allowed = new Map([
    ['status', 'status'], ['completedCount', 'completed_count'], ['failedCount', 'failed_count'],
    ['concurrency', 'concurrency_json'], ['metrics', 'metrics_json'], ['error', 'error'],
    ['reviewedBy', 'reviewed_by'], ['approvedAt', 'approved_at'],
  ]);
  const sets = [];
  const params = [];
  for (const [key, column] of allowed) {
    if (!(key in fields)) continue;
    sets.push(`${column} = ?`);
    params.push(['concurrency', 'metrics'].includes(key) ? serializeJson(fields[key]) : fields[key]);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), tenantId, batchId);
  await db.prepare(`UPDATE catalog_introduction_batches SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...params);
}

export async function saveCatalogIntroductionCandidate(db, {
  tenantId = 'default', batchId, version, model, promptVersion = CATALOG_INTRODUCTION_PROMPT_VERSION, candidate,
}) {
  const timestamp = new Date().toISOString();
  const id = `catalog-intro-item-${stableCatalogIntroductionHash({ tenantId, batchId, entityType: candidate.entityType, entityId: candidate.entityId, inputHash: candidate.inputHash }).slice(0, 24)}`;
  await db.prepare(`INSERT INTO catalog_entity_introductions (
    id, tenant_id, batch_id, entity_type, hierarchy_level, entity_id, version,
    factual_summary, recommendation_copy, claim_evidence_json, semantic_labels_json,
    evidence_ids_json, evidence_snapshot_json, boundary_codes_json, confidence_score,
    confidence_level, model, prompt_version, input_hash, content_hash, status,
    previous_introduction_id, error, reviewed_by, reviewed_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'schema_validated', NULL, NULL, NULL, NULL, ?, ?)
  ON CONFLICT(tenant_id, entity_type, entity_id, batch_id, input_hash) DO UPDATE SET
    factual_summary=excluded.factual_summary, recommendation_copy=excluded.recommendation_copy,
    claim_evidence_json=excluded.claim_evidence_json, semantic_labels_json=excluded.semantic_labels_json,
    evidence_ids_json=excluded.evidence_ids_json, evidence_snapshot_json=excluded.evidence_snapshot_json,
    boundary_codes_json=excluded.boundary_codes_json, confidence_score=excluded.confidence_score,
    confidence_level=excluded.confidence_level, model=excluded.model, prompt_version=excluded.prompt_version,
    content_hash=excluded.content_hash, status=CASE WHEN catalog_entity_introductions.status='approved' THEN 'approved' ELSE 'schema_validated' END,
    error=NULL, updated_at=excluded.updated_at`).run(
    id, tenantId, batchId, candidate.entityType, candidate.hierarchyLevel, candidate.entityId, version,
    candidate.factualSummary, candidate.recommendationCopy, serializeJson(candidate.claims), serializeJson(candidate.semanticLabels),
    serializeJson(candidate.evidenceIds), serializeJson(candidate.evidenceSnapshot), serializeJson(candidate.boundaryCodes),
    candidate.confidence.score, candidate.confidence.level, model, promptVersion, candidate.inputHash, candidate.contentHash,
    timestamp, timestamp,
  );
  return mapCatalogIntroductionRow(await db.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND batch_id = ? AND input_hash = ?').get(tenantId, candidate.entityType, candidate.entityId, batchId, candidate.inputHash));
}

export async function listCatalogIntroductionBatches(db, tenantId = 'default') {
  const rows = await db.prepare('SELECT * FROM catalog_introduction_batches WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
  return rows.map((row) => ({
    id: row.id, tenantId: row.tenant_id, model: row.model, promptVersion: row.prompt_version,
    catalogDataVersion: row.catalog_data_version, catalogSnapshotHash: row.catalog_snapshot_hash,
    status: row.status, entityCount: Number(row.entity_count || 0), completedCount: Number(row.completed_count || 0),
    failedCount: Number(row.failed_count || 0), concurrency: parseJson(row.concurrency_json, {}), metrics: parseJson(row.metrics_json, {}),
    error: row.error || null, reviewedBy: row.reviewed_by || null, approvedAt: row.approved_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export async function listCatalogIntroductionCandidates(db, { tenantId = 'default', batchId = '', status = '', entityType = '', query = '', limit = 50, offset = 0 } = {}) {
  const clauses = ['tenant_id = ?'];
  const params = [tenantId];
  if (batchId) { clauses.push('batch_id = ?'); params.push(batchId); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (entityType) { clauses.push('entity_type = ?'); params.push(entityType); }
  if (query) { clauses.push("LOWER(factual_summary || ' ' || recommendation_copy || ' ' || entity_id) LIKE ?"); params.push(`%${String(query).toLocaleLowerCase()}%`); }
  const where = clauses.join(' AND ');
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM catalog_entity_introductions WHERE ${where}`).get(...params))?.count || 0);
  const rows = await db.prepare(`SELECT * FROM catalog_entity_introductions WHERE ${where} ORDER BY hierarchy_level, entity_id LIMIT ? OFFSET ?`).all(...params, Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
  return { items: rows.map(mapCatalogIntroductionRow), total };
}

export function auditCatalogIntroductionRecords(records = []) {
  const duplicates = new Map();
  const missingNames = [];
  const invalidEvidence = [];
  for (const record of records) {
    const key = `${String(record.factualSummary || '').normalize('NFKC').trim()}\n${String(record.recommendationCopy || '').normalize('NFKC').trim()}`;
    if (!record.boundaryCodes.includes('MENU_MISSING')) duplicates.set(key, [...(duplicates.get(key) || []), record.id]);
    if (!includesEvidenceText(record.factualSummary, record.evidenceSnapshot?.entity?.name)) missingNames.push(record.id);
    const allowed = new Set(record.evidenceSnapshot?.allowedEvidenceIds || []);
    if (!record.evidenceIds.length || record.evidenceIds.some((id) => !allowed.has(id))) invalidEvidence.push(record.id);
  }
  const duplicateGroups = [...duplicates.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([text, ids]) => ({ textHash: stableCatalogIntroductionHash(text), ids }));
  return {
    recordCount: records.length,
    inputHashCoverage: records.filter((record) => Boolean(record.inputHash)).length,
    evidenceCoverage: records.length - invalidEvidence.length,
    entityNameCoverage: records.length - missingNames.length,
    duplicateMenuIntroductionCount: duplicateGroups.reduce((sum, group) => sum + group.ids.length, 0),
    duplicateGroups: duplicateGroups.slice(0, 20),
    missingNames: missingNames.slice(0, 20),
    invalidEvidence: invalidEvidence.slice(0, 20),
    ok: records.length > 0 && invalidEvidence.length === 0 && missingNames.length === 0 && duplicateGroups.length === 0,
  };
}

async function inTransaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function approvalDigest(records) {
  return stableCatalogIntroductionHash(records.map((record) => ({ id: record.id, inputHash: record.inputHash, contentHash: record.contentHash, status: record.status })).sort((left, right) => left.id.localeCompare(right.id)));
}

export async function previewCatalogIntroductionBatchApproval(db, { tenantId = 'default', batchId }) {
  const batch = await db.prepare('SELECT * FROM catalog_introduction_batches WHERE tenant_id = ? AND id = ?').get(tenantId, batchId);
  if (!batch) throw Object.assign(new Error('介绍批次不存在'), { status: 404, code: 'CATALOG_INTRODUCTION_BATCH_NOT_FOUND' });
  const rows = await db.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND batch_id = ? ORDER BY hierarchy_level, entity_id').all(tenantId, batchId);
  const records = rows.map(mapCatalogIntroductionRow);
  const catalog = await loadCatalogIntroductionEvidence(db, { tenantId });
  const currentHashes = new Map(catalog.evidence.map((item) => [`${item.entityType}:${item.entity.id}`, item.inputHash]));
  const stale = records.filter((record) => currentHashes.get(`${record.entityType}:${record.entityId}`) !== record.inputHash);
  const invalid = records.filter((record) => !['schema_validated', 'approved'].includes(record.status));
  const missingCount = Math.max(0, Number(batch.entity_count || 0) - records.length);
  const lowConfidence = records.filter((record) => record.confidence.level === 'low');
  const sample = [];
  for (const level of CATALOG_INTRODUCTION_LEVELS) sample.push(...records.filter((record) => record.hierarchyLevel === level).slice(0, 3));
  sample.push(...lowConfidence.slice(0, 5));
  return {
    batchId,
    entityCount: Number(batch.entity_count || 0),
    candidateCount: records.length,
    missingCount,
    staleCount: stale.length,
    invalidCount: invalid.length,
    lowConfidenceCount: lowConfidence.length,
    approvable: missingCount === 0 && stale.length === 0 && invalid.length === 0 && records.length > 0,
    approvalDigest: approvalDigest(records),
    requiredConfirmation: `批准全校介绍 ${batchId}`,
    stale: stale.slice(0, 20).map((record) => ({ id: record.id, entityType: record.entityType, entityId: record.entityId })),
    invalid: invalid.slice(0, 20).map((record) => ({ id: record.id, status: record.status })),
    sample: [...new Map(sample.map((record) => [record.id, record])).values()],
  };
}

export async function approveCatalogIntroductionBatch(db, { tenantId = 'default', batchId, confirmation, expectedDigest, reviewedBy }) {
  return inTransaction(db, async (tx) => {
    const preview = await previewCatalogIntroductionBatchApproval(tx, { tenantId, batchId });
    if (confirmation !== preview.requiredConfirmation) throw Object.assign(new Error('整批批准确认文字不匹配'), { status: 400, code: 'CATALOG_INTRODUCTION_CONFIRMATION_REQUIRED' });
    if (expectedDigest !== preview.approvalDigest) throw Object.assign(new Error('介绍批次已变化，请重新预览'), { status: 409, code: 'CATALOG_INTRODUCTION_BATCH_CHANGED' });
    if (!preview.approvable) throw Object.assign(new Error('介绍批次存在缺失、过期或无效记录'), { status: 409, code: 'CATALOG_INTRODUCTION_BATCH_NOT_APPROVABLE', preview });
    const timestamp = new Date().toISOString();
    const rows = await tx.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND batch_id = ?').all(tenantId, batchId);
    for (const row of rows) {
      const previous = await tx.prepare("SELECT id FROM catalog_entity_introductions WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND status = 'approved' AND id <> ?").get(tenantId, row.entity_type, row.entity_id, row.id);
      if (previous) await tx.prepare("UPDATE catalog_entity_introductions SET status = 'retired', updated_at = ? WHERE tenant_id = ? AND id = ?").run(timestamp, tenantId, previous.id);
      await tx.prepare("UPDATE catalog_entity_introductions SET status = 'approved', previous_introduction_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?").run(previous?.id || null, reviewedBy, timestamp, timestamp, tenantId, row.id);
    }
    await updateCatalogIntroductionBatch(tx, batchId, tenantId, { status: 'approved', reviewedBy, approvedAt: timestamp });
    return { ...preview, approvedCount: rows.length, approvedAt: timestamp };
  });
}

export async function rollbackCatalogIntroductionBatch(db, { tenantId = 'default', batchId, confirmation, reviewedBy }) {
  const required = `回滚介绍批次 ${batchId}`;
  if (confirmation !== required) throw Object.assign(new Error('整批回滚确认文字不匹配'), { status: 400, code: 'CATALOG_INTRODUCTION_ROLLBACK_CONFIRMATION_REQUIRED', requiredConfirmation: required });
  return inTransaction(db, async (tx) => {
    const rows = await tx.prepare("SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND batch_id = ? AND status = 'approved'").all(tenantId, batchId);
    if (!rows.length) throw Object.assign(new Error('该批次没有可回滚的批准记录'), { status: 409, code: 'CATALOG_INTRODUCTION_BATCH_NOT_ACTIVE' });
    const timestamp = new Date().toISOString();
    for (const row of rows) {
      await tx.prepare("UPDATE catalog_entity_introductions SET status = 'retired', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?").run(reviewedBy, timestamp, timestamp, tenantId, row.id);
      if (row.previous_introduction_id) await tx.prepare("UPDATE catalog_entity_introductions SET status = 'approved', updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'retired'").run(timestamp, tenantId, row.previous_introduction_id);
    }
    await updateCatalogIntroductionBatch(tx, batchId, tenantId, { status: 'rolled_back', reviewedBy });
    return { batchId, rolledBackCount: rows.length, requiredConfirmation: required, rolledBackAt: timestamp };
  });
}

function splitEditedClaims(value) {
  return (String(value || '').normalize('NFKC').match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
    .map((item) => item.trim().replace(/[。！？!?；;\s]+$/g, ''))
    .filter(Boolean);
}

function editedClaimInputs(text, existingClaims, type) {
  const claims = existingClaims.filter((claim) => claim.type === type);
  const sentences = splitEditedClaims(text);
  if (sentences.length !== claims.length) {
    throw Object.assign(new Error('编辑介绍时不能增删声明句；请逐句修改并保留原证据结构'), {
      status: 400,
      code: 'CATALOG_INTRODUCTION_CLAIM_COUNT_CHANGED',
    });
  }
  return sentences.map((sentenceText, index) => ({
    text: sentenceText,
    evidenceIds: claims[index].evidenceIds,
  }));
}

export async function updateCatalogIntroductionCandidate(db, { tenantId = 'default', id, factualSummary, recommendationCopy, status, expectedUpdatedAt, reviewedBy }) {
  const existing = mapCatalogIntroductionRow(await db.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND id = ?').get(tenantId, id));
  if (!existing) throw Object.assign(new Error('介绍候选不存在'), { status: 404, code: 'CATALOG_INTRODUCTION_NOT_FOUND' });
  if (expectedUpdatedAt && expectedUpdatedAt !== existing.updatedAt) throw Object.assign(new Error('介绍候选已被其他人修改'), { status: 409, code: 'CATALOG_INTRODUCTION_CHANGED' });
  const nextFact = factualSummary === undefined ? existing.factualSummary : String(factualSummary).trim();
  const nextRecommendation = recommendationCopy === undefined ? existing.recommendationCopy : String(recommendationCopy).trim();
  const nextStatus = status || 'schema_validated';
  if (!['schema_validated', 'approved', 'rejected'].includes(nextStatus)) throw Object.assign(new Error('不支持的介绍审核状态'), { status: 400 });
  const validated = validateCatalogIntroductionCandidate({
    entityType: existing.entityType,
    entityId: existing.entityId,
    factualClaims: editedClaimInputs(nextFact, existing.claims, 'fact'),
    recommendationClaims: editedClaimInputs(nextRecommendation, existing.claims, 'recommendation'),
    semanticLabels: existing.semanticLabels,
    boundaryCodes: existing.boundaryCodes,
  }, existing.evidenceSnapshot);
  if (nextStatus === 'approved') {
    const currentHashes = await loadCatalogIntroductionInputHashes(db, tenantId);
    if (currentHashes.get(`${existing.entityType}:${existing.entityId}`) !== existing.inputHash) {
      throw Object.assign(new Error('目录事实已变化，请重新生成该实体介绍后再批准'), {
        status: 409,
        code: 'CATALOG_INTRODUCTION_STALE',
      });
    }
  }
  const timestamp = new Date().toISOString();
  return inTransaction(db, async (tx) => {
    let previousId = existing.previousIntroductionId;
    if (nextStatus === 'approved') {
      const previous = await tx.prepare("SELECT id FROM catalog_entity_introductions WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND status = 'approved' AND id <> ?").get(tenantId, existing.entityType, existing.entityId, id);
      previousId = previous?.id || previousId || null;
      if (previous) await tx.prepare("UPDATE catalog_entity_introductions SET status = 'retired', updated_at = ? WHERE tenant_id = ? AND id = ?").run(timestamp, tenantId, previous.id);
    }
    await tx.prepare(`UPDATE catalog_entity_introductions SET factual_summary = ?, recommendation_copy = ?, claim_evidence_json = ?, evidence_ids_json = ?, content_hash = ?, status = ?, previous_introduction_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
      validated.factualSummary, validated.recommendationCopy, serializeJson(validated.claims), serializeJson(validated.evidenceIds),
      validated.contentHash, nextStatus, previousId, reviewedBy, timestamp, timestamp, tenantId, id,
    );
    return mapCatalogIntroductionRow(await tx.prepare('SELECT * FROM catalog_entity_introductions WHERE tenant_id = ? AND id = ?').get(tenantId, id));
  });
}
