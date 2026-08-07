import { createHash } from 'node:crypto';

export const PUBLIC_CATALOG_ITEM_TYPES = Object.freeze(['meal', 'snack', 'beverage']);
export const MIN_CATALOG_REGION_ITEMS = 3;

const UNKNOWN_VALUES = new Set([
  '',
  '\u5f85\u6838\u9a8c',
  '\u672a\u77e5',
  '\u4e0d\u8be6',
  '\u5176\u4ed6',
  '\u5176\u4ed6\u9910\u98df',
  '\u9910\u98df',
]);

const GROUPS = Object.freeze([
  {
    id: 'cantonese',
    label: '\u7ca4\u83dc',
    description: '\u4ece\u5e7f\u4e1c\u3001\u6f6e\u6c55\u548c\u5e7f\u5f0f\u83dc\u54c1\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u7ca4\u83dc', '\u7ca4\u5f0f', '\u5e7f\u5f0f', '\u5e7f\u4e1c', '\u6f6e\u6c55', '\u5ba2\u5bb6'],
    nameCues: ['\u80a0\u7c89', '\u4e91\u541e', '\u70e7\u814a', '\u53c9\u70e7', '\u70e7\u9e45', '\u767d\u5207\u9e21', '\u7172\u4ed4\u996d', '\u6f6e\u6c55'],
    excludedNameCues: ['\u80a5\u80a0\u7c89'],
  },
  {
    id: 'sichuan-hunan',
    label: '\u5ddd\u6e58\u83dc',
    description: '\u4ece\u5ddd\u5473\u3001\u6e58\u5473\u548c\u91cd\u53e3\u5473\u83dc\u540d\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u5ddd\u83dc', '\u5ddd\u5473', '\u5ddd\u6e58', '\u6e58\u83dc', '\u6e58\u5473', '\u56db\u5ddd', '\u91cd\u5e86', '\u6e56\u5357'],
    nameCues: ['\u9ebb\u5a46\u8c46\u8150', '\u5bab\u4fdd\u9e21\u4e01', '\u56de\u9505\u8089', '\u9c7c\u9999\u8089\u4e1d', '\u9c7c\u9999\u8304\u5b50', '\u8fa3\u5b50\u9e21', '\u53e3\u6c34\u9e21', '\u6bdb\u8840\u65fa', '\u5c16\u6912', '\u5c0f\u7092\u8089', '\u80a5\u80a0\u7c89', '\u62c5\u62c5\u9762', '\u91cd\u5e86\u5c0f\u9762'],
  },
  {
    id: 'northwest',
    label: '\u897f\u5317\u83dc',
    description: '\u4ece\u9655\u897f\u3001\u7518\u8083\u3001\u65b0\u7586\u548c\u6e05\u771f\u7b49\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u897f\u5317\u83dc', '\u897f\u5317\u98ce\u5473', '\u9655\u897f', '\u897f\u5b89', '\u7518\u8083', '\u5170\u5dde', '\u65b0\u7586', '\u6e05\u771f', '\u56de\u6c11'],
    nameCues: ['\u5170\u5dde\u62c9\u9762', '\u725b\u8089\u62c9\u9762', '\u8089\u5939\u998d', '\u7f8a\u8089\u6ce1\u998d', '\u51c9\u76ae', '\u6cb9\u6cfc\u9762', '\u81ca\u5b50\u9762', '\u5927\u76d8\u9e21', '\u7f8a\u8089\u4e32'],
  },
  {
    id: 'northeast',
    label: '\u4e1c\u5317\u83dc',
    description: '\u4ece\u4e1c\u5317\u5730\u57df\u548c\u5178\u578b\u4e1c\u5317\u83dc\u540d\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u4e1c\u5317\u83dc', '\u4e1c\u5317\u98ce\u5473', '\u4e1c\u5317', '\u9ed1\u9f99\u6c5f', '\u5409\u6797', '\u8fbd\u5b81'],
    nameCues: ['\u9505\u5305\u8089', '\u5730\u4e09\u9c9c', '\u6e9c\u8089\u6bb5', '\u9178\u83dc\u767d\u8089', '\u5927\u62c9\u76ae', '\u94c1\u9505\u7096', '\u6740\u732a\u83dc'],
  },
  {
    id: 'beijing-shandong',
    label: '\u4eac\u9c81\u98ce\u5473',
    description: '\u4ece\u5317\u65b9\u9762\u98df\u3001\u4eac\u5473\u548c\u9c81\u83dc\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u4eac\u9c81\u98ce\u5473', '\u4eac\u5473', '\u5317\u4eac\u83dc', '\u9c81\u83dc', '\u5c71\u4e1c', '\u5317\u65b9'],
    nameCues: ['\u8001\u5317\u4eac\u70b8\u9171\u9762', '\u70b8\u9171\u9762', '\u5317\u4eac\u70e4\u9e2d', '\u9a74\u8089\u706b\u70e7', '\u5c71\u4e1c\u714e\u997c'],
  },
  {
    id: 'jiangnan',
    label: '\u6c5f\u6d59\u83dc',
    description: '\u4ece\u6c5f\u6d59\u3001\u6c5f\u5357\u548c\u4e0a\u6d77\u98ce\u5473\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u6c5f\u6d59\u83dc', '\u6c5f\u5357\u83dc', '\u4e0a\u6d77\u83dc', '\u6caa\u83dc', '\u6c5f\u82cf', '\u6d59\u6c5f', '\u4e0a\u6d77'],
    nameCues: ['\u751f\u714e', '\u5c0f\u7b3c\u5305', '\u87f9\u7c89', '\u8471\u6cb9\u62cc\u9762', '\u6885\u5e72\u83dc'],
  },
  {
    id: 'yunnan-guizhou',
    label: '\u4e91\u8d35\u83dc',
    description: '\u4ece\u4e91\u5357\u3001\u8d35\u5dde\u548c\u9178\u6c64\u98ce\u5473\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u4e91\u8d35\u83dc', '\u4e91\u5357\u83dc', '\u8d35\u5dde\u83dc', '\u4e91\u5357', '\u8d35\u5dde'],
    nameCues: ['\u8fc7\u6865\u7c73\u7ebf', '\u82b1\u6eaa\u725b\u8089\u7c89', '\u8d35\u5dde\u9178\u6c64', '\u9178\u6c64\u9c7c'],
  },
  {
    id: 'fujian-taiwan',
    label: '\u95fd\u53f0\u98ce\u5473',
    description: '\u4ece\u798f\u5efa\u3001\u53f0\u6e7e\u548c\u95fd\u5357\u98ce\u5473\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u95fd\u53f0\u98ce\u5473', '\u95fd\u83dc', '\u798f\u5efa\u83dc', '\u53f0\u6e7e\u83dc', '\u798f\u5efa', '\u53f0\u6e7e'],
    nameCues: ['\u6c99\u53bf', '\u5364\u8089\u996d', '\u868c\u4ed4', '\u4e09\u676f'],
  },
  {
    id: 'japanese',
    label: '\u65e5\u5f0f\u6599\u7406',
    description: '\u4ece\u65e5\u5f0f\u3001\u5bff\u53f8\u3001\u996d\u56e2\u548c\u4e3c\u996d\u7b49\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u65e5\u5f0f', '\u65e5\u672c\u6599\u7406', '\u65e5\u6599', '\u65e5\u672c'],
    nameCues: ['\u5bff\u53f8', '\u996d\u56e2', '\u4e4c\u51ac', '\u9cd7\u9c7c', '\u5929\u5987\u7f57', '\u7167\u70e7', '\u4eb2\u5b50\u4e3c'],
  },
  {
    id: 'korean',
    label: '\u97e9\u5f0f\u6599\u7406',
    description: '\u4ece\u97e9\u5f0f\u3001\u6ce1\u83dc\u3001\u77f3\u9505\u548c\u97e9\u5f0f\u51b7\u9762\u7b49\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u97e9\u5f0f', '\u97e9\u56fd\u6599\u7406', '\u97e9\u9910', '\u97e9\u56fd'],
    nameCues: ['\u90e8\u961f\u9505', '\u97e9\u5f0f\u51b7\u9762', '\u97e9\u5f0f\u62cc\u996d'],
  },
  {
    id: 'southeast-asian',
    label: '\u4e1c\u5357\u4e9a\u98ce\u5473',
    description: '\u4ece\u6cf0\u5f0f\u3001\u8d8a\u5357\u548c\u4e1c\u5357\u4e9a\u98ce\u5473\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'regional',
    aliases: ['\u4e1c\u5357\u4e9a', '\u6cf0\u5f0f', '\u6cf0\u56fd', '\u8d8a\u5357', '\u8d8a\u5357\u83dc'],
    nameCues: ['\u51ac\u9634\u529f', '\u8d8a\u5357\u7c73\u7ebf'],
  },
  {
    id: 'western-fast-food',
    label: '\u897f\u5f0f\u5feb\u9910',
    description: '\u4ece\u6c49\u5821\u3001\u62ab\u8428\u3001\u610f\u9762\u548c\u897f\u5f0f\u5feb\u9910\u8bc1\u636e\u4e2d\u5f52\u7c7b',
    kind: 'style',
    aliases: ['\u897f\u9910', '\u897f\u5f0f', '\u897f\u5f0f\u5feb\u9910'],
    nameCues: ['\u6c49\u5821', '\u62ab\u8428', '\u610f\u5927\u5229\u9762', '\u610f\u9762'],
  },
  {
    id: 'hotpot',
    label: '\u706b\u9505\u9ebb\u8fa3\u70eb\u98ce\u5473',
    description: '\u4ece\u706b\u9505\u3001\u9ebb\u8fa3\u70eb\u3001\u4e32\u4e32\u548c\u5192\u83dc\u7b49\u83dc\u540d\u4e2d\u5f52\u7c7b',
    kind: 'style',
    aliases: ['\u706b\u9505', '\u9ebb\u8fa3\u70eb', '\u9ebb\u8fa3\u9999\u9505'],
    nameCues: ['\u9ebb\u8fa3\u70eb', '\u9ebb\u8fa3\u9999\u9505', '\u706b\u9505', '\u4e32\u4e32', '\u5192\u83dc', '\u94b5\u94b5\u9999'],
  },
  {
    id: 'other',
    label: '\u5176\u4ed6\u5730\u57df\u98ce\u5473\uff08\u5f85\u6838\u9a8c\uff09',
    description: '\u5f53\u524d\u8bcd\u6761\u6ca1\u6709\u8db3\u591f\u7684\u5730\u57df\u83dc\u7cfb\u8bc1\u636e\uff0c\u9700\u4eba\u5de5\u6838\u9a8c',
    kind: 'unresolved',
    aliases: [],
    nameCues: [],
  },
]);

