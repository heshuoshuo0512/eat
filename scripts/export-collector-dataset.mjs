import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openCollectorDatabase } from '../collector-server/database.js';
import { readCollectorObject } from '../collector-server/storage.js';

const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value.slice(2), all[index + 1]?.startsWith('--') ? true : all[index + 1]] : null).filter(Boolean));
const version = String(args.get('version') || `collector-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
const outputRoot = resolve(String(args.get('output') || 'collector-datasets'), version);
const MIN_IMAGES = 60;
const MIN_CONTRIBUTORS = 10;
const QUOTAS = { train: 40, validation: 10, test: 10 };
const splitNames = Object.keys(QUOTAS);

function stable(value) { return createHash('sha256').update(`${version}:${value}`).digest('hex'); }

class UnionFind {
  constructor(values) { this.parent = new Map(values.map((value) => [value, value])); }
  find(value) { const parent = this.parent.get(value); if (parent === value) return value; const root = this.find(parent); this.parent.set(value, root); return root; }
  union(left, right) { const a = this.find(left); const b = this.find(right); if (a !== b) this.parent.set(stable(a) < stable(b) ? b : a, stable(a) < stable(b) ? a : b); }
}

const db = await openCollectorDatabase();
try {
  const catalogVersion = (await db.get("SELECT value FROM collector_catalog_meta WHERE key = 'version'"))?.value || 'unknown';
  const rows = await db.all(`SELECT submission.id, submission.contributor_id, submission.duplicate_of,
      submission.selected_dish_id AS dish_id, object.storage_provider, object.storage_key, object.sha256,
      dish.canonical_name, dish.name AS dish_name, stall.name AS stall_name,
      venue.name AS venue_name, submission.group_id, group_row.name AS group_name,
      CASE WHEN target.dish_id IS NULL THEN 0 ELSE 1 END AS is_target
    FROM collector_submissions submission
    JOIN collector_objects object ON object.id = submission.object_id
    LEFT JOIN collector_targets target ON target.group_id = submission.group_id AND target.dish_id = submission.selected_dish_id AND target.active = 1
    JOIN collector_catalog_dishes dish ON dish.id = submission.selected_dish_id
    JOIN collector_catalog_stalls stall ON stall.id = dish.stall_id
    JOIN collector_catalog_venues venue ON venue.id = stall.venue_id
    JOIN collector_groups group_row ON group_row.id = submission.group_id
    WHERE submission.status = 'approved' AND submission.consent_version = 'collector-training-v1'
    ORDER BY submission.selected_dish_id, submission.created_at, submission.id`);

  const targetRows = rows.filter((row) => Number(row.is_target) === 1);
  const unknownRows = rows.filter((row) => Number(row.is_target) === 0);
  const byDish = new Map();
  for (const row of targetRows) {
    if (!byDish.has(row.dish_id)) byDish.set(row.dish_id, []);
    byDish.get(row.dish_id).push(row);
  }
  const initiallyEligible = new Set();
  const excluded = [];
  for (const [dishId, images] of byDish) {
    const contributors = new Set(images.map((item) => item.contributor_id));
    if (images.length >= MIN_IMAGES && contributors.size >= MIN_CONTRIBUTORS) initiallyEligible.add(dishId);
    else excluded.push({ dishId, dishName: images[0]?.dish_name || dishId, approved: images.length, contributors: contributors.size, reason: images.length < MIN_IMAGES ? 'fewer_than_60_images' : 'fewer_than_10_contributors' });
  }

  const eligibleRows = targetRows.filter((row) => initiallyEligible.has(row.dish_id));
  const submissionOwner = new Map(eligibleRows.map((row) => [row.id, row.contributor_id]));
  const union = new UnionFind([...new Set(eligibleRows.map((row) => row.contributor_id))]);
  for (const row of eligibleRows) {
    const other = row.duplicate_of ? submissionOwner.get(row.duplicate_of) : null;
    if (other) union.union(row.contributor_id, other);
  }

  const entities = new Map();
  for (const row of eligibleRows) {
    const entityId = union.find(row.contributor_id);
    if (!entities.has(entityId)) entities.set(entityId, { id: entityId, rows: [], counts: new Map() });
    const entity = entities.get(entityId);
    entity.rows.push(row);
    entity.counts.set(row.dish_id, (entity.counts.get(row.dish_id) || 0) + 1);
  }
  const assignedCounts = Object.fromEntries(splitNames.map((split) => [split, new Map()]));
  const assignments = new Map();
  const orderedEntities = [...entities.values()].sort((left, right) => right.rows.length - left.rows.length || stable(left.id).localeCompare(stable(right.id)));
  for (const entity of orderedEntities) {
    const candidates = splitNames.map((split) => {
      let utility = 0;
      for (const [dishId, count] of entity.counts) {
        const current = assignedCounts[split].get(dishId) || 0;
        const deficit = Math.max(0, QUOTAS[split] - current);
        const overflow = Math.max(0, current + count - QUOTAS[split]);
        const scarcityWeight = split === 'train' ? 1 : 1.35;
        utility += Math.min(count, deficit) * scarcityWeight - overflow * 1.8;
      }
      return { split, utility, tie: stable(`${entity.id}:${split}`) };
    }).sort((a, b) => b.utility - a.utility || a.tie.localeCompare(b.tie));
    const split = candidates[0].split;
    assignments.set(entity.id, split);
    for (const [dishId, count] of entity.counts) assignedCounts[split].set(dishId, (assignedCounts[split].get(dishId) || 0) + count);
  }

  const selectedByDish = new Map();
  for (const dishId of initiallyEligible) {
    const selected = {};
    for (const split of splitNames) {
      selected[split] = eligibleRows
        .filter((row) => row.dish_id === dishId && assignments.get(union.find(row.contributor_id)) === split)
        .sort((a, b) => stable(a.sha256).localeCompare(stable(b.sha256)))
        .slice(0, QUOTAS[split]);
    }
    const complete = splitNames.every((split) => selected[split].length === QUOTAS[split]);
    if (complete) selectedByDish.set(dishId, selected);
    else excluded.push({ dishId, dishName: byDish.get(dishId)[0].dish_name, approved: byDish.get(dishId).length, contributors: new Set(byDish.get(dishId).map((item) => item.contributor_id)).size, reason: 'contributor_grouped_split_cannot_reach_40_10_10', splitCounts: Object.fromEntries(splitNames.map((split) => [split, selected[split].length])) });
  }

  if (!selectedByDish.size) throw Object.assign(new Error('没有菜品同时满足 60 张、10 位贡献者和按贡献者隔离的 40/10/10 拆分'), { code: 'COLLECTOR_DATASET_NOT_READY' });
  await mkdir(resolve(outputRoot, 'images'), { recursive: true });
  const manifest = [];
  const selectedSubmissionIds = new Set();
  for (const [dishId, selected] of selectedByDish) {
    for (const split of splitNames) {
      for (const [index, row] of selected[split].entries()) {
        const relativePath = `images/${split}/${dishId}/${String(index + 1).padStart(3, '0')}-${row.sha256.slice(0, 12)}.jpg`;
        const target = resolve(outputRoot, relativePath);
        await mkdir(resolve(target, '..'), { recursive: true });
        const body = await readCollectorObject({ storageProvider: row.storage_provider, storageKey: row.storage_key });
        const checksum = createHash('sha256').update(body).digest('hex');
        if (checksum !== row.sha256) throw new Error(`图片校验失败：${row.id}`);
        await writeFile(target, body);
        selectedSubmissionIds.add(row.id);
        manifest.push({ image: relativePath.replace(/\\/g, '/'), dish_id: row.dish_id, canonical_name: row.canonical_name, dish_name: row.dish_name, group_id: row.group_id, group_name: row.group_name, venue: row.venue_name, stall: row.stall_name, split, catalog_version: catalogVersion, sha256: checksum, prompt_generic: `一份${row.canonical_name}`, prompt_instance: `${row.venue_name}${row.stall_name}售卖的${row.canonical_name}` });
      }
    }
  }
  const contributorSplits = new Map(eligibleRows.map((row) => [row.contributor_id, assignments.get(union.find(row.contributor_id))]));
  const unknownSelected = unknownRows
    .filter((row) => contributorSplits.get(row.contributor_id) !== 'train')
    .filter((row) => !row.duplicate_of || !selectedSubmissionIds.has(row.duplicate_of))
    .sort((left, right) => stable(left.sha256).localeCompare(stable(right.sha256)))
    .slice(0, 1000);
  for (const [index, row] of unknownSelected.entries()) {
    const relativePath = `images/unknown/${row.dish_id}/${String(index + 1).padStart(4, '0')}-${row.sha256.slice(0, 12)}.jpg`;
    const target = resolve(outputRoot, relativePath);
    await mkdir(resolve(target, '..'), { recursive: true });
    const body = await readCollectorObject({ storageProvider: row.storage_provider, storageKey: row.storage_key });
    const checksum = createHash('sha256').update(body).digest('hex');
    if (checksum !== row.sha256) throw new Error(`图片校验失败：${row.id}`);
    await writeFile(target, body);
    manifest.push({ image: relativePath.replace(/\\/g, '/'), dish_id: row.dish_id, canonical_name: row.canonical_name, dish_name: row.dish_name, group_id: row.group_id, group_name: row.group_name, venue: row.venue_name, stall: row.stall_name, split: 'unknown', catalog_version: catalogVersion, sha256: checksum, prompt_generic: `一份${row.canonical_name}`, prompt_instance: `${row.venue_name}${row.stall_name}售卖的${row.canonical_name}` });
  }
  await writeFile(resolve(outputRoot, 'manifest.jsonl'), `${manifest.map((item) => JSON.stringify(item)).join('\n')}\n`);
  const summary = { version, catalogVersion, createdAt: new Date().toISOString(), thresholds: { imagesPerDish: MIN_IMAGES, contributorsPerDish: MIN_CONTRIBUTORS, splitQuotas: QUOTAS }, eligibleDishes: selectedByDish.size, images: manifest.length, splits: Object.fromEntries([...splitNames, 'unknown'].map((split) => [split, manifest.filter((item) => item.split === split).length])), excluded };
  await writeFile(resolve(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await db.run(`INSERT INTO collector_dataset_versions(id, name, status, catalog_version, manifest_path, metrics_json, created_at)
    VALUES (?, ?, 'draft', ?, ?, '{}', ?) ON CONFLICT(name) DO UPDATE SET catalog_version=excluded.catalog_version, manifest_path=excluded.manifest_path`, [`collector-dataset-${randomUUID()}`, version, catalogVersion, resolve(outputRoot, 'manifest.jsonl'), new Date().toISOString()]);
  console.log(JSON.stringify({ ok: true, output: outputRoot, ...summary }, null, 2));
} finally {
  await db.close();
}
