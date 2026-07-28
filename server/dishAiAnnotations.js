import { createHash } from 'node:crypto';
import { z } from 'zod';

export const DISH_AI_ANNOTATION_PROMPT_VERSION = 'dish-annotation-2026.07.7';
export const DISH_AI_ANNOTATION_STATUSES = Object.freeze(['generated', 'schema_validated', 'approved', 'rejected']);

const textValue = z.string().trim().min(1).max(80);
const confidenceValue = z.number().min(0).max(1);
const textList = (maximum, minimum = 0) => {
  const schema = z.array(textValue).max(maximum);
  return minimum > 0 ? schema.min(minimum) : schema;
};
const hypothesisSchema = z.object({
  name: textValue,
  role: z.enum(['staple', 'primary', 'secondary', 'seasoning']),
  confidence: confidenceValue,
  basis: z.enum(['dish_name', 'stall_context', 'knowledge_reference', 'model_prior']),
  referenceIds: textList(8).default([]),
});
const allergenHintSchema = z.object({
  allergenCode: textValue,
  confidence: confidenceValue,
  reason: z.string().trim().min(4).max(240),
  referenceIds: textList(8).default([]),
});
const rangeSchema = (maximum) => z.object({
  min: z.number().nonnegative().max(maximum),
  max: z.number().nonnegative().max(maximum),
}).refine((value) => value.min <= value.max, '营养区间最小值不得大于最大值');

export const dishAiAnnotationSchema = z.object({
  dishId: textValue,
  factStatus: z.literal('estimated'),
  safetyStatus: z.literal('unknown'),
  aliases: textList(8).default([]),
  cuisineCandidates: textList(5).default([]),
  cookingMethods: textList(6).default([]),
  tasteProfiles: textList(8).default([]),
  spiceLevel: z.number().int().min(0).max(5).nullable(),
  mealTypes: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'late_snack'])).max(4).default([]),
  ingredientHypotheses: z.array(hypothesisSchema).max(16).default([]),
  seasoningHypotheses: z.array(hypothesisSchema).max(12).default([]),
  allergenHints: z.array(allergenHintSchema).max(12).default([]),
  nutritionEstimate: z.object({
    basis: z.enum(['per_serving', 'per_100g']),
    portionAssumption: z.string().trim().min(4).max(160),
    caloriesKcal: rangeSchema(2000),
    proteinG: rangeSchema(250),
    fatG: rangeSchema(250),
    carbsG: rangeSchema(350),
    confidence: confidenceValue,
    referenceIds: textList(12).default([]),
  }).nullable(),
  scenarioTags: textList(10).default([]),
  nutritionGoalTags: textList(10).default([]),
  linkedConceptIds: textList(12).default([]),
  sourceIds: textList(24).default([]),
  uncertaintyNotes: textList(8).default([]),
  fieldConfidence: z.record(z.string().trim().min(1), confidenceValue),
}).strict();

export const dishAiAnnotationGenerationSchema = dishAiAnnotationSchema.extend({
  uncertaintyNotes: textList(8, 1),
  fieldConfidence: z.object({
    aliases: confidenceValue,
    cuisineCandidates: confidenceValue,
    cookingMethods: confidenceValue,
    tasteProfiles: confidenceValue,
    spiceLevel: confidenceValue,
    mealTypes: confidenceValue,
    ingredientHypotheses: confidenceValue,
    seasoningHypotheses: confidenceValue,
    allergenHints: confidenceValue,
    nutritionEstimate: confidenceValue,
    scenarioTags: confidenceValue,
    nutritionGoalTags: confidenceValue,
  }).strict(),
}).strict();

export const dishAiAnnotationBatchSchema = z.object({
  annotations: z.array(z.unknown()).min(1).max(10),
}).strict();

const { $schema: _dishSchemaVersion, ...dishAiAnnotationJsonSchema } = z.toJSONSchema(dishAiAnnotationGenerationSchema, {
  target: 'draft-7',
  unrepresentable: 'any',
});
export const DISH_AI_ANNOTATION_BATCH_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['annotations'],
  properties: {
    annotations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: dishAiAnnotationJsonSchema,
    },
  },
});

