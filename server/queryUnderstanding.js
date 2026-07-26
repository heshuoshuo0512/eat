const ALLERGEN_PREFIX = /^(?:我|本人|自己|有点|严重|可能|对)+/;
const MEAT_TERMS = ['牛肉', '猪肉', '鸡肉', '鸭肉', '羊肉', '鱼', '虾', '蟹', '海鲜', '鸡蛋', '牛奶'];
const COMMON_ALLERGEN_TERMS = new Set([
  '花生', '牛奶', '乳制品', '鸡蛋', '蛋', '大豆', '豆类', '小麦', '麸质',
  '虾', '蟹', '甲壳类', '鱼', '贝类', '芝麻', '坚果',
]);

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function cleanSafetyTerm(value) {
  return String(value || '')
    .replace(/^(?:补充一下|另外|还有|顺便)(?:说)?[，,\s]*/, '')
    .replace(/^.*(?:不能忽略|忽略|取消|撤销|不用管|不算)/, '')
    .replace(ALLERGEN_PREFIX, '')
    .replace(/^(?:对|有)/, '')
    .replace(/(?:这种东西|这类东西|食物|食品|食材|菜品|的菜)$/g, '')
    .trim();
}

function splitTerms(value) {
  return unique(String(value || '').split(/[、，,和与及或/\s]+/).map(cleanSafetyTerm))
    .filter((term) => term.length >= 1 && term.length <= 20)
    .filter((term) => !/^(?:很|太|不太|比较)?(?:辣|油|油腻|甜|咸|清淡)(?:一点|点|的菜)?$/.test(term));
}

function constraint(field, value, options = {}) {
  return {
    field,
    value,
    polarity: options.polarity || 'include',
    strength: options.strength || 'hard',
    scope: options.scope || 'dish',
    source: options.source || 'query',
    matchedText: options.matchedText || '',
  };
}

function collectMatches(text, pattern, group = 1) {
  const values = [];
  for (const match of text.matchAll(pattern)) values.push(...splitTerms(match[group]));
  return unique(values);
}

/**
 * Deterministic Chinese query structure used before semantic retrieval.
 * It intentionally extracts only bounded facts; an LLM may add soft signals later.
 */
