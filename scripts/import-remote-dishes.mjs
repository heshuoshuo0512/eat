import { DatabaseSync } from 'node:sqlite';
import http from 'http';

const REMOTE = '49.233.254.183';
const DB_PATH = 'data/smart-canteen.sqlite';

function api(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: REMOTE, port: 80, path: '/api/dishes/search', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: REMOTE, port: 80, path }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });
}

const MEAL_CATEGORIES = [
  '早餐面点', '米饭套餐', '面食粉类', '火锅麻辣烫',
  '家常热菜', '精品小炒', '汉堡套餐', '轻食简餐',
  '干锅菜', '砂锅煲类', '汤羹', '蒸菜', '水煮菜',
  '烤鱼', '组合套餐', '多人烤鱼',
];

function classifyMeal(name, cuisine, tags, ingredients, stallName) {
  const text = [name, cuisine, stallName, ...(tags || []), ...(ingredients || [])].join(' ').toLowerCase();

  // 早餐面点
  if (/包|馒头|烧麦|粥|油条|豆腐脑|锅贴|盒子|粽子|汤圆|烤地瓜|肉灌饼|掉渣饼|手抓饼|煎饼|卷饼|鸡蛋饼|酱香饼|葱花饼/.test(text) && !/汉堡/.test(text)) {
    if (/面|粉|米线|饭/.test(name)) return '面食粉类';
    return '早餐面点';
  }

  // 面食粉类
  if (/面|拉面|拌面|刀削|粉|米粉|河粉|螺蛳|米线|馄饨|水饺|饺子|蒸饺|抄手/.test(name)) return '面食粉类';

  // 火锅麻辣烫
  if (/麻辣烫|麻辣香锅|冒菜|火锅|串串|麻辣拌/.test(text)) return '火锅麻辣烫';

  // 汉堡套餐
  if (/汉堡|burger|炸鸡|鸡块|薯条|可乐|鸡翅|圣代|甜筒|鸡米花/.test(text) && /套餐|组合/.test(text)) return '汉堡套餐';
  if (/汉堡|burger/i.test(name)) return '汉堡套餐';

  // 轻食简餐
  if (/沙拉|三明治|谷物|轻食/.test(text)) return '轻食简餐';

  // 米饭套餐
  if (/饭|盖饭|炒饭|拌饭|便当|碗$|米饭/.test(name)) return '米饭套餐';

  // 套餐/组合默认
  if (/套餐|组合|双拼/.test(name)) return '米饭套餐';

  // 干锅
  if (/干锅/.test(text)) return '干锅菜';
  // 砂锅
  if (/砂锅|煲/.test(text)) return '砂锅煲类';
  // 烤鱼
  if (/烤鱼/.test(text)) return '烤鱼';
  // 汤羹
  if (/汤|羹/.test(name) && !/麻辣|火锅/.test(text)) return '汤羹';
  // 蒸菜
  if (/蒸/.test(name)) return '蒸菜';
  // 水煮
  if (/水煮/.test(text)) return '水煮菜';

  // 精品小炒 (碟头菜, 常见小炒菜名)
  if (/肉丝|肉片|鸡丁|牛肉|排骨|红烧|糖醋|鱼香|宫保|回锅|小炒|爆炒|溜|熘|焖/.test(name)) return '精品小炒';

  // 默认
  return '家常热菜';
}