const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]));
const REGION_ALIASES = new Map(GROUPS.flatMap((group) => group.aliases.map((alias) => [alias, group])));
const FIELD_WEIGHTS = Object.freeze({
  regionalTaste: 130,
  name: 100,
  cuisine: 85,
  semanticLabels: 72,
  tags: 65,
  stallName: 58,
  canteenName: 45,
  ingredients: 35,
  sourceRef: 25,
});

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function flattenValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => flattenValues(item));
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => flattenValues(item));
  const normalized = normalize(value);
  return UNKNOWN_VALUES.has(normalized) || /\u5f85\u6838\u9a8c|\u672a\u77e5|\u672a\u786e\u8ba4|\u4e0d\u8be6/u.test(normalized) ? [] : [normalized];
}

function searchableSourceRef(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'object') return [];
  const sources = Array.isArray(sourceRef.sources) ? sourceRef.sources : [];
  return [sourceRef.name, sourceRef.raw, ...sources.map((source) => source?.rawText), ...sources.map((source) => source?.name)].filter(Boolean);
}

function matchCue(values, cues) {
  const normalizedValues = flattenValues(values);
  const orderedCues = [...cues].sort((left, right) => right.length - left.length);
  for (const value of normalizedValues) {
    const match = orderedCues.find((cue) => value.includes(normalize(cue)));
    if (match) return { value, cue: normalize(match) };
  }
  return null;
}