function normalizedText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function stableHash(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function rowValue(row, camel, snake = camel) {
  return row?.[camel] ?? row?.[snake];
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  try { return JSON.parse(value); } catch { return []; }
}

function balancedStableTake(rows, count, seed, used) {
  const groups = new Map();
  for (const row of rows) {
    if (used.has(row.id)) continue;
    const group = groups.get(row.canteenId) || [];
    group.push(row);
    groups.set(row.canteenId, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => stableHash(`${seed}:${left.id}`).localeCompare(stableHash(`${seed}:${right.id}`)));
  }
  const keys = [...groups.keys()].sort((left, right) => stableHash(`${seed}:${left}`).localeCompare(stableHash(`${seed}:${right}`)));
  const selected = [];
  while (selected.length < count) {
    let progressed = false;
    for (const key of keys) {
      const row = groups.get(key)?.shift();
      if (!row) continue;
      selected.push(row);
      used.add(row.id);
      progressed = true;
      if (selected.length >= count) break;
    }
    if (!progressed) break;
  }
  return selected;
}

/** Select a deterministic, location-balanced dish pilot across pricing modes. */
export function selectDishAnnotationPilot(catalog, { count = 200, seed = '20260728' } = {}) {
  const stalls = new Map((catalog.stalls || []).map((stall) => [stall.id, stall]));
  const canteens = new Map((catalog.canteens || []).map((canteen) => [canteen.id, canteen]));
  const rows = (catalog.dishes || []).filter((dish) => dish.status === 'active').map((dish) => {
    const stall = stalls.get(dish.stallId);
    const canteen = canteens.get(stall?.canteenId);
    return {
      ...dish,
      stallId: stall?.id || dish.stallId,
      stallName: stall?.name || '',
      canteenId: canteen?.id || '',
      canteenName: canteen?.name || '',
      parentCanteenId: canteen?.parentId || null,
      pricingMode: dish.pricingMode || 'fixed',
    };
  }).filter((dish) => dish.id && dish.stallId && dish.canteenId);
  if (rows.length < count) throw new Error(`菜品不足：需要 ${count} 道，实际 ${rows.length} 道`);

  const modeTargets = { per_person: 3, per_weight: 20, per_unit: 15, variants: 20, tiered: 40, fixed: 102 };
  const used = new Set();
  const selected = [];
  for (const [mode, target] of Object.entries(modeTargets)) {
    const remaining = count - selected.length;
    if (remaining <= 0) break;
    const pool = rows.filter((dish) => dish.pricingMode === mode);
    const scaledTarget = count === 200 ? target : Math.max(1, Math.round((target * count) / 200));
    selected.push(...balancedStableTake(pool, Math.min(scaledTarget, pool.length, remaining), `${seed}:${mode}`, used));
  }
  if (selected.length < count) {
    selected.push(...balancedStableTake(rows, count - selected.length, `${seed}:remainder`, used));
  }
  if (selected.length !== count || new Set(selected.map((dish) => dish.id)).size !== count) {
    throw new Error(`${count}道预标注抽样失败：得到 ${selected.length} 道，唯一 ${new Set(selected.map((dish) => dish.id)).size} 道`);
  }
  return selected.map((dish, index) => ({ ...dish, annotationSampleIndex: index + 1, annotationSampleSeed: seed }));
}

export function matchDishConcepts(dish, concepts = [], limit = 8) {
  const search = normalizedText([
    dish.name,
    dish.stallName,
    dish.canteenName,
    ...parseList(dish.aliases),
    ...parseList(dish.semanticLabels),
  ].join(' '));
  return concepts.filter((concept) => concept.status === 'approved').map((concept) => {
    const terms = [concept.canonicalName, ...(concept.aliases || []), ...(concept.softTags || [])];
    let score = 0;
    for (const term of terms) {
      const normalized = normalizedText(term);
      if (!normalized) continue;
      if (search.includes(normalized)) score += normalized === normalizedText(concept.canonicalName) ? 6 : 3;
    }
    return { ...concept, matchScore: score };
  }).filter((concept) => concept.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function matchFoodCompositionReferences(dish, references = [], limit = 8) {
  const search = normalizedText([
    dish.name,
    ...parseList(dish.aliases),
    ...parseList(dish.semanticLabels),
  ].join(' '));
  return references.map((reference) => {
    const terms = [reference.canonicalName.replace(/参考食材$/, ''), ...(reference.aliases || [])];
    const matched = terms.filter((term) => {
      const normalized = normalizedText(term);
      return normalized.length >= 1 && search.includes(normalized);
    });
    return { ...reference, matchScore: matched.reduce((score, item) => Math.max(score, normalizedText(item).length), 0) };
  }).filter((reference) => reference.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function buildDishAnnotationInput(dish, { concepts = [], references = [], healthDocuments = [], model, promptVersion = DISH_AI_ANNOTATION_PROMPT_VERSION } = {}) {
  const matchedConcepts = matchDishConcepts(dish, concepts);
  const matchedReferences = matchFoodCompositionReferences(dish, references);
  const approvedHealth = healthDocuments.filter((document) => {
    const status = document.status || document.metadata?.sourceStatus;
    const domain = document.knowledgeDomain || document.metadata?.knowledgeDomain;
    return status === 'approved'
      && ['nutrition', 'food_composition', 'food_safety', 'allergy_safety'].includes(domain);
  }).slice(0, 5);
  const payload = {
    dish: {
      id: dish.id,
      name: dish.name,
      priceDisplay: dish.priceDisplay,
      pricingMode: dish.pricingMode,
      stall: dish.stallName,
      canteen: dish.canteenName,
      aliases: parseList(dish.aliases),
      semanticLabels: parseList(dish.semanticLabels),
    },
    concepts: matchedConcepts.map((concept) => ({
      id: concept.id,
      name: concept.canonicalName,
      category: concept.category,
      description: concept.description,
      softTags: concept.softTags,
      boundary: concept.boundary,
    })),
    foodCompositionReferences: matchedReferences.map((reference) => ({
      id: reference.id,
      name: reference.canonicalName,
      aliases: reference.aliases,
      basisGrams: reference.basisGrams,
      nutrients: reference.nutrients,
      factStatus: reference.factStatus,
      policy: reference.campusDishFactPolicy,
    })),
    healthKnowledge: approvedHealth.map((document) => ({
      id: document.id,
      title: document.title,
      domain: document.knowledgeDomain || document.metadata?.knowledgeDomain,
      content: document.content,
      factStatus: document.factStatus || document.metadata?.factStatus,
      safetyBoundary: document.safetyBoundary || document.metadata?.safetyBoundary,
    })),
  };
  const inputHash = stableHash(JSON.stringify({ model, promptVersion, payload }));
  return {
    payload,
    inputHash,
    allowedConceptIds: new Set(matchedConcepts.map((concept) => concept.id)),
    allowedReferenceIds: new Set(matchedReferences.map((reference) => reference.id)),
    allowedSourceIds: new Set([
      ...matchedConcepts.map((concept) => concept.id),
      ...matchedReferences.map((reference) => reference.id),
      ...approvedHealth.map((document) => document.id),
    ]),
  };
}

function ensureSubset(values, allowed, label) {
  const invalid = values.filter((value) => !allowed.has(value));
  if (invalid.length) throw new Error(`${label} 包含未提供的引用：${invalid.join('、')}`);
}

const MEAL_TYPE_ALIASES = new Map([
  ['早餐', 'breakfast'],
  ['早饭', 'breakfast'],
  ['午餐', 'lunch'],
  ['午饭', 'lunch'],
  ['晚餐', 'dinner'],
  ['晚饭', 'dinner'],
  ['夜宵', 'late_snack'],
  ['宵夜', 'late_snack'],
]);

function normalizeDishAiAnnotationCandidate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const unique = (value) => Array.isArray(value) ? [...new Set(value)] : value;
  const normalizeReferences = (items) => Array.isArray(items)
    ? items.map((item) => item && typeof item === 'object' ? { ...item, referenceIds: unique(item.referenceIds) } : item)
    : items;
  return {
    ...raw,
    aliases: unique(raw.aliases),
    cuisineCandidates: unique(raw.cuisineCandidates),
    cookingMethods: unique(raw.cookingMethods),
    tasteProfiles: unique(raw.tasteProfiles),
    mealTypes: Array.isArray(raw.mealTypes)
      ? unique(raw.mealTypes.map((value) => MEAL_TYPE_ALIASES.get(String(value).trim()) || value))
      : raw.mealTypes,
    ingredientHypotheses: normalizeReferences(raw.ingredientHypotheses),
    seasoningHypotheses: normalizeReferences(raw.seasoningHypotheses),
    allergenHints: normalizeReferences(raw.allergenHints),
    nutritionEstimate: raw.nutritionEstimate && typeof raw.nutritionEstimate === 'object'
      ? { ...raw.nutritionEstimate, referenceIds: unique(raw.nutritionEstimate.referenceIds) }
      : raw.nutritionEstimate,
    scenarioTags: unique(raw.scenarioTags),
    nutritionGoalTags: unique(raw.nutritionGoalTags),
    linkedConceptIds: unique(raw.linkedConceptIds),
    sourceIds: unique(raw.sourceIds),
    uncertaintyNotes: unique(raw.uncertaintyNotes),
  };
}

export function validateDishAiAnnotation(raw, { dishId, allowedConceptIds = new Set(), allowedReferenceIds = new Set(), allowedSourceIds = new Set() } = {}) {
  const parsed = dishAiAnnotationGenerationSchema.parse(normalizeDishAiAnnotationCandidate(raw));
  if (parsed.dishId !== dishId) throw new Error(`预标注菜品 ID 不匹配：${parsed.dishId} != ${dishId}`);
  ensureSubset(parsed.linkedConceptIds, allowedConceptIds, 'linkedConceptIds');
  ensureSubset(parsed.sourceIds, allowedSourceIds, 'sourceIds');
  ensureSubset(parsed.nutritionEstimate?.referenceIds || [], allowedReferenceIds, 'nutritionEstimate.referenceIds');
  for (const item of [...parsed.ingredientHypotheses, ...parsed.seasoningHypotheses, ...parsed.allergenHints]) {
    ensureSubset(item.referenceIds || [], allowedSourceIds, `${item.name || item.allergenCode}.referenceIds`);
  }
  const referencedIds = new Set([
    ...parsed.linkedConceptIds,
    ...(parsed.nutritionEstimate?.referenceIds || []),
    ...parsed.ingredientHypotheses.flatMap((item) => item.referenceIds || []),
    ...parsed.seasoningHypotheses.flatMap((item) => item.referenceIds || []),
    ...parsed.allergenHints.flatMap((item) => item.referenceIds || []),
  ]);
  const missingSourceIds = [...referencedIds].filter((id) => !parsed.sourceIds.includes(id));
  if (missingSourceIds.length) throw new Error(`sourceIds 缺少实际引用：${missingSourceIds.join('、')}`);
  const serialized = JSON.stringify(parsed);
  for (const forbidden of ['confirmed_absent', 'confirmed_present', 'cross_contact_possible', 'verified']) {
    if (serialized.includes(`"${forbidden}"`)) throw new Error(`AI预标注不得生成权威状态 ${forbidden}`);
  }
  return parsed;
}

export function annotationRecord({ tenantId = 'default', batchId, model, promptVersion = DISH_AI_ANNOTATION_PROMPT_VERSION, inputHash, annotation, status = 'schema_validated', error = null, now = new Date().toISOString() }) {
  const id = `dish-ai-${stableHash(`${tenantId}:${annotation.dishId}:${batchId}:${inputHash}`).slice(0, 24)}`;
  return {
    id,
    tenantId,
    dishId: annotation.dishId,
    batchId,
    model,
    promptVersion,
    inputHash,
    annotation,
    fieldConfidence: annotation.fieldConfidence,
    linkedConceptIds: annotation.linkedConceptIds,
    sourceIds: annotation.sourceIds,
    status,
    error,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveDishAiAnnotation(db, record) {
  const values = [
    record.id, record.tenantId, record.dishId, record.batchId, record.model, record.promptVersion,
    record.inputHash, JSON.stringify(record.annotation), JSON.stringify(record.fieldConfidence || {}),
    JSON.stringify(record.linkedConceptIds || []), JSON.stringify(record.sourceIds || []), record.status,
    record.error || null, record.createdAt, record.updatedAt,
  ];
  await db.prepare(
    `INSERT INTO dish_ai_annotations (
       id, tenant_id, dish_id, batch_id, model, prompt_version, input_hash,
       annotation_json, field_confidence_json, linked_concept_ids_json, source_ids_json,
       status, error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, dish_id, batch_id, input_hash) DO UPDATE SET
       model = excluded.model,
       prompt_version = excluded.prompt_version,
       annotation_json = excluded.annotation_json,
       field_confidence_json = excluded.field_confidence_json,
       linked_concept_ids_json = excluded.linked_concept_ids_json,
       source_ids_json = excluded.source_ids_json,
       status = excluded.status,
       error = excluded.error,
       updated_at = excluded.updated_at`,
  ).run(...values);
  return record;
}

export async function findDishAiAnnotation(db, { tenantId = 'default', dishId, batchId, inputHash }) {
  return db.prepare(
    `SELECT * FROM dish_ai_annotations
     WHERE tenant_id = ? AND dish_id = ? AND batch_id = ? AND input_hash = ?
     LIMIT 1`,
  ).get(tenantId, dishId, batchId, inputHash);
}

export async function listDishAiAnnotations(db, { tenantId = 'default', batchId, statuses = ['schema_validated', 'approved'] } = {}) {
  const rows = await db.prepare(
    `SELECT * FROM dish_ai_annotations WHERE tenant_id = ? AND batch_id = ? ORDER BY dish_id`,
  ).all(tenantId, batchId);
  const allowed = new Set(statuses);
  return rows.filter((row) => allowed.has(row.status)).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    dishId: row.dish_id,
    batchId: row.batch_id,
    model: row.model,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    annotation: JSON.parse(row.annotation_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function applyDishAiAnnotationForIndex(dish, annotationRecordValue) {
  if (!annotationRecordValue?.annotation) return dish;
  return { ...dish, aiAnnotation: annotationRecordValue.annotation };
}