async function main() {
  const db = new DatabaseSync(DB_PATH);

  // 1. Fetch and import venues
  console.log('Fetching venues...');
  const venuesData = await get('/api/catalog/venues?pageSize=200');
  const venues = Array.isArray(venuesData) ? venuesData : (venuesData.items || []);
  console.log(`  Got ${venues.length} venues`);

  const insertVenue = db.prepare(`INSERT OR REPLACE INTO canteens (id, tenant_id, name, location, hours, crowd_level, tags_json, description, venue_kind, display_name, display_order, operating_status, review_status, retrieval_eligible, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'approved', 1, ?, ?)`);
  const now = new Date().toISOString();
  for (const v of venues) {
    insertVenue.run(v.id || 'v-'+Math.random(), v.name||'', v.location||'', v.hours||'06:00-19:00', v.crowdLevel||30,
      JSON.stringify(v.tags||[]), v.description||'', v.venueKind||'dining_hall', v.displayName||v.name||'', v.displayOrder||999, now, now);
  }

  // 2. Fetch and import stalls
  console.log('Fetching stalls...');
  const stallsData = await get('/api/catalog/stalls?pageSize=200');
  const stalls = Array.isArray(stallsData) ? stallsData : (stallsData.items || []);
  console.log(`  Got ${stalls.length} stalls`);

  const insertStall = db.prepare(`INSERT OR REPLACE INTO stalls (id, tenant_id, canteen_id, floor, name, aliases_json, category, rating, avg_price, open, reservation_enabled, description, review_status, retrieval_eligible, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, '[]', ?, 0, 0, 1, 0, ?, 'approved', 1, ?, ?)`);
  for (const s of stalls) {
    insertStall.run(s.id, s.canteenId||'', s.floor||'', s.name||'', s.category||'综合', s.description||'', now, now);
  }

  // 3. Fetch all meal dishes in batches
  console.log('Fetching dishes...');
  const allDishes = [];
  let page = 1;
  const pageSize = 100;
  while (true) {
    const r = await api({ itemType: 'meal', page, pageSize, sort: 'name' });
    allDishes.push(...(r.items || []));
    console.log(`  Page ${page}: ${r.items?.length||0} dishes (total so far: ${allDishes.length})`);
    if (!r.page?.hasMore) break;
    page++;
  }
  console.log(`Total dishes fetched: ${allDishes.length}`);

  // 4. Clear existing test dishes and import
  db.exec("DELETE FROM dishes WHERE id LIKE 'd%' OR id LIKE 'dish-%'");
  const insertDish = db.prepare(`INSERT OR REPLACE INTO dishes (id, tenant_id, stall_id, name, price, pricing_mode, price_display, pricing_json,
    taste, cuisine, ingredients_json, seasonings_json, additives_json, tags_json, aliases_json, semantic_labels_json, source_ref_json,
    catalog_item_type, catalog_category, parent_dish_id, halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron,
    rating, review_count, sales, image, image_url, description, status, reservation_enabled, regional_taste, allergens_json,
    safety_declarations_json, dietary_labels_json, nutrition_fact_status, recipe_fact_status, halal_fact_status, dietary_fact_status,
    spice_level, spice_fact_status, fact_source, fact_verified_at, fact_expires_at, data_version, synthetic,
    review_status, retrieval_eligible, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, 'fixed', ?, '{}', ?, ?, ?, '[]', '[]', ?, '[]', '[]', '{}',
    'meal', ?, NULL, 0, '["lunch","dinner"]', 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ?, 0, 0, '🍽️', NULL, ?, 'active', 0, '', '[]',
    '[]', '[]', 'unknown', 'unknown', 'unknown', 'unknown',
    NULL, 'unknown', 'legacy', NULL, NULL, 'manual-v1', 0,
    'approved', 1, ?, ?)`);

  let classified = 0;
  let unclassified = 0;
  const categoryCounts = {};

  const insert = db.prepare('BEGIN');
  for (const dish of allDishes) {
    let category = dish.catalogCategory;
    if (!category || !MEAL_CATEGORIES.includes(category)) {
      category = classifyMeal(dish.name, dish.cuisine||'', dish.tags||[], dish.ingredients||[], dish.stallName||'');
      classified++;
    } else {
      unclassified++;
    }
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    insertDish.run(
      dish.id, dish.stallId, dish.name, dish.price,
      dish.priceDisplay || `${dish.price}元`,
      JSON.stringify(dish.tags||[]),
      dish.taste||'', dish.cuisine||'',
      JSON.stringify(dish.ingredients||[]),
      category,
      dish.rating||0, dish.description||'',
      dish.createdAt||now, dish.updatedAt||now
    );
  }
  db.prepare('COMMIT');

  console.log('\n=== Classification Summary ===');
  for (const [cat, count] of Object.entries(categoryCounts).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nAuto-classified: ${classified}, Original: ${unclassified}`);
  console.log('Done!');

  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
