#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const KB_ROOT = resolve(ROOT, 'data/health-knowledge-bases');
const TARGET_PATH = resolve(KB_ROOT, 'food-composition-targets.json');
const OUTPUT_PATH = resolve(KB_ROOT, 'food-composition-references.json');
const SOURCES_PATH = resolve(KB_ROOT, 'sources.json');
const FOODON_COMMIT = '922f4afd9bacd736d620ab8c994aa60b14aa2ee7';
const FOODON_SNAPSHOT_URL = `https://raw.githubusercontent.com/FoodOntology/foodon/${FOODON_COMMIT}/foodon.owl`;
const RETRIEVED_AT = process.env.FOOD_REFERENCE_RETRIEVED_AT || new Date().toISOString();
const FDC_DOWNLOAD_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip';
const FDC_CACHE_ROOT = resolve(tmpdir(), 'smart-canteen-fdc-sr-legacy');
const FDC_ZIP_PATH = resolve(FDC_CACHE_ROOT, 'fdc.zip');
const FDC_JSON_PATH = process.env.FDC_SR_LEGACY_JSON
  ? resolve(process.env.FDC_SR_LEGACY_JSON)
  : resolve(FDC_CACHE_ROOT, 'FoodData_Central_sr_legacy_food_json_2018-04.json');

const text = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const checksum = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function nutrient(food, id, name, unit) {
  const row = (food.foodNutrients || []).find((item) => {
    const source = item.nutrient || item;
    return Number(source.id || source.number) === id
      || (text(source.name) === text(name) && String(source.unitName || item.unitName || '').toLowerCase() === unit.toLowerCase());
  });
  return Number(row?.amount ?? row?.value ?? 0);
}

