import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const audit = JSON.parse(readFileSync('docs/连锁菜单清洗与分类审计-2026-08-08.json', 'utf8'));
const release = JSON.parse(readFileSync('data/chain-menu-release-2026-08-08.json', 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

test('chain menu audit excludes Wallace and keeps the approved source count', () => {
  assert.equal(audit.summary.sourceFileCount, 14);
  assert.equal(audit.summary.acceptedCount, 824);
  assert.equal(audit.summary.excludedCount, 122);
  assert.equal(audit.summary.reviewRequiredCount, 282);
  assert.ok(!audit.sources.some((source) => source.sourceName === '华莱士.md'));
  assert.ok(!audit.accepted.some((row) => row.sourceName === '华莱士.md'));
});

test('chain menu release has stable, unique, explicitly mapped items', () => {
  assert.equal(release.batchId, 'chain-menu-release-2026-08-08-v1');
  assert.equal(release.items.length, 824);
  assert.deepEqual(release.summary.byItemType, { meal: 25, snack: 236, beverage: 563 });
  assert.equal(release.newStalls.length, 4);
  const ids = new Set();
  for (const item of release.items) {
    assert.match(item.id, /^chain-[a-f0-9]{14}$/);
    assert.equal(ids.has(item.id), false);
    ids.add(item.id);
    assert.ok(item.stallId);
    assert.ok(item.canteenId);
    assert.ok(Number.isFinite(item.price) && item.price >= 0);
    assert.ok(['meal', 'snack', 'beverage'].includes(item.itemType));
    assert.ok(['汉堡套餐', '饮品', '小吃单品'].includes(item.category));
    assert.notEqual(item.sourceName, '华莱士.md');
  }
  const digest = createHash('sha256').update(canonical({ batchId: release.batchId, items: release.items, newStalls: release.newStalls })).digest('hex');
  assert.equal(release.releaseDigest, digest);
});
