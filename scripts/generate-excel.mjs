import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import XLSX from 'xlsx';

const dbPath = resolve(import.meta.dirname || '.', '..', 'data', 'smart-canteen.sqlite');
const db = new DatabaseSync(dbPath);

// dish_type → 一级业务类型
function mapLevel1(dishType, cuisineType) {
  if (dishType === '甜点') return '甜点';
  if (dishType === '小吃') return '小吃零食';
  if (cuisineType === '饮品') return '饮品';
  if (cuisineType === '超市') return '超市';
  return '正餐';
}

// dish_category → 二级菜品类型
function mapLevel2(dishCategory) {
  const m = {
    '面食': '面食/粉类', '米饭': '米饭套餐', '炒菜小炒': '家常热菜',
    '面点饼类': '早餐面点', '砂锅类': '砂锅/煲类', '早点类': '早餐面点',
    '饺子': '饺子/馄饨', '烧烤小吃类': '烧烤/小吃', '汉堡': '汉堡/炸鸡',
    '汤品炖品': '汤品/炖品', '麻辣烫': '火锅/麻辣烫',
    '简餐类': '沙拉/轻食', '凉拌冷菜': '凉拌/冷菜',
    '烘焙甜点': '甜点', '火锅': '火锅/麻辣烫',
  };
  return m[dishCategory] || dishCategory;
}

// meal_period → 三级餐次
function mapLevel3(mealPeriod) {
  return mealPeriod || '全天';
}

// Query dishes with stall and canteen info
const rawRows = db.prepare(`
  SELECT d.id, d.name, d.price, d.catalog_item_type, d.catalog_category,
         d.dish_type, d.dish_category, d.meal_period, d.description,
         s.name AS stall_name, s.cuisine_type,
         c.name AS canteen_name,
         pc.name AS parent_canteen_name
  FROM dishes d
  LEFT JOIN stalls s ON s.id = d.stall_id
  LEFT JOIN canteens c ON c.id = s.canteen_id
  LEFT JOIN canteens pc ON pc.id = c.parent_id
  ORDER BY pc.name, c.name, s.name, d.name
`).all();

// Fill in missing stall/canteen from description
const rows = rawRows.map(r => {
  let stall = r.stall_name, canteen = r.canteen_name, parent = r.parent_canteen_name;
  if (!stall || !canteen) {
    const ext = extractFromDesc(r.description);
    if (!stall) stall = ext.stall;
    if (!canteen) canteen = ext.canteen;
  }
  return { ...r, stall_name: stall, canteen_name: canteen, parent_canteen_name: parent };
});

// Extract stall/canteen name from description when JOIN fails
function extractFromDesc(desc) {
  if (!desc) return { stall: '未知档口', canteen: '未知食堂', parent: '' };
  // Pattern: "食堂名 · 档口名菜单目录" or "食堂名 · 档口名 菜单目录"
  const m = desc.match(/^(.+?)\s*·\s*(.+?)(?:菜单目录|$)/);
  if (!m) return { stall: '未知档口', canteen: '未知食堂', parent: '' };
  return { stall: m[2].trim().replace(/[@\s]*$/, ''), canteen: m[1].trim(), parent: '' };
}

// Format price
function fmtPrice(p) {
  if (Number.isInteger(p)) return p + '元';
  return Number(p).toFixed(1) + '元';
}

// Sheet 1: 类级1-业务类型
const sheet1 = [['菜品ID', '菜品名称', '食堂', '餐厅', '档口', '价格', '原始类型', '原始分类', '业务类型(一级分类)']];
for (const r of rows) {
  sheet1.push([
    r.id, r.name,
    r.parent_canteen_name || r.canteen_name,
    r.canteen_name,
    r.stall_name,
    fmtPrice(r.price),
    r.catalog_item_type,
    r.catalog_category,
    mapLevel1(r.dish_type, r.cuisine_type),
  ]);
}

// Sheet 2: 类级2-菜品类型
const sheet2 = [['菜品ID', '菜品名称', '食堂', '餐厅', '档口', '价格', '原始类型', '原始分类', '菜品类型(二级分类)']];
for (const r of rows) {
  sheet2.push([
    r.id, r.name,
    r.parent_canteen_name || r.canteen_name,
    r.canteen_name,
    r.stall_name,
    fmtPrice(r.price),
    r.catalog_item_type,
    r.catalog_category,
    mapLevel2(r.dish_category),
  ]);
}

// Sheet 3: 类级3-餐次
const sheet3 = [['菜品ID', '菜品名称', '食堂', '餐厅', '档口', '价格', '原始类型', '原始分类', '餐次(三级分类)']];
for (const r of rows) {
  sheet3.push([
    r.id, r.name,
    r.parent_canteen_name || r.canteen_name,
    r.canteen_name,
    r.stall_name,
    fmtPrice(r.price),
    r.catalog_item_type,
    r.catalog_category,
    mapLevel3(r.meal_period),
  ]);
}

// Write Excel
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), '类级1-业务类型');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2), '类级2-菜品类型');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet3), '类级3-餐次');

const outPath = resolve(import.meta.dirname || '.', '..', '菜品三级分类表_modified.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Excel written to:', outPath);
console.log('Rows:', rows.length);
db.close();
