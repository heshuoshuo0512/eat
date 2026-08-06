#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { classifyCatalogItem } from '../server/catalogClassification.js';

const MIGRATION_RESOLUTIONS = new Map(Object.entries({
  'dish-ba91190defb150': { action: 'canonicalize_name', canonicalName: '红烧大排面' },
  'dish-b43ac7746192af': { action: 'merge_duplicate', parentDishId: 'dish-ba91190defb150' },
  'dish-5ecbe4de67fb30': { action: 'merge_price_variants', canonicalName: '烤里鱼' },
  'dish-4638b8e96ea9ee': { action: 'merge_price_variant', parentDishId: 'dish-5ecbe4de67fb30' },
  'dish-046c8ea6442415': { action: 'merge_price_variant', parentDishId: 'dish-5ecbe4de67fb30' },
  'dish-01afb12a5e7142': { action: 'merge_price_variants', canonicalName: '烤草鱼' },
  'dish-ffb63a7f6fe979': { action: 'merge_price_variant', parentDishId: 'dish-01afb12a5e7142' },
  'dish-39289497c6ad66': { action: 'merge_price_variant', parentDishId: 'dish-01afb12a5e7142' },
  'dish-876fb4fad966c5': { action: 'qualify_name', canonicalName: '溜肉段盖饭' },
  'dish-5183df9c183acc': { action: 'qualify_name', canonicalName: '土豆烧牛肉盖饭' },
  'dish-9a5d024dc6cb1f': { action: 'qualify_name', canonicalName: '尖椒护心肉盖饭' },
  'dish-7f2557b0691a71': { action: 'qualify_name', canonicalName: '蒜苔炒腊肉盖饭' },
  'dish-844df2f52c2e7e': { action: 'qualify_name', canonicalName: '孜然肉卷盖饭' },
  'dish-de6f056c55d012': { action: 'qualify_name', canonicalName: '菠萝咕咾肉盖饭' },
  'dish-b102fcbd65fe1e': { action: 'assign_source_section', category: '精品小炒' },
  'dish-818f41795f5b1f': { action: 'assign_source_section', category: '精品小炒' },
  'dish-44dfe8262552cc': { action: 'assign_source_section', category: '精品小炒' },
  'dish-5b2b23caa605a3': { action: 'assign_source_section', category: '精品小炒' },
  'dish-03c56260d1f721': { action: 'assign_source_section', category: '精品小炒' },
  'dish-4020b18b0682c3': { action: 'assign_source_section', category: '精品小炒' },
  'dish-227006a11272f3': { action: 'canonicalize_name', canonicalName: '香辣大排面' },
  'dish-19a612019d757f': { action: 'canonicalize_name', canonicalName: '番茄肉酱面' },
  'dish-51d49f3fc7888c': { action: 'restore_truncated_name', canonicalName: '米线 / 酸辣粉 / 担担面' },
  'dish-b103b6708ede89': { action: 'restore_truncated_name', canonicalName: '烤肉饭' },
  'dish-df2a6eb7ad52f8': { action: 'restore_truncated_name', canonicalName: '热卤双拼拌饭' },
  'dish-cf56cdaca411dd': { action: 'qualify_context_name', canonicalName: '标配肉灌饼' },
  'dish-6b54cb5badc7bb': { action: 'qualify_context_name', canonicalName: '腊肠肉灌饼' },
  'dish-3c5a994f172082': { action: 'qualify_context_name', canonicalName: '哈尔滨红肠肉灌饼' },
  'dish-de8cd6fbfa8ffc': { action: 'qualify_context_name', canonicalName: '煎蛋肉灌饼' },
  'dish-cb0fb66eefdfe7': { action: 'qualify_context_name', canonicalName: '烤鸡肉灌饼' },
  'dish-b139d1e15e960f': { action: 'qualify_context_name', canonicalName: '五花肉肉灌饼' },
  'dish-8edd937fae6983': { action: 'qualify_context_name', canonicalName: '大葱香菜肉水饺' },
  'dish-45118797df34e4': { action: 'qualify_context_name', canonicalName: '白菜莲藕肉水饺' },
  'dish-1f691cf74b0431': { action: 'qualify_context_name', canonicalName: '芹菜香菇肉水饺' },
  'dish-8869f6c0466006': { action: 'qualify_context_name', canonicalName: '酸菜油梭肉水饺' },
  'dish-4b4f88c9861fb9': { action: 'qualify_context_name', canonicalName: '茴香鸡蛋肉水饺' },
  'dish-f62e6f07111ef1': { action: 'qualify_context_name', canonicalName: '猪肉玉米水饺' },
}));

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^\s*\d+\s*[.、]\s*/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

