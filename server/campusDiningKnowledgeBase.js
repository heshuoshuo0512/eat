import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const CAMPUS_KNOWLEDGE_ROOT = resolve(MODULE_DIR, '../data/campus-dining-knowledge');
export const GLOBAL_KNOWLEDGE_TENANT_ID = '__global__';
export const CAMPUS_KNOWLEDGE_SOURCE_TYPE = 'campus_dining_knowledge';

const nonEmptyList = z.array(z.string().trim().min(1));
const conceptSchema = z.object({
  id: z.string().trim().min(1),
  canonicalName: z.string().trim().min(1),
  category: z.enum(['dish_archetype', 'ingredient', 'flavor_method', 'nutrition_role', 'campus_scenario', 'dietary_safety', 'stall_format']),
  subgroup: z.string().trim().min(1),
  description: z.string().trim().min(20),
  aliases: nonEmptyList.min(2),
  softTags: nonEmptyList,
  hardConstraintHints: z.record(z.string(), z.unknown()),
  relatedConceptIds: nonEmptyList.min(1),
  sourceIds: nonEmptyList,
  sourceStatus: z.enum(['internal_curated', 'verified_and_internal']),
  version: z.string().trim().min(1),
  status: z.enum(['draft', 'validated', 'approved', 'retired']),
  usage: z.array(z.enum(['query_expansion', 'ranking', 'filter', 'explanation'])).min(1),
  boundary: z.string().trim().min(1),
});

const querySchema = z.object({
  id: z.string().trim().min(1),
  stratum: z.string().trim().min(1),
  query: z.string().trim().min(2),
  expectedIntent: z.string().trim().min(1),
  expectedConceptIds: z.array(z.string().trim().min(1)),
  expectedHardFilters: z.record(z.string(), z.unknown()),
  expectedSoftSignals: z.array(z.string().trim().min(1)),
  requiredTools: nonEmptyList,
  forbiddenTools: nonEmptyList,
  expectedSourceTypes: nonEmptyList,
  forbiddenOutcomes: nonEmptyList,
  allowEmptyResult: z.boolean(),
  expectedExplanation: z.string().trim().min(1),
  safetyPrompt: z.string().trim().min(1),
  version: z.string().trim().min(1),
});

const challengeQuerySchema = querySchema.extend({
  baseQueryId: z.string().trim().min(1),
  challengeType: z.enum(['typo', 'colloquial', 'long_condition', 'negation', 'adversarial_conflict']),
});

const manifestSchema = z.object({
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  scope: z.literal(GLOBAL_KNOWLEDGE_TENANT_ID),
  sourceType: z.literal(CAMPUS_KNOWLEDGE_SOURCE_TYPE),
  counts: z.object({
    concepts: z.number().int().min(500),
    evaluationQueries: z.number().int().min(300),
    challengeQueries: z.number().int().positive().optional(),
  }),
  categoryQuotas: z.record(z.string(), z.number().int().positive()),
  queryQuotas: z.record(z.string(), z.number().int().positive()),
  indexedStatuses: z.array(z.literal('approved')).min(1),
}).passthrough();

let defaultCorpus = null;
let defaultChallenges = null;

