import { createHash } from 'node:crypto';

export const PUBLIC_CATALOG_ITEM_TYPES = Object.freeze(['meal', 'snack', 'beverage']);

const GROUPS = Object.freeze({
  meal: Object.freeze([
    { id: 'breakfast', label: '早餐面点', description: '粥、包子、饼类和其他早餐主食' },
    { id: 'noodles', label: '面食粉类', description: '面条、粉类、水饺和馄饨等主食' },
    { id: 'rice', label: '米饭套餐', description: '米饭套餐、盖饭、黄焖鸡和拌饭等主食' },
    { id: 'home-cooking', label: '家常热菜', description: '蒸菜、小炒、干锅、砂锅和其他家常热菜' },
    { id: 'hotpot', label: '火锅麻辣烫', description: '火锅、麻辣烫和冒菜类餐食' },
    { id: 'burger', label: '汉堡快餐', description: '汉堡套餐和西式快餐主食' },
    { id: 'soup', label: '汤羹', description: '汤羹及可独立购买的汤品' },
    { id: 'other', label: '其他餐食', description: '暂未归入稳定分组的餐食' },
  ]),
  snack: Object.freeze([
    { id: 'burger-snack', label: '汉堡小吃', description: '汉堡档口的单点小吃和炸物' },
    { id: 'grill', label: '烧烤卤味小吃', description: '烧烤、炸物、串品和卤味' },
    { id: 'snack', label: '小吃单品', description: '可单独购买的其他小吃' },
    { id: 'dessert', label: '甜品小吃', description: '甜品、冷饮和甜味小吃' },
  ]),
  beverage: Object.freeze([
    { id: 'beverage', label: '饮品', description: '茶饮、瓶装饮料、豆浆和其他饮品' },
  ]),
});

const GROUP_BY_ID = new Map(
  Object.entries(GROUPS).flatMap(([itemType, groups]) => groups.map((group) => [`${itemType}:${group.id}`, { ...group, itemType }]))
);

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function regionalGroupId(label) {
  return `regional-${createHash('sha1').update(label).digest('hex').slice(0, 12)}`;
}

function regionalGroup(label, itemType) {
  const normalized = normalize(label);
  if (!normalized || /待核验|未知|未确认/u.test(normalized)) return null;
  return {
    id: regionalGroupId(normalized),
    label: normalized,
    description: `数据库已填写的口味标签：${normalized}`,
    itemType,
    source: 'regional_taste',
    confidence: 'verified',
  };
}

function standardGroup(itemType, id) {
  const group = GROUP_BY_ID.get(`${itemType}:${id}`) || GROUP_BY_ID.get(`${itemType}:other`);
  return { ...group, source: 'derived', confidence: 'inferred' };
}

export function catalogTasteGroups(itemType) {
  return (GROUPS[itemType] || []).map((group) => ({ ...group, itemType, source: 'derived', confidence: 'inferred' }));
}

export function classifyCatalogTaste({ itemType = 'meal', catalogCategory = '', regionalTaste = '' } = {}) {
  const normalizedType = PUBLIC_CATALOG_ITEM_TYPES.includes(itemType) ? itemType : 'meal';
  const explicit = regionalGroup(regionalTaste, normalizedType);
  if (explicit) return explicit;
  const category = normalize(catalogCategory);

  if (normalizedType === 'beverage') return standardGroup(normalizedType, 'beverage');
  if (normalizedType === 'snack') {
    if (category === '汉堡小吃') return standardGroup(normalizedType, 'burger-snack');
    if (category === '烧烤卤味小吃') return standardGroup(normalizedType, 'grill');
    if (category === '甜品小吃') return standardGroup(normalizedType, 'dessert');
    return standardGroup(normalizedType, 'snack');
  }

  if (category === '早餐面点') return standardGroup(normalizedType, 'breakfast');
  if (category === '面食粉类') return standardGroup(normalizedType, 'noodles');
  if (category === '米饭套餐') return standardGroup(normalizedType, 'rice');
  if (category === '家常热菜') return standardGroup(normalizedType, 'home-cooking');
  if (category === '火锅麻辣烫') return standardGroup(normalizedType, 'hotpot');
  if (category === '汉堡套餐') return standardGroup(normalizedType, 'burger');
  if (category === '汤羹') return standardGroup(normalizedType, 'soup');
  return standardGroup(normalizedType, 'other');
}

export function catalogTasteGroup(itemType, regionId) {
  const normalizedType = PUBLIC_CATALOG_ITEM_TYPES.includes(itemType) ? itemType : 'meal';
  return GROUP_BY_ID.get(`${normalizedType}:${regionId}`) || null;
}