function groupBy(rows, keyFor) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const group = result.get(key) || [];
    group.push(row);
    result.set(key, group);
  }
  return result;
}

function reviewSignals(record) {
  const signals = [];
  const name = String(record.name || '');
  const amount = Number(record.price);
  const fixedPrice = record.pricingMode === 'fixed' || !record.pricingMode;

  if (!name.trim()) signals.push('missing_name');
  if (!Number.isFinite(amount) || amount < 0) signals.push('invalid_price');
  if (record.reason === 'fallback') signals.push('fallback_classification');
  if (record.itemType === 'meal' && fixedPrice && amount <= 5) signals.push('verified_low_price_meal');
  if (record.itemType === 'meal' && /^(?:其他|其它|单价品类|\d+元(?:以上|以下)?区|以上套餐加|.*(?:类|系列))$/u.test(name)) {
    signals.push('possible_section_heading');
  }
  if (record.itemType === 'meal' && /^(?:加|另加|可加|加购|选加)/u.test(name)) signals.push('possible_addon');
  const completeCombo = ['complete_combo', 'complete_combo_context'].includes(record.reason);
  if (record.itemType === 'meal' && !completeCombo && /(?:豆浆|豆奶|杂粮汁|果汁|饮料|可乐|雪碧|奶茶|咖啡|酸奶|矿泉水|纯净水|苏打水|酸梅汤|冰红茶|乌龙茶|绿茶|红茶|果茶|茶粹|脉动|啤酒|汽水)$/u.test(name)) {
    signals.push('possible_beverage');
  }
  if (record.itemType === 'meal' && record.reason === 'fallback' && /^(?:丸子|丸子类|鱼丸|虾丸|牛肉丸|蟹棒|蟹排|鱼豆腐|豆泡|豆皮|干豆腐|午餐肉|培根|年糕|魔芋|海带|宽粉|粉丝|方便面|卤蛋|煎蛋|荷包蛋|鸡蛋|鹌鹑蛋|炸蛋|火腿肠|烤肠|香肠)$/u.test(name)) {
    signals.push('possible_component');
  }
  if (record.itemType === 'meal' && /^(?:\d+(?:\.\d+)?(?:元|角)?(?:一|两|三|四|五|六|七|八|九|十)?(?:个|只|串|根|枚|杯|瓶|份)|[一二三四五六七八九十]+(?:个|只|串|根|枚|杯|瓶|份))$/u.test(name)) {
    signals.push('possible_quantity_option');
  }
  if (record.itemType === 'meal' && record.reason === 'fallback' && name.length <= 2 && !/(粥|饭|面|粉|饼|包|汤|菜|肉|鱼|鸡|鸭|虾|蛋)$/u.test(name)) {
    signals.push('ambiguous_short_name');
  }
  const openingDelimiters = (name.match(/[（(]/gu) || []).length;
  const closingDelimiters = (name.match(/[）)]/gu) || []).length;
  if (['meal', 'beverage', 'snack'].includes(record.itemType) && openingDelimiters !== closingDelimiters) {
    signals.push('unbalanced_name_delimiter');
  }
  if (record.itemType === 'meal' && /低消$/u.test(name)) signals.push('minimum_spend_as_meal');
  if (record.itemType === 'meal' && /款$/u.test(name)) signals.push('contextless_product_name');
  if (record.itemType === 'meal' && /^T\d+[（(]/iu.test(name) && !completeCombo) signals.push('coded_combo_as_meal');
  if (['meal', 'beverage', 'snack'].includes(record.itemType) && record.sameStallDuplicateIds.length > 0) signals.push('same_stall_duplicate_name');
  return signals;
}

const source = resolve(option('source', 'data/imports/real/campus-2026-07-27/catalog.json'));
const output = option('output');
const catalog = JSON.parse(readFileSync(source, 'utf8'));
const stalls = new Map(catalog.stalls.map((stall) => [stall.id, stall]));
const canteens = new Map(catalog.canteens.map((canteen) => [canteen.id, canteen]));
const nameGroups = groupBy(catalog.dishes, (dish) => normalizedName(dish.name));
const stallNameGroups = groupBy(catalog.dishes, (dish) => `${dish.stallId}:${normalizedName(dish.name)}`);

const records = catalog.dishes.map((dish) => {
  const stall = stalls.get(dish.stallId) || {};
  const canteen = canteens.get(stall.canteenId) || {};
  const classification = classifyCatalogItem({ ...dish, stallName: stall.name });
  const normalized = normalizedName(dish.name);
  const sameNameRows = nameGroups.get(normalized) || [];
  const sameStallRows = stallNameGroups.get(`${dish.stallId}:${normalized}`) || [];
  const record = {
    id: dish.id,
    name: dish.name,
    normalizedName: normalized,
    price: dish.price,
    priceDisplay: dish.priceDisplay || `${dish.price}元`,
    pricingMode: dish.pricingMode || 'fixed',
    stallId: dish.stallId,
    stall: stall.name || '',
    canteenId: stall.canteenId || '',
    canteen: canteen.name || '',
    sourceRef: dish.sourceRef || null,
    ...classification,
    sameNameElsewhere: sameNameRows
      .filter((row) => row.id !== dish.id)
      .map((row) => ({ id: row.id, stallId: row.stallId })),
    sameStallDuplicateIds: sameStallRows.filter((row) => row.id !== dish.id).map((row) => row.id),
  };
  const signals = reviewSignals(record);
  const resolution = MIGRATION_RESOLUTIONS.get(record.id) || null;
  const unresolvedSignals = signals.filter((signal) => !['fallback_classification', 'verified_low_price_meal'].includes(signal));
  return {
    ...record,
    auditStatus: unresolvedSignals.length === 0 ? 'classified' : resolution ? 'resolved_by_migration' : 'needs_review',
    confidence: unresolvedSignals.length > 0 && !resolution
      ? 'low'
      : signals.includes('fallback_classification') ? 'medium' : 'high',
    resolution,
    reviewSignals: signals,
    evidence: [
      `classification_rule:${record.reason}`,
      `stall:${record.stall || 'unknown'}`,
      `canteen:${record.canteen || 'unknown'}`,
      `price:${record.priceDisplay}`,
      `pricing_mode:${record.pricingMode}`,
    ],
  };
});

const counts = {};
const categoryCounts = {};
const signalCounts = {};
for (const record of records) {
  counts[record.itemType] = (counts[record.itemType] || 0) + 1;
  categoryCounts[record.category] = (categoryCounts[record.category] || 0) + 1;
  for (const signal of record.reviewSignals) signalCounts[signal] = (signalCounts[signal] || 0) + 1;
}

const report = {
  schemaVersion: 'catalog-classification-audit-v4',
  generatedAt: new Date().toISOString(),
  source,
  total: records.length,
  audited: records.length,
  counts,
  categoryCounts,
  signalCounts,
  needsReviewCount: records.filter((record) => record.auditStatus === 'needs_review').length,
  resolvedByMigrationCount: records.filter((record) => record.auditStatus === 'resolved_by_migration').length,
  records,
};

if (output) {
  const target = resolve(output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const compact = {
  schemaVersion: report.schemaVersion,
  source: report.source,
  output: output ? resolve(output) : null,
  total: report.total,
  audited: report.audited,
  counts: report.counts,
  categoryCounts: report.categoryCounts,
  signalCounts: report.signalCounts,
  needsReviewCount: report.needsReviewCount,
  resolvedByMigrationCount: report.resolvedByMigrationCount,
  review: records.filter((record) => record.auditStatus === 'needs_review'),
};
console.log(JSON.stringify(compact, null, 2));
