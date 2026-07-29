import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? []);
}

function canonicalName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s·・()（）\-_]+/g, '')
    .replace(/西红柿/g, '番茄')
    .trim()
    .toLowerCase();
}

function targetEligibility(dish) {
  const name = String(dish.name || '').trim();
  if (name.length < 2 || name.length > 28) return false;
  if (/^(?:[a-z]\d+|\d+\s*[.、]|[.、])/i.test(name)) return false;
  const excluded = /(?:打包费|餐盒|加(?:蛋|肉|面|饭|料)|套餐|人份|任选|自选|≥|[+＋]|\d+\s*(?:l|ml|克|斤|份)|矿泉水|可乐|雪碧|饮料|茶粹|茶系列|系列茶|东方树叶|三得利|脉动|康师傅|今麦郎|百事|果汁|啤酒|咖啡|牛奶|酸奶|豆浆|素菜|荤菜)/i;
  return !excluded.test(name);
}

function popularityScore(dish) {
  return Number(dish.sales || 0) + Number(dish.reviewCount || 0) * 5 + Number(dish.rating || 0) * 2;
}

async function readCatalogFile(path) {
  const payload = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (!Array.isArray(payload.canteens) || !Array.isArray(payload.stalls) || !Array.isArray(payload.dishes)) {
    throw Object.assign(new Error('目录快照缺少 canteens、stalls 或 dishes'), { code: 'INVALID_CATALOG_SNAPSHOT' });
  }
  return payload;
}