function readJson(path) {
  if (!existsSync(path)) throw new Error(`校园饮食知识文件不存在：${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function countBy(items, field) {
  return items.reduce((counts, item) => ({ ...counts, [item[field]]: (counts[item[field]] || 0) + 1 }), {});
}

function assertQuota(actual, expected, label) {
  for (const [key, count] of Object.entries(expected)) {
    if (Number(actual[key] || 0) !== Number(count)) throw new Error(`${label} ${key} 数量应为 ${count}，实际为 ${actual[key] || 0}`);
  }
}

export function normalizeCampusText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function validateCampusDiningCorpus(raw) {
  const manifest = manifestSchema.parse(raw.manifest);
  const concepts = z.array(conceptSchema).parse(raw.concepts);
  const queries = z.array(querySchema).parse(raw.queries);
  if (concepts.length !== manifest.counts.concepts) throw new Error(`概念数量声明为 ${manifest.counts.concepts}，实际为 ${concepts.length}`);
  if (queries.length !== manifest.counts.evaluationQueries) throw new Error(`查询数量声明为 ${manifest.counts.evaluationQueries}，实际为 ${queries.length}`);
  if (concepts.length < 500 || queries.length < 300) throw new Error('校园饮食底座不得少于 500 个概念和 300 条查询');

  const duplicateIds = duplicateValues(concepts.map((item) => item.id));
  const duplicateNames = duplicateValues(concepts.map((item) => normalizeCampusText(item.canonicalName)));
  const duplicateQueryIds = duplicateValues(queries.map((item) => item.id));
  const duplicateQueryTexts = duplicateValues(queries.map((item) => normalizeCampusText(item.query)));
  if (duplicateIds.length) throw new Error(`概念 ID 重复：${duplicateIds.join('、')}`);
  if (duplicateNames.length) throw new Error(`规范名称重复：${duplicateNames.join('、')}`);
  if (duplicateQueryIds.length) throw new Error(`查询 ID 重复：${duplicateQueryIds.join('、')}`);
  if (duplicateQueryTexts.length) throw new Error(`查询文本重复：${duplicateQueryTexts.join('、')}`);

  const conceptIds = new Set(concepts.map((item) => item.id));
  for (const concept of concepts) {
    for (const relatedId of concept.relatedConceptIds) {
      if (!conceptIds.has(relatedId)) throw new Error(`${concept.id} 引用了不存在的关联概念 ${relatedId}`);
    }
  }
  for (const query of queries) {
    for (const conceptId of query.expectedConceptIds) {
      if (!conceptIds.has(conceptId)) throw new Error(`${query.id} 引用了不存在的概念 ${conceptId}`);
    }
  }

  const aliasOwners = new Map();
  for (const concept of concepts) {
    for (const alias of concept.aliases) {
      const normalized = normalizeCampusText(alias);
      aliasOwners.set(normalized, [...(aliasOwners.get(normalized) || []), concept.id]);
    }
  }
  const ambiguousAliases = [...aliasOwners.entries()].filter(([, owners]) => new Set(owners).size > 1);
  if (ambiguousAliases.length) {
    throw new Error(`存在未声明的别名歧义：${ambiguousAliases.slice(0, 5).map(([alias, owners]) => `${alias}=>${owners.join(',')}`).join('；')}`);
  }

  assertQuota(countBy(concepts, 'category'), manifest.categoryQuotas, '概念分类');
  assertQuota(countBy(queries, 'stratum'), manifest.queryQuotas, '查询分层');
  return {
    manifest,
    concepts,
    queries,
    report: {
      conceptCount: concepts.length,
      queryCount: queries.length,
      approvedConceptCount: concepts.filter((item) => item.status === 'approved').length,
      categoryCounts: countBy(concepts, 'category'),
      queryCounts: countBy(queries, 'stratum'),
      aliasCount: concepts.reduce((sum, item) => sum + item.aliases.length, 0),
      ambiguousAliasCount: 0,
    },
  };
}

export function loadCampusDiningCorpus({ root = process.env.CAMPUS_DINING_KB_DIR || CAMPUS_KNOWLEDGE_ROOT, refresh = false } = {}) {
  const resolvedRoot = resolve(root);
  if (!refresh && resolvedRoot === CAMPUS_KNOWLEDGE_ROOT && defaultCorpus) return defaultCorpus;
  const corpus = validateCampusDiningCorpus({
    manifest: readJson(resolve(resolvedRoot, '00_manifest.json')),
    concepts: readJson(resolve(resolvedRoot, 'concepts.json')),
    queries: readJson(resolve(resolvedRoot, 'evaluation-queries.json')),
  });
  if (resolvedRoot === CAMPUS_KNOWLEDGE_ROOT) defaultCorpus = corpus;
  return corpus;
}

export function loadCampusDiningChallengeQueries({ root = process.env.CAMPUS_DINING_KB_DIR || CAMPUS_KNOWLEDGE_ROOT, refresh = false } = {}) {
  const resolvedRoot = resolve(root);
  if (!refresh && resolvedRoot === CAMPUS_KNOWLEDGE_ROOT && defaultChallenges) return defaultChallenges;
  const corpus = loadCampusDiningCorpus({ root: resolvedRoot, refresh });
  const challenges = z.array(challengeQuerySchema).parse(readJson(resolve(resolvedRoot, 'challenge-queries.json')));
  if (corpus.manifest.counts.challengeQueries && challenges.length !== corpus.manifest.counts.challengeQueries) {
    throw new Error(`挑战查询数量声明为 ${corpus.manifest.counts.challengeQueries}，实际为 ${challenges.length}`);
  }
  const conceptIds = new Set(corpus.concepts.map((item) => item.id));
  const queryIds = new Set(corpus.queries.map((item) => item.id));
  const duplicateIds = duplicateValues(challenges.map((item) => item.id));
  if (duplicateIds.length) throw new Error(`挑战查询 ID 重复：${duplicateIds.join('、')}`);
  for (const challenge of challenges) {
    if (!queryIds.has(challenge.baseQueryId)) throw new Error(`${challenge.id} 引用了不存在的基础查询 ${challenge.baseQueryId}`);
    for (const conceptId of challenge.expectedConceptIds) {
      if (!conceptIds.has(conceptId)) throw new Error(`${challenge.id} 引用了不存在的概念 ${conceptId}`);
    }
  }
  if (resolvedRoot === CAMPUS_KNOWLEDGE_ROOT) defaultChallenges = challenges;
  return challenges;
}

export function buildCampusDiningIndexDocuments({ root, tenantId = GLOBAL_KNOWLEDGE_TENANT_ID } = {}) {
  const corpus = loadCampusDiningCorpus({ ...(root ? { root } : {}) });
  return corpus.concepts.filter((concept) => concept.status === 'approved').map((concept) => ({
    tenantId,
    sourceType: CAMPUS_KNOWLEDGE_SOURCE_TYPE,
    sourceId: concept.id,
    chunkIndex: 0,
    title: concept.canonicalName,
    content: [
      concept.description,
      `常见表达：${concept.aliases.join('、')}`,
      `语义标签：${concept.softTags.join('、')}`,
      `使用边界：${concept.boundary}`,
    ].join('\n'),
    searchText: [concept.canonicalName, ...concept.aliases, ...concept.softTags, concept.subgroup].join(' '),
    metadata: {
      tenantId,
      globalScope: true,
      conceptId: concept.id,
      category: concept.category,
      subgroup: concept.subgroup,
      aliases: concept.aliases,
      softTags: concept.softTags,
      hardConstraintHints: concept.hardConstraintHints,
      relatedConceptIds: concept.relatedConceptIds,
      sourceIds: concept.sourceIds,
      sourceStatus: concept.sourceStatus,
      status: concept.status,
      usage: concept.usage,
      boundary: concept.boundary,
      version: concept.version,
      citation: `campus-dining-knowledge:${concept.id}@${concept.version}`,
      evidenceType: 'global_semantic_knowledge',
    },
  }));
}

function mergeHardHints(target, hints) {
  const merged = { ...target, ...hints };
  for (const key of ['avoidIngredients', 'allergens', 'includeIngredients', 'tags']) {
    if (target[key] || hints[key]) merged[key] = [...new Set([...(target[key] || []), ...(hints[key] || [])])];
  }
  return merged;
}

export function interpretCampusDiningQuery(query, options = {}) {
  const normalizedQuery = normalizeCampusText(query);
  if (!normalizedQuery) return { concepts: [], conceptIds: [], softSignals: [], hardFilters: {}, expandedTerms: [], ruleVersion: null };
  const corpus = loadCampusDiningCorpus(options);
  const matches = [];
  for (const concept of corpus.concepts) {
    if (concept.status !== 'approved') continue;
    const terms = [concept.canonicalName, ...concept.aliases]
      .map((value) => ({ value, normalized: normalizeCampusText(value) }))
      .filter((item) => item.normalized && normalizedQuery.includes(item.normalized));
    if (!terms.length) continue;
    const best = terms.sort((left, right) => right.normalized.length - left.normalized.length)[0];
    matches.push({ concept, matchedTerm: best.value, matchLength: best.normalized.length });
  }
  matches.sort((left, right) => right.matchLength - left.matchLength || left.concept.id.localeCompare(right.concept.id));
  const concepts = matches.slice(0, 16).map(({ concept, matchedTerm }) => ({
    id: concept.id,
    name: concept.canonicalName,
    category: concept.category,
    matchedTerm,
    sourceStatus: concept.sourceStatus,
    boundary: concept.boundary,
  }));
  let hardFilters = {};
  for (const { concept } of matches) {
    if (Object.keys(concept.hardConstraintHints).length) hardFilters = mergeHardHints(hardFilters, concept.hardConstraintHints);
  }
  return {
    concepts,
    conceptIds: concepts.map((item) => item.id),
    softSignals: [...new Set(matches.flatMap(({ concept }) => concept.softTags))].slice(0, 24),
    hardFilters,
    expandedTerms: [...new Set(matches.flatMap(({ concept }) => [concept.canonicalName, ...concept.softTags]))].slice(0, 24),
    ruleVersion: corpus.manifest.version,
  };
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function deriveDishSemanticLabels(dish = {}, options = {}) {
  const nutrition = dish.nutrition || {};
  const ingredients = parseJson(dish.ingredients ?? dish.ingredients_json, []);
  const tags = parseJson(dish.tags ?? dish.tags_json, []);
  const dietaryLabels = parseJson(dish.dietaryLabels ?? dish.dietary_labels_json, []);
  const labels = new Set([dish.cuisine, dish.taste, dish.regionalTaste ?? dish.regional_taste, ...tags, ...dietaryLabels].filter(Boolean));
  const values = {
    protein: Number(nutrition.protein ?? dish.protein ?? 0),
    fat: Number(nutrition.fat ?? dish.fat ?? 0),
    carbs: Number(nutrition.carbs ?? dish.carbs ?? 0),
    calories: Number(nutrition.calories ?? dish.calories ?? 0),
    fiber: Number(dish.fiber ?? 0),
    sodium: Number(dish.sodium ?? 0),
    sugar: Number(dish.sugar ?? 0),
  };
  if (values.protein >= 25) labels.add('高蛋白');
  if (values.fat > 0 && values.fat <= 15) labels.add('低脂');
  if (values.carbs > 0 && values.carbs <= 50) labels.add('低碳水');
  if (values.calories > 0 && values.calories <= 500) labels.add('低热量');
  if (values.fiber >= 3) labels.add('高纤维');
  if (values.sodium > 0 && values.sodium <= 500) labels.add('低钠');
  if (values.sugar > 0 && values.sugar <= 5) labels.add('低糖');

  const corpus = loadCampusDiningCorpus(options);
  const ingredientConcepts = corpus.concepts.filter((concept) => concept.category === 'ingredient' && concept.status === 'approved');
  const ingredientText = normalizeCampusText(ingredients.join(' '));
  for (const concept of ingredientConcepts) {
    if (!ingredientText.includes(normalizeCampusText(concept.canonicalName))) continue;
    if (concept.subgroup === 'staple') labels.add('主食来源');
    if (concept.subgroup === 'protein') labels.add('蛋白质来源');
    if (concept.subgroup === 'vegetable') labels.add('蔬菜来源');
  }
  return [...labels];
}

export function clearCampusDiningKnowledgeCache() {
  defaultCorpus = null;
}