function regionForLabel(value) {
  const normalized = normalize(value);
  if (!normalized || UNKNOWN_VALUES.has(normalized)) return null;
  const exact = REGION_ALIASES.get(normalized);
  if (exact) return exact;
  const matches = GROUPS.filter((group) => group.id !== 'other' && group.aliases.some((alias) => normalized.includes(alias)));
  return matches.length === 1 ? matches[0] : null;
}

function confidenceFor(score, evidence) {
  if (evidence.some((item) => item.field === 'regionalTaste')) return 'verified';
  if (score >= 100 || evidence.length >= 2) return 'high';
  if (score >= 45) return 'medium';
  return 'unresolved';
}

function hasPrimaryEvidence(evidence) {
  return evidence.some((item) => ['name', 'cuisine', 'regionalTaste', 'semanticLabels', 'tags', 'stallName', 'canteenName'].includes(item.field));
}

function evidenceFor(group, item) {
  const evidence = [];
  const nameValues = [item.name, ...(item.aliases || [])];
  const nameIsExcluded = (group.excludedNameCues || []).some((cue) => matchCue(nameValues, [cue]));
  const regional = matchCue(item.regionalTaste, group.aliases);
  if (regional) evidence.push({ field: 'regionalTaste', value: regional.value, cue: regional.cue, rule: 'verified_regional_taste' });

  const name = nameIsExcluded ? null : matchCue(nameValues, [...group.aliases, ...group.nameCues]);
  if (name) evidence.push({ field: 'name', value: name.value, cue: name.cue, rule: 'dish_name_cue' });

  const cuisine = matchCue(item.cuisine, group.aliases);
  if (cuisine) evidence.push({ field: 'cuisine', value: cuisine.value, cue: cuisine.cue, rule: 'cuisine_field' });

  for (const field of ['semanticLabels', 'tags', 'stallName', 'canteenName', 'ingredients', 'sourceRef']) {
    if (field === 'sourceRef' && nameIsExcluded) continue;
    const values = field === 'sourceRef' ? searchableSourceRef(item.sourceRef) : item[field];
    const match = matchCue(values, [...group.aliases, ...group.nameCues]);
    if (match) evidence.push({ field, value: match.value, cue: match.cue, rule: field === 'stallName' || field === 'canteenName' ? 'venue_context_cue' : 'metadata_cue' });
  }
  return evidence;
}

