#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const auditPath = resolve(process.argv.find((value) => value.startsWith('--audit='))?.slice(8) || 'docs/连锁菜单清洗与分类审计-2026-08-08.json');
const outputPath = resolve(process.argv.find((value) => value.startsWith('--output='))?.slice(9) || 'data/chain-menu-release-2026-08-08.json');
const batchId = 'chain-menu-release-2026-08-08-v1';
const approvedAt = process.env.RELEASE_APPROVED_AT || new Date().toISOString();

const stallMappings = Object.freeze({
  '0090汉堡工厂（大榕树餐厅）': { stallId: 'stall-7c86229852f7b1', canteenId: 'west-darongshu' },
  '茶百道（广缘店）': { stallId: 'stall-chain-teabaidao-guangyuan', canteenId: 'east-guangyuan' },
  '茶瀑布（西区大食堂3楼东）': { stallId: 'stall-af3fa150431372', canteenId: 'west-floor3-east' },
  '橘包包现烤面包（燕大西区广缘店）': { stallId: 'stall-210fb3a4bcf0df', canteenId: 'east-guangyuan' },
  '肯德基（广缘店）': { stallId: 'stall-chain-kfc-guangyuan', canteenId: 'east-guangyuan' },
  '库迪咖啡（广缘店）': { stallId: 'stall-50edb4c376fb2c', canteenId: 'east-guangyuan' },
  '麦当劳（广缘店）': { stallId: 'stall-0444fa8ed61b6a', canteenId: 'east-guangyuan' },
  '蜜雪冰城（燕大食堂二楼东店）': { stallId: 'stall-87233257f56655', canteenId: 'west-floor2-east' },
  '蜜雪冰城（广缘店）': { stallId: 'stall-9a71650a1b3724', canteenId: 'east-guangyuan' },
  '瑞幸咖啡（广缘店）': { stallId: 'stall-292b1f3f1bf37a', canteenId: 'east-guangyuan' },
  '塔斯汀中国汉堡（大榕树餐厅）': { stallId: 'stall-chain-tastien-darongshu', canteenId: 'west-darongshu' },
  '甜啦啦鲜果茶（广缘店）': { stallId: 'stall-349d5920ce3635', canteenId: 'east-guangyuan' },
  '幸运咖（广缘店）': { stallId: 'stall-f5985ddd81c902', canteenId: 'east-guangyuan' },
  '益禾堂（广缘店）': { stallId: 'stall-chain-yihetang-guangyuan', canteenId: 'east-guangyuan' },
  '益禾堂（燕鸣湖餐厅）': { stallId: 'stall-d012d3000211ac', canteenId: 'east-yanminghu-1f' },
  '左手边（喜进甲餐厅）': { stallId: 'stall-4cb7cc5e190c55', canteenId: 'west-xijinjia' },
});

const newStalls = Object.freeze([
  { stallId: 'stall-chain-teabaidao-guangyuan', canteenId: 'east-guangyuan', name: '茶百道（广缘店）', floor: '广缘超市', category: '饮品' },
  { stallId: 'stall-chain-kfc-guangyuan', canteenId: 'east-guangyuan', name: '肯德基（广缘店）', floor: '广缘超市', category: '连锁餐饮' },
  { stallId: 'stall-chain-tastien-darongshu', canteenId: 'west-darongshu', name: '塔斯汀中国汉堡（大榕树餐厅）', floor: '三楼西', category: '汉堡套餐' },
  { stallId: 'stall-chain-yihetang-guangyuan', canteenId: 'east-guangyuan', name: '益禾堂（广缘店）', floor: '广缘超市', category: '饮品' },
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const auditBytes = readFileSync(auditPath);
const audit = JSON.parse(auditBytes.toString('utf8'));
if (audit.summary.sourceFileCount !== 14 || audit.summary.acceptedCount !== 824) {
  throw new Error(`Unexpected audit summary: ${JSON.stringify(audit.summary)}`);
}
if (audit.sources.some((source) => source.sourceName === '华莱士.md') || audit.accepted.some((row) => row.sourceName === '华莱士.md')) {
  throw new Error('华莱士来源必须完全从发布清单中排除');
}
if (audit.accepted.some((row) => row.publicationStatus !== 'review_required')) {
  throw new Error('Audit accepted rows must still be review_required before release approval');
}

const items = audit.accepted.map((row) => {
  const mapping = stallMappings[row.location];
  if (!mapping) throw new Error(`Missing explicit stall mapping for ${row.location}`);
  if (!['meal', 'snack', 'beverage'].includes(row.itemType)) throw new Error(`Unsupported item type for ${row.id}`);
  if (!Number.isFinite(Number(row.price)) || Number(row.price) < 0) throw new Error(`Invalid price for ${row.id}`);
  return {
    id: row.id,
    sourceName: row.sourceName,
    sourceHash: row.sourceHash,
    sourceLine: row.sourceLine,
    sourceRawText: row.sourceRawText,
    merchant: row.merchant,
    location: row.location,
    sourceScope: row.sourceScope,
    name: row.name,
    price: Number(row.price),
    priceDisplay: row.priceDisplay,
    priceMode: row.priceMode,
    itemType: row.itemType,
    category: row.category,
    classificationRule: row.classificationRule,
    aggregateDuplicateReference: Boolean(row.aggregateDuplicateReference),
    stallId: mapping.stallId,
    canteenId: mapping.canteenId,
  };
});

const ids = new Set();
for (const item of items) {
  if (ids.has(item.id)) throw new Error(`Duplicate stable release ID: ${item.id}`);
  ids.add(item.id);
}

const release = {
  batchId,
  tenantId: 'default',
  status: 'approved_for_production',
  approvedBy: 'user',
  approvedAt,
  sourceAudit: {
    path: auditPath,
    sha256: sha256(auditBytes),
    sourceFileCount: audit.summary.sourceFileCount,
    sourceFiles: audit.sources.map((source) => source.sourceName),
    excludedSourceFiles: ['华莱士.md'],
  },
  policy: {
    aggregateSource: '连锁店菜单合集.md',
    aggregateIsReferenceOnly: true,
    importOnlyAcceptedRows: true,
    noFabricatedFacts: true,
    sharedBrandRowsRemainMarked: true,
  },
  newStalls,
  items,
  summary: {
    acceptedCount: items.length,
    byItemType: Object.fromEntries(['meal', 'snack', 'beverage'].map((type) => [type, items.filter((item) => item.itemType === type).length])),
    sharedBrandRows: items.filter((item) => item.sourceScope === 'shared_brand_menu').length,
  },
};
release.releaseDigest = sha256(canonical({ batchId, items, newStalls }));
writeFileSync(outputPath, `${JSON.stringify(release, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, batchId, releaseDigest: release.releaseDigest, summary: release.summary, sourceAudit: release.sourceAudit }, null, 2));