export function parseStructuredDiningQuery(query = '') {
  const text = String(query || '').trim();
  const filters = {};
  const constraints = [];
  const conflicts = [];
  const pendingConfirmations = [];
  const detected = [];

  const avoidedSafetyTerms = collectMatches(text, /避开\s*([^，,。；;、]{1,24})/g)
    .filter((term) => COMMON_ALLERGEN_TERMS.has(term));
  const allergenMatches = unique([
    ...collectMatches(text, /(?:我|本人|自己)?\s*对\s*([^，,。；;！？!?]{1,24}?)\s*(?:严重)?(?:过敏(?!原|信息|状态)|会过敏)/g),
    ...collectMatches(text, /(?:^|[，,。；;！？!?])\s*(?:我|本人|自己)?\s*([^，,。；;！？!?]{1,16}?)\s*(?:严重)?(?:过敏(?!原|信息|状态)|会过敏)/g),
    ...collectMatches(text, /(?:我|本人|自己)?\s*(?:不能吃|吃不了)\s*([^，,。；;！？!?]{1,20})/g),
    ...collectMatches(text, /(?:^|[，,。；;！？!?])\s*([^，,。；;！？!?]{1,16}?)\s*吃了不舒服/g),
    ...avoidedSafetyTerms,
  ]);
  if (allergenMatches.length) {
    filters.allergens = allergenMatches;
    detected.push('allergens');
    constraints.push(...allergenMatches.map((value) => constraint('allergens', value, {
      polarity: 'exclude', matchedText: `${value}过敏`,
    })));
  }

  const avoidMatches = unique([
    ...collectMatches(text, /(?:不吃|不要|别放|去掉|忌口|避开)\s*([^。！？!?；;，,]{1,40})/g),
    ...collectMatches(text, /除了\s*([^。！？!?；;，,]{1,24})\s*(?:都行|都可以|其他都行)/g),
  ])
    .filter((value) => !allergenMatches.includes(value))
    .filter((value) => !/^(?:售罄的?|售完的?|没货的?|下架的?|把未知当安全|自动放宽|(?:编|虚构)(?:库存|价格|菜品|营养))$/.test(value));
  if (avoidMatches.length) {
    filters.avoidIngredients = avoidMatches;
    detected.push('avoidIngredients');
    constraints.push(...avoidMatches.map((value) => constraint('avoidIngredients', value, {
      polarity: 'exclude', matchedText: value,
    })));
  }

  if (/(?:不太辣|别太辣|少辣|微辣即可|微微辣|不要很辣)/.test(text)) {
    filters.maxSpiceLevel = 2;
    detected.push('spiceLevel');
    constraints.push(constraint('maxSpiceLevel', 2, { matchedText: '不太辣' }));
  } else if (/(?:完全不辣|一点辣都不要|不要辣|不吃辣)/.test(text)) {
    filters.maxSpiceLevel = 0;
    detected.push('spiceLevel');
    constraints.push(constraint('maxSpiceLevel', 0, { matchedText: '不辣' }));
  } else if (/(?:重辣|特辣|越辣越好)/.test(text)) {
    filters.minSpiceLevel = 4;
    detected.push('spiceLevel');
    constraints.push(constraint('minSpiceLevel', 4, { strength: 'soft', matchedText: '重辣' }));
  } else if (/(?:可以|能接受|来点|稍微|有点)辣/.test(text)) {
    filters.minSpiceLevel = 1;
    detected.push('spiceLevel');
    constraints.push(constraint('minSpiceLevel', 1, { strength: 'soft', matchedText: '可以辣一点' }));
  }

  if (/(?:别太油|不要太油|少油|清爽点)/.test(text)) {
    filters.maxFat = 15;
    detected.push('maxFat');
    constraints.push(constraint('maxFat', 15, { matchedText: '少油' }));
  }
  if (/(?:不要很甜|别太甜|不太甜|少糖|低糖)/.test(text)) {
    filters.maxSugar = 5;
    detected.push('maxSugar');
    constraints.push(constraint('maxSugar', 5, { matchedText: '少糖' }));
  }
  if (/(?:少放盐|别太咸|少盐|低钠)/.test(text)) {
    filters.maxSodium = 500;
    detected.push('maxSodium');
    constraints.push(constraint('maxSodium', 500, { matchedText: '少盐' }));
  }

  const proteinMatch = text.match(/蛋白质\s*(?:至少|不低于|不少于|要有|达到)?\s*(\d+(?:\.\d+)?)\s*(?:克|g)/i);
  if (proteinMatch) {
    const minProtein = Number(proteinMatch[1]);
    if (Number.isFinite(minProtein) && minProtein >= 0 && minProtein <= 1000) {
      filters.minProtein = minProtein;
      detected.push('minProtein');
      constraints.push(constraint('minProtein', minProtein, { matchedText: proteinMatch[0] }));
    }
  }

  const explicitPermission = collectMatches(text, /(?:可以|能|允许)吃\s*([^，,。；;但]{1,30})/g);
  constraints.push(...explicitPermission.map((value) => constraint('permittedIngredients', value, {
    strength: 'context', matchedText: value,
  })));

  const requestedAnimalIngredients = MEAT_TERMS.filter((term) => new RegExp(`(?:想吃|想要|要吃|来份|来一份|点份|整点)[^，,。；;！？!?]{0,12}${term}`).test(text));
  if (requestedAnimalIngredients.length) {
    filters.includeIngredients = requestedAnimalIngredients;
    detected.push('includeIngredients');
    constraints.push(...requestedAnimalIngredients.map((value) => constraint('includeIngredients', value, {
      polarity: 'include', matchedText: value,
    })));
  }
  const veganConflict = /(?:纯素|全素|vegan)/i.test(text) && requestedAnimalIngredients.length > 0;
  if (veganConflict) {
    conflicts.push({
      code: 'DIETARY_PATTERN_CONFLICT',
      fields: ['dietaryPattern', 'includeIngredients'],
      message: '纯素要求与指定的动物性食材冲突，请确认优先条件。',
    });
    pendingConfirmations.push({
      code: 'CONFIRM_DIETARY_PATTERN',
      message: '请确认是坚持纯素，还是本次允许动物性食材。',
    });
  }

  const overlap = allergenMatches.filter((item) => explicitPermission.includes(item));
  if (overlap.length) {
    conflicts.push({
      code: 'ALLERGEN_PERMISSION_CONFLICT',
      fields: ['allergens', 'permittedIngredients'],
      values: overlap,
      message: `已声明过敏的食材不能同时标记为允许：${overlap.join('、')}`,
    });
    pendingConfirmations.push({
      code: 'CONFIRM_ALLERGEN_CONFLICT',
      message: '过敏约束不会自动撤销，请先确认健康档案。',
    });
  }

  return {
    query: text,
    filters,
    constraints,
    conflicts,
    pendingConfirmations,
    detected: unique(detected),
    parserVersion: '2026.07.2',
  };
}
