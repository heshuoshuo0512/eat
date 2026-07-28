function lastPathItem(path) {
  return Array.isArray(path) && path.length ? path[path.length - 1] : null;
}

function normalizeCandidate(value = {}) {
  const canteen = lastPathItem(value.canteenPath);
  const stall = lastPathItem(value.stallPath);
  return {
    ...value,
    id: value.dishId || value.id,
    dishId: value.dishId || value.id,
    canteen,
    stall,
    matchScore: Number(value.score ?? value.matchScore ?? 0),
    matchReasons: value.reasons || value.matchReasons || [],
  };
}

export function normalizeMealVisionResult(value = {}) {
  const candidates = (value.match?.candidates || value.matches || []).map(normalizeCandidate);
  const observation = value.observation || {
    genericNames: [value.suggestion?.name].filter(Boolean),
    visibleIngredients: value.suggestion?.ingredients || [],
    cookingMethods: value.suggestion?.tags || [],
    multipleItems: false,
    quality: { usable: true, issueCodes: [] },
    confidence: Number(value.suggestion?.confidence || 0),
    notes: value.suggestion?.notes || '',
    estimatedNutrition: null,
  };
  return {
    ...value,
    observation,
    match: { status: value.match?.status || (candidates.length ? 'needs_confirmation' : 'unresolved'), candidates },
    selectedDish: value.selectedDish || null,
    nutrition: value.nutrition || { status: 'unknown', ranges: null, sourceIds: [] },
    warnings: value.warnings || [],
    detectedName: observation.genericNames?.[0] || '',
    confidenceLabel: observation.confidence ? `${Math.round(observation.confidence * 100)}%` : '待确认',
  };
}

export function nutritionRangeText(range, fallback = '未知') {
  if (!range || range.min == null || range.max == null) return fallback;
  const value = Number(range.min) === Number(range.max) ? `${range.min}` : `${range.min}-${range.max}`;
  return `${value}${range.unit || ''}`;
}