function evidenceScore(evidence) {
  return evidence.reduce((score, item) => score + (FIELD_WEIGHTS[item.field] || 0), 0);
}

function displayEvidence(evidence) {
  return evidence.map((item) => ({
    ...item,
    value: String(item.value || '').slice(0, 120),
  }));
}

function regionalGroupId(label) {
  return `regional-${createHash('sha1').update(label).digest('hex').slice(0, 12)}`;
}

function unresolvedGroup(itemType) {
  const group = GROUP_BY_ID.get('other');
  return {
    ...group,
    itemType,
    source: 'unresolved',
    confidence: 'unresolved',
    evidence: [],
    score: 0,
    id: regionalGroupId(`${itemType}:${group.id}`),
  };
}

export function catalogTasteGroups(itemType) {
  const normalizedType = PUBLIC_CATALOG_ITEM_TYPES.includes(itemType) ? itemType : 'meal';
  return GROUPS.map((group) => ({ ...group, itemType: normalizedType, source: 'derived', confidence: group.id === 'other' ? 'unresolved' : 'inferred' }));
}

export function classifyCatalogTaste({
  itemType = 'meal',
  name = '',
  aliases = [],
  cuisine = '',
  taste = '',
  regionalTaste = '',
  tags = [],
  semanticLabels = [],
  ingredients = [],
  stallName = '',
  canteenName = '',
  sourceRef = {},
} = {}) {
  const normalizedType = PUBLIC_CATALOG_ITEM_TYPES.includes(itemType) ? itemType : 'meal';
  const item = { name, aliases, cuisine, taste, regionalTaste, tags, semanticLabels, ingredients, stallName, canteenName, sourceRef };
  const verifiedGroup = regionForLabel(regionalTaste);
  if (verifiedGroup) {
    const evidence = evidenceFor(verifiedGroup, item).filter((entry) => entry.field === 'regionalTaste');
    return { ...verifiedGroup, itemType: normalizedType, source: 'regional_taste', confidence: 'verified', evidence: displayEvidence(evidence), score: evidenceScore(evidence) };
  }

  const candidates = GROUPS.filter((group) => group.id !== 'other').map((group, order) => {
    const evidence = evidenceFor(group, item);
    return { group, evidence, score: evidenceScore(evidence), order };
  }).filter((candidate) => candidate.evidence.length > 0)
    .sort((left, right) => right.score - left.score || right.evidence.length - left.evidence.length || left.order - right.order);

  const selected = candidates[0];
  const runnerUp = candidates[1];
  if (!selected || selected.score < 45 || !hasPrimaryEvidence(selected.evidence)
    || (runnerUp && runnerUp.score === selected.score)) return unresolvedGroup(normalizedType);
  return {
    ...selected.group,
    itemType: normalizedType,
    source: 'derived',
    confidence: confidenceFor(selected.score, selected.evidence),
    evidence: displayEvidence(selected.evidence),
    score: selected.score,
  };
}

export function catalogTasteGroup(itemType, regionId) {
  const normalizedType = PUBLIC_CATALOG_ITEM_TYPES.includes(itemType) ? itemType : 'meal';
  const group = GROUP_BY_ID.get(regionId);
  return group ? { ...group, itemType: normalizedType } : null;
}