async function readCatalogRemote(url, token) {
  const response = await fetch(url, {
    headers: token ? { 'X-Collector-Key': token } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error(`目录同步失败：HTTP ${response.status}`), { code: 'CATALOG_SYNC_FAILED' });
  return response.json();
}

export async function loadCatalogSource() {
  if (process.env.COLLECTOR_CATALOG_URL) {
    return readCatalogRemote(process.env.COLLECTOR_CATALOG_URL, process.env.COLLECTOR_CATALOG_SYNC_KEY || '');
  }
  return readCatalogFile(process.env.COLLECTOR_CATALOG_FILE || 'data/imports/real/campus-2026-07-27/catalog.json');
}

async function seedGroups(db, timestamp) {
  const existing = Number((await db.get('SELECT COUNT(*) AS count FROM collector_groups'))?.count || 0);
  if (existing) return;
  const defaults = [
    ['collector-west-halls', '西区楼层厅', '西区大食堂楼层采集区', 1],
    ['collector-west-specialty', '西区特色餐厅', '西区特色餐厅采集区', 2],
    ['collector-yanminghu', '燕鸣湖餐厅', '燕鸣湖一楼与二楼采集区', 3],
    ['collector-east-life', '东区生活区', '东大活与广源采集区', 4],
  ];
  for (const row of defaults) {
    await db.run(`INSERT INTO collector_groups
      (id, name, description, display_order, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)`, [...row, timestamp, timestamp]);
  }
}

async function seedVenueMappings(db) {
  const existing = Number((await db.get('SELECT COUNT(*) AS count FROM collector_group_venues'))?.count || 0);
  if (existing) return;
  const defaults = {
    'collector-west-halls': ['west-floor2-east', 'west-floor3-east'],
    'collector-west-specialty': ['west-darongshu', 'west-xinyi', 'west-minzu', 'west-xijinjia'],
    'collector-yanminghu': ['east-yanminghu-1f', 'east-yanminghu-2f'],
    'collector-east-life': ['east-dongdahuo', 'east-guangyuan'],
  };
  for (const [groupId, venueIds] of Object.entries(defaults)) {
    for (const venueId of venueIds) {
      const venue = await db.get('SELECT id FROM collector_catalog_venues WHERE id = ?', [venueId]);
      if (venue) await db.run('INSERT INTO collector_group_venues(group_id, venue_id) VALUES (?, ?) ON CONFLICT(group_id, venue_id) DO NOTHING', [groupId, venueId]);
    }
  }
}

async function seedTargets(db) {
  const groups = await db.all('SELECT id FROM collector_groups WHERE active = 1 ORDER BY display_order');
  for (const group of groups) {
    const submissions = Number((await db.get('SELECT COUNT(*) AS count FROM collector_submissions WHERE group_id = ?', [group.id]))?.count || 0);
    if (!submissions) {
      await db.run(`DELETE FROM collector_targets WHERE group_id = ? AND dish_id IN
        (SELECT id FROM collector_catalog_dishes WHERE target_eligible = 0)`, [group.id]);
    }
    const count = Number((await db.get('SELECT COUNT(*) AS count FROM collector_targets WHERE group_id = ?', [group.id]))?.count || 0);
    if (count >= 50) continue;
    const dishes = await db.all(`SELECT dish.id
      FROM collector_catalog_dishes dish
      JOIN collector_catalog_stalls stall ON stall.id = dish.stall_id
      JOIN collector_group_venues mapping ON mapping.venue_id = stall.venue_id
      WHERE mapping.group_id = ? AND dish.status = 'active' AND dish.target_eligible = 1
        AND dish.id NOT IN (SELECT dish_id FROM collector_targets WHERE group_id = ?)
      ORDER BY dish.popularity_score DESC, dish.name, dish.id LIMIT ?`, [group.id, group.id, 50 - count]);
    for (const [index, dish] of dishes.entries()) {
      await db.run(`INSERT INTO collector_targets(group_id, dish_id, goal_images, priority, active)
        VALUES (?, ?, 60, ?, 1) ON CONFLICT(group_id, dish_id) DO NOTHING`, [group.id, dish.id, 50 - count - index]);
    }
  }
}

export async function syncCollectorCatalog(db, payload = null) {
  const catalog = payload || await loadCatalogSource();
  const timestamp = nowIso();
  const version = String(catalog.manifest?.dataVersion || catalog.manifest?.batchId || catalog.manifest?.version || `catalog-${timestamp}`);
  await db.transaction(async (tx) => {
    for (const venue of catalog.canteens) {
      await tx.run(`INSERT INTO collector_catalog_venues
        (id, name, display_name, parent_id, venue_kind, source_version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, display_name=excluded.display_name,
          parent_id=excluded.parent_id, venue_kind=excluded.venue_kind,
          source_version=excluded.source_version, updated_at=excluded.updated_at`, [
        String(venue.id), String(venue.name || venue.displayName || venue.id), String(venue.displayName || ''),
        venue.parentId || venue.parent_id || null, String(venue.venueKind || venue.venue_kind || 'dining_hall'), version, timestamp,
      ]);
    }
    for (const stall of catalog.stalls) {
      await tx.run(`INSERT INTO collector_catalog_stalls
        (id, venue_id, name, aliases_json, source_version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET venue_id=excluded.venue_id, name=excluded.name,
          aliases_json=excluded.aliases_json, source_version=excluded.source_version, updated_at=excluded.updated_at`, [
        String(stall.id), String(stall.canteenId || stall.canteen_id), String(stall.name || stall.id), json(stall.aliases), version, timestamp,
      ]);
    }
    for (const dish of catalog.dishes) {
      await tx.run(`INSERT INTO collector_catalog_dishes
        (id, stall_id, name, canonical_name, aliases_json, status, source_version, popularity_score, target_eligible, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET stall_id=excluded.stall_id, name=excluded.name,
          canonical_name=excluded.canonical_name, aliases_json=excluded.aliases_json,
          status=excluded.status, source_version=excluded.source_version,
          popularity_score=excluded.popularity_score, target_eligible=excluded.target_eligible,
          updated_at=excluded.updated_at`, [
        String(dish.id), String(dish.stallId || dish.stall_id), String(dish.name || dish.id), canonicalName(dish.name),
        json(dish.aliases), String(dish.status || 'active'), version, popularityScore(dish), targetEligibility(dish) ? 1 : 0, timestamp,
      ]);
    }
    await tx.run(`INSERT INTO collector_catalog_meta(key, value, updated_at) VALUES ('version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, [version, timestamp]);
    await seedGroups(tx, timestamp);
    await seedVenueMappings(tx);
    await seedTargets(tx);
  });
  return { version, venues: catalog.canteens.length, stalls: catalog.stalls.length, dishes: catalog.dishes.length };
}

export function normalizeCatalogTerm(value) {
  return canonicalName(value);
}