async function jsonFetch(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'smart-canteen-food-reference-sync/1.0' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function ensureFdcSnapshot() {
  if (existsSync(FDC_JSON_PATH)) return FDC_JSON_PATH;
  mkdirSync(FDC_CACHE_ROOT, { recursive: true });
  if (!existsSync(FDC_ZIP_PATH)) {
    const response = await fetch(FDC_DOWNLOAD_URL, { headers: { 'User-Agent': 'smart-canteen-food-reference-sync/1.0' } });
    if (!response.ok) throw new Error(`FDC SR Legacy 快照下载失败：${response.status}`);
    writeFileSync(FDC_ZIP_PATH, Buffer.from(await response.arrayBuffer()));
  }
  const extracted = spawnSync('tar', ['-xf', FDC_ZIP_PATH, '-C', FDC_CACHE_ROOT], { encoding: 'utf8' });
  if (extracted.status !== 0 || !existsSync(FDC_JSON_PATH)) {
    throw new Error(`FDC SR Legacy 快照解压失败：${extracted.stderr || extracted.stdout}`);
  }
  return FDC_JSON_PATH;
}

function rankCandidate(query, description, dataType) {
  const queryTokens = text(query).split(' ').filter(Boolean);
  const normalizedDescription = text(description);
  const coverage = queryTokens.filter((token) => normalizedDescription.includes(token)).length / Math.max(1, queryTokens.length);
  const brandedPenalty = /brand|restaurant|fast food/.test(normalizedDescription) ? 2 : 0;
  return coverage * 10 + (dataType === 'Foundation' ? 1 : 0.5) - brandedPenalty;
}

function fetchFdc(target, existing, foodsById, foods) {
  let fdcId = Number(target.fdcId || existing?.fdcId || 0);
  if (!fdcId) {
    const ranked = foods.map((item) => ({
      item,
      score: rankCandidate(target.fdcQuery, item.description, item.dataType),
    })).sort((left, right) => right.score - left.score);
    if (!ranked.length || ranked[0].score < 4) throw new Error(`${target.id} 找不到可靠的 FDC 候选`);
    fdcId = Number(ranked[0].item.fdcId);
  }
  const food = foodsById.get(fdcId);
  if (!food) throw new Error(`${target.id} 的 FDC:${fdcId} 不在固定 SR Legacy 快照中`);
  const nutrients = {
    caloriesKcal: nutrient(food, 1008, 'Energy', 'kcal'),
    proteinG: nutrient(food, 1003, 'Protein', 'g'),
    fatG: nutrient(food, 1004, 'Total lipid (fat)', 'g'),
    carbsG: nutrient(food, 1005, 'Carbohydrate, by difference', 'g'),
    fiberG: nutrient(food, 1079, 'Fiber, total dietary', 'g'),
    sodiumMg: nutrient(food, 1093, 'Sodium, Na', 'mg'),
  };
  if (!food.description || !Number(food.fdcId) || nutrients.caloriesKcal <= 0) {
    throw new Error(`${target.id} 的 FDC 记录不完整`);
  }
  return { food, nutrients };
}

function foodOnBlock(snapshot, foodOnId) {
  const iri = `http://purl.obolibrary.org/obo/${foodOnId.replace(':', '_')}`;
  const escaped = iri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = snapshot.match(new RegExp(`<owl:Class rdf:about="${escaped}">([\\s\\S]*?)<\\/owl:Class>`));
  if (!match) throw new Error(`固定 FoodOn 快照中不存在 ${foodOnId}`);
  const label = match[1].match(/<rdfs:label[^>]*>([\s\S]*?)<\/rdfs:label>/)?.[1]?.replace(/&amp;/g, '&').trim();
  return { iri, label: label || foodOnId };
}

function parseFoodOnClasses(snapshot) {
  const classes = [];
  const pattern = /<owl:Class rdf:about="http:\/\/purl\.obolibrary\.org\/obo\/FOODON_(\d+)">([\s\S]*?)<\/owl:Class>/g;
  for (const match of snapshot.matchAll(pattern)) {
    const label = match[2].match(/<rdfs:label[^>]*>([\s\S]*?)<\/rdfs:label>/)?.[1]?.replace(/&amp;/g, '&').trim();
    if (label) classes.push({ foodOnId: `FOODON:${match[1]}`, label });
  }
  return classes;
}

function resolveFoodOn(target, existing, snapshot, classes) {
  let foodOnId = target.foodOnId || existing?.foodOnId;
  if (!foodOnId) {
    const queryTokens = text(target.foodOnQuery).split(' ').filter(Boolean);
    const ranked = classes.map((item) => {
      const label = text(item.label);
      const coverage = queryTokens.filter((token) => label.includes(token)).length / Math.max(1, queryTokens.length);
      const exact = label === text(target.foodOnQuery) ? 3 : 0;
      return { item, score: coverage * 10 + exact };
    }).sort((left, right) => right.score - left.score);
    if (!ranked.length || ranked[0].score < 4) throw new Error(`${target.id} 找不到可靠的 FoodOn 候选`);
    foodOnId = ranked[0].item.foodOnId;
  }
  const pinned = foodOnBlock(snapshot, foodOnId);
  return { foodOnId, label: pinned.label, iri: pinned.iri };
}

const targets = JSON.parse(readFileSync(TARGET_PATH, 'utf8'));
const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
const existing = new Map(JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')).map((item) => [item.id, item]));
const sourceById = new Map(sources.map((source) => [source.id, source]));
if (targets.length !== 60) throw new Error(`参考食材目标必须为 60 项，当前为 ${targets.length}`);
const duplicateIds = targets.filter((target, index) => targets.findIndex((item) => item.id === target.id) !== index);
if (duplicateIds.length) throw new Error(`参考食材目标 ID 重复：${duplicateIds.map((item) => item.id).join('、')}`);

const snapshotResponse = await fetch(FOODON_SNAPSHOT_URL, { headers: { 'User-Agent': 'smart-canteen-food-reference-sync/1.0' } });
if (!snapshotResponse.ok) throw new Error(`FoodOn 固定快照下载失败：${snapshotResponse.status}`);
const foodOnSnapshot = await snapshotResponse.text();
const foodOnClasses = parseFoodOnClasses(foodOnSnapshot);
if (foodOnClasses.length < 1000) throw new Error(`FoodOn 固定快照解析异常，仅得到 ${foodOnClasses.length} 个分类`);
const fdcSnapshotPath = await ensureFdcSnapshot();
const fdcFoods = JSON.parse(readFileSync(fdcSnapshotPath, 'utf8')).SRLegacyFoods || [];
const fdcFoodsById = new Map(fdcFoods.map((food) => [Number(food.fdcId), food]));
if (fdcFoods.length < 5000) throw new Error(`FDC SR Legacy 快照解析异常，仅得到 ${fdcFoods.length} 项`);
const results = [];
for (let index = 0; index < targets.length; index += 1) {
  const target = targets[index];
  const previous = existing.get(target.id);
  const { food, nutrients } = fetchFdc(target, previous, fdcFoodsById, fdcFoods);
  const foodOn = resolveFoodOn(target, previous, foodOnSnapshot, foodOnClasses);
  const fdcSource = sourceById.get('usda-fdc');
  const foodOnSource = sourceById.get('foodon');
  results.push({
    id: target.id,
    canonicalName: target.canonicalName,
    aliases: target.aliases,
    foodOnId: foodOn.foodOnId,
    fdcId: Number(food.fdcId),
    fdcDescription: food.description,
    dataType: food.dataType,
    basisGrams: 100,
    nutrients,
    sourceIds: ['usda-fdc', 'foodon'],
    provenance: {
      fdc: {
        sourceId: 'usda-fdc',
        externalId: `FDC:${food.fdcId}`,
        sourceVersion: fdcSource.sourceVersion,
        license: fdcSource.license,
        checksum: checksum({ fdcId: food.fdcId, description: food.description, dataType: food.dataType, nutrients }),
      },
      foodOn: {
        sourceId: 'foodon',
        externalId: foodOn.foodOnId,
        label: foodOn.label,
        sourceVersion: foodOnSource.sourceVersion,
        license: foodOnSource.license,
        checksum: checksum({ commit: FOODON_COMMIT, id: foodOn.foodOnId, label: foodOn.label }),
      },
    },
    factStatus: 'reference_only',
    campusDishFactPolicy: 'must_not_overwrite',
    retrievedAt: RETRIEVED_AT,
  });
  console.error(`[${index + 1}/${targets.length}] ${target.id} -> FDC:${food.fdcId} / ${foodOn.foodOnId}`);
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: OUTPUT_PATH, count: results.length, foodOnCommit: FOODON_COMMIT }, null, 2));
