export const SAFETY_STATUSES = Object.freeze([
  'confirmed_absent',
  'confirmed_present',
  'unknown',
  'cross_contact_possible',
]);

export const FACT_STATUSES = Object.freeze(['unknown', 'estimated', 'verified']);

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function termMatches(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

function normalizeFactStatus(value, fallback = 'unknown') {
  const status = String(value || '').trim();
  return FACT_STATUSES.includes(status) ? status : fallback;
}

function normalizeSafetyStatus(value, fallback = 'unknown') {
  const status = String(value || '').trim();
  return SAFETY_STATUSES.includes(status) ? status : fallback;
}

export function normalizeSafetyDeclarations(raw = {}) {
  const explicit = parseJson(raw.safetyDeclarations ?? raw.safety_declarations_json, []);
  const declarations = explicit.map((item) => ({
    allergenCode: String(item.allergenCode || item.allergen_code || item.code || '*').trim() || '*',
    status: normalizeSafetyStatus(item.status),
    source: String(item.source || raw.factSource || raw.fact_source || 'manual').trim() || 'manual',
    verifiedBy: String(item.verifiedBy || item.verified_by || '').trim() || null,
    verifiedAt: item.verifiedAt || item.verified_at || raw.factVerifiedAt || raw.fact_verified_at || null,
    expiresAt: item.expiresAt || item.expires_at || raw.factExpiresAt || raw.fact_expires_at || null,
    dataVersion: String(item.dataVersion || item.data_version || raw.dataVersion || raw.data_version || 'legacy').trim(),
  })).filter((item) => item.allergenCode);

  if (declarations.length) return declarations;
  const allergens = parseJson(raw.allergens ?? raw.allergens_json, []);
  if (allergens.length) {
    return allergens.map((allergenCode) => ({
      allergenCode: String(allergenCode),
      status: 'confirmed_present',
      source: 'legacy_allergens_json',
      verifiedBy: null,
      verifiedAt: null,
      expiresAt: null,
      dataVersion: 'legacy',
    }));
  }
  return [{
    allergenCode: '*',
    status: 'unknown',
    source: 'legacy_empty_allergens',
    verifiedBy: null,
    verifiedAt: null,
    expiresAt: null,
    dataVersion: 'legacy',
  }];
}

export function deriveSpiceLevel(raw = {}) {
  const explicit = Number(raw.spiceLevel ?? raw.spice_level);
  if (Number.isInteger(explicit) && explicit >= 0 && explicit <= 5) return explicit;
  const text = [raw.taste, ...(parseJson(raw.tags ?? raw.tags_json, [])), raw.description].join(' ');
  if (/变态辣|爆辣|特辣|重辣/.test(text)) return 5;
  if (/麻辣|香辣|中辣/.test(text)) return 3;
  if (/微辣|少辣|酸辣/.test(text)) return 1;
  if (/不辣|清淡|清爽|咸鲜|甜味|酸甜/.test(text)) return 0;
  return null;
}

export function buildDishFacts(raw = {}) {
  const declarations = normalizeSafetyDeclarations(raw);
  const explicitFactStatus = raw.factStatus || {};
  const factStatus = {
    nutrition: normalizeFactStatus(explicitFactStatus.nutrition ?? raw.nutritionFactStatus ?? raw.nutrition_fact_status),
    recipe: normalizeFactStatus(explicitFactStatus.recipe ?? raw.recipeFactStatus ?? raw.recipe_fact_status),
    halal: normalizeFactStatus(explicitFactStatus.halal ?? raw.halalFactStatus ?? raw.halal_fact_status),
    dietary: normalizeFactStatus(explicitFactStatus.dietary ?? raw.dietaryFactStatus ?? raw.dietary_fact_status),
    spice: normalizeFactStatus(explicitFactStatus.spice ?? raw.spiceFactStatus ?? raw.spice_fact_status),
  };
  const spiceLevel = deriveSpiceLevel(raw);
  return {
    seasonings: parseJson(raw.seasonings ?? raw.seasonings_json, []),
    additives: parseJson(raw.additives ?? raw.additives_json, []),
    declarations,
    factStatus,
    spiceLevel,
    source: String(raw.factSource ?? raw.fact_source ?? 'legacy').trim() || 'legacy',
    verifiedAt: raw.factVerifiedAt ?? raw.fact_verified_at ?? null,
    expiresAt: raw.factExpiresAt ?? raw.fact_expires_at ?? null,
    dataVersion: String(raw.dataVersion ?? raw.data_version ?? 'legacy').trim() || 'legacy',
    synthetic: Boolean(raw.synthetic),
  };
}

export function evaluateDishSafety(candidate, requestedAllergens = []) {
  const allergens = [...new Set(requestedAllergens.map(String).map((value) => value.trim()).filter(Boolean))];
  const facts = candidate.facts || buildDishFacts(candidate);
  if (!allergens.length) return { status: 'not_applicable', blocked: false, declarations: [], unknownAllergens: [], matchedAllergens: [] };

  const recipeText = [
    ...(candidate.ingredients || []),
    ...(facts.seasonings || []),
    ...(facts.additives || []),
    ...(candidate.allergens || []),
  ];
  const matched = [];
  const unknown = [];
  const selectedDeclarations = [];

  for (const allergen of allergens) {
    const declarations = facts.declarations.filter((item) => item.allergenCode === '*' || termMatches(item.allergenCode, allergen));
    selectedDeclarations.push(...declarations.map((item) => ({ ...item, requestedAllergen: allergen })));
    const recipeMatch = recipeText.some((item) => termMatches(item, allergen));
    const unsafe = recipeMatch || declarations.some((item) => ['confirmed_present', 'cross_contact_possible'].includes(item.status));
    const absent = declarations.some((item) => item.status === 'confirmed_absent');
    if (unsafe) matched.push(allergen);
    else if (!absent) unknown.push(allergen);
  }

  if (matched.length) {
    return { status: 'blocked', blocked: true, declarations: selectedDeclarations, unknownAllergens: unknown, matchedAllergens: matched };
  }
  if (unknown.length) {
    return { status: 'unknown', blocked: false, declarations: selectedDeclarations, unknownAllergens: unknown, matchedAllergens: [] };
  }
  return { status: 'confirmed_absent', blocked: false, declarations: selectedDeclarations, unknownAllergens: [], matchedAllergens: [] };
}

export function dishDataQuality(candidate, now = new Date()) {
  const facts = candidate.facts || buildDishFacts(candidate);
  const nutrition = candidate.nutrition || {};
  const checks = {
    recipe: Boolean((candidate.ingredients || []).length),
    nutrition: ['calories', 'protein', 'fat', 'carbs'].every((key) => Number(nutrition[key]) > 0),
    safety: facts.declarations.some((item) => item.status !== 'unknown'),
    dietary: facts.factStatus.dietary !== 'unknown' || Boolean((candidate.dietaryLabels || []).length),
    spice: facts.spiceLevel != null,
    location: Boolean(candidate.canteenId && candidate.stallId),
  };
  const completeness = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const verifiedAt = facts.verifiedAt ? Date.parse(facts.verifiedAt) : NaN;
  const expiresAt = facts.expiresAt ? Date.parse(facts.expiresAt) : NaN;
  const ageDays = Number.isFinite(verifiedAt) ? Math.max(0, (now.getTime() - verifiedAt) / 86_400_000) : null;
  const expired = Number.isFinite(expiresAt) && expiresAt < now.getTime();
  const freshness = expired ? 0 : ageDays == null ? 0.35 : Math.max(0.2, 1 - ageDays / 365);
  return {
    completeness: Number(completeness.toFixed(4)),
    freshness: Number(freshness.toFixed(4)),
    checks,
    source: facts.source,
    verifiedAt: facts.verifiedAt,
    expiresAt: facts.expiresAt,
    dataVersion: facts.dataVersion,
    synthetic: facts.synthetic,
  };
}

export function retrievalConfidence({ lexicalMatched = false, semanticScore = 0, rankMargin = 0, quality, sourceVerified = false } = {}) {
  const vector = Math.max(0, Math.min(1, Number(semanticScore) || 0));
  const margin = Math.max(0, Math.min(1, Number(rankMargin) || 0));
  const completeness = Math.max(0, Math.min(1, Number(quality?.completeness) || 0));
  const freshness = Math.max(0, Math.min(1, Number(quality?.freshness) || 0));
  const factors = {
    channelAgreement: lexicalMatched && vector > 0 ? 1 : lexicalMatched || vector > 0 ? 0.55 : 0,
    semanticSupport: vector,
    rankSeparation: margin,
    factCompleteness: completeness,
    sourceQuality: sourceVerified ? 1 : 0.55,
    freshness,
  };
  const score = factors.channelAgreement * 0.25
    + factors.semanticSupport * 0.20
    + factors.rankSeparation * 0.15
    + factors.factCompleteness * 0.20
    + factors.sourceQuality * 0.10
    + factors.freshness * 0.10;
  const normalized = Number(Math.max(0, Math.min(1, score)).toFixed(4));
  return {
    level: normalized >= 0.8 ? 'high' : normalized >= 0.6 ? 'medium' : 'low',
    score: normalized,
    factors: Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, Number(value.toFixed(4))])),
    calibrated: false,
    note: '该分数为检索与数据质量综合指标，不是医学安全概率。',
  };
}
