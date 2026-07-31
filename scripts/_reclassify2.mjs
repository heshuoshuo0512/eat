import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/smart-canteen.sqlite');

function classify(dish) {
  const name = dish.name || '';
  const cuisine = dish.cuisine || '';
  const taste = dish.taste || '';
  const tags = dish.tags ? JSON.parse(dish.tags) : [];
  const ingredients = dish.ingredients ? JSON.parse(dish.ingredients) : [];
  const stallName = dish.stall_name || '';
  const itemType = dish.catalog_item_type || 'meal';
  const text = [name, cuisine, taste, stallName, ...tags, ...ingredients].join(' ');

  // === Stall-based overrides for obvious brand stalls ===

  // Pure tea/beverage brand stalls — force ALL items as beverages (only for unmistakable brands)
  if (/蜜雪冰城|茶瀑布|茶言茶语|甜啦啦|甜艺屋|益禾堂|益和堂|淳菓酸奶/.test(stallName)) {
    if (/美式|拿铁|咖啡|摩卡/.test(name)) return '咖啡';
    if (/酸奶/.test(name)) return '奶制品';
    if (/圣代|甜筒|冰激凌|冰淇淋|绵绵冰|炒酸奶/.test(name)) return '甜品';
    if (/可乐|雪碧|芬达|汽水/.test(name)) return '碳酸饮料';
    return '茶饮';
  }

  // Coffee shop stalls
  if (/幸运咖|瑞幸咖啡|库迪咖啡|研所寄希咖啡/.test(stallName)) {
    if (/茶|柠檬|果茶/.test(name)) return '茶饮';
    return '咖啡';
  }

  // Pure burger chain stalls → force all items as burger-related
  if (/塔斯汀|中国汉堡|汉堡工坊|肯德基|麦当劳/.test(stallName)) {
    if (/^可乐$|^雪碧$|^芬达$|圣代|甜筒|冰激凌|冰淇淋/.test(name)) return '甜品';
    if (/^[A-Z]\d*\s*套餐/.test(name) || /^套餐\s*[A-Z]\d*/.test(name)) return '汉堡套餐';
    if (/^T\d+/.test(name)) return '汉堡套餐';
    if (/堡/.test(name)) return '汉堡套餐';
    if (/套餐/.test(name)) return '汉堡套餐';
    if (/薯条|鸡块|鸡米花|洋葱圈|鸡翅|鸡排|鸡腿|鸡架|鸡柳|鳕鱼|地瓜丸|杏鲍菇|海皇星|辣翅/.test(name)) return '汉堡小吃';
    return '汉堡小吃';
  }

  // Mixed burger + rice stalls (汉堡‐鸡排饭, 汉堡工厂, 0090汉堡工厂)
  if (/汉堡‐鸡排饭|汉堡工厂|0090汉堡/.test(stallName)) {
    if (/^[A-Z]\d*\s*套餐/.test(name) || /^套餐\s*[A-Z]\d*/.test(name)) return '汉堡套餐';
    if (/^T\d+/.test(name)) return '汉堡套餐';
    if (/堡/.test(name)) return '汉堡套餐';
    if (/套餐.*(?:薯条|鸡块|鸡米花|洋葱圈|可乐)/.test(name)) return '汉堡套餐';
    if (/鸡排饭|咖喱.*饭|饭$|粉丝|培根卷/.test(name)) return '快餐';
    if (/薯条|鸡块|鸡米花|洋葱圈|鸡翅|鸡排|鸡腿|鸡柳/.test(name)) return '汉堡小吃';
  }

  // Fried chicken stalls
  if (/临榆炸鸡/.test(stallName)) {
    if (/大饼|馒头|米饭|素菜|板肠/.test(name)) return '小吃单品';
    if (/鸡爪/.test(name)) return '烧烤卤味';
    return '汉堡小吃';
  }

  // Duck snack stalls
  if (/鸭货/.test(stallName)) return '烧烤卤味';

  // Bakery stalls
  if (/燕巢烘焙|橘包包.*面包/.test(stallName)) return '早餐面点';
  if (/红枣牛奶蛋糕/.test(stallName)) return '甜品';

  // Non-meal classification
  if (itemType === 'beverage') {
    if (/豆浆|豆奶|杂粮汁|玉米汁|山药汁|醪糟|银耳/.test(name)) return '早餐饮品';
    if (/奶|牛奶|酸奶|鲜奶|乳酸菌|奶茶/.test(name)) return '奶制品';
    if (/茶|果茶|柠檬水|酸梅汤|冰红茶|绿茶|红茶|乌龙|茉莉|龙井/.test(name)) return '茶饮';
    if (/咖啡/.test(name)) return '咖啡';
    if (/可乐|雪碧|芬达|汽水/.test(name)) return '碳酸饮料';
    if (/矿泉水|纯净水|苏打水/.test(name)) return '饮用水';
    if (/脉动|红牛|功能|运动饮料/.test(name)) return '功能饮料';
    if (/啤酒|白酒|果酒/.test(name)) return '酒类';
    return '其他饮品';
  }

  if (itemType === 'snack') {
    if (/汉堡|堡|炸鸡|薯条|鸡块|鸡米花|洋葱圈|鸡翅|鸡排|鸡腿/.test(name)) return '汉堡小吃';
    if (/烤肠|香肠|热狗|骨肉相连|辣条|鸭脖|鸭货|卤味|鸡爪|鸭掌/.test(name)) return '烧烤卤味';
    if (/圣代|甜筒|蛋挞|鲜奶|脆皮鲜奶|甜点|布丁|冰激凌|冰淇淋|慕斯/.test(name)) return '甜品';
    if (/串/.test(name) && !/麻辣烫|火锅/.test(text)) return '烧烤卤味';
    return '小吃单品';
  }

  // === Meals ===

  // 汉堡套餐 (only for non-burger-stall items that look like burgers)
  if (/汉堡|burger/i.test(name)) return '汉堡套餐';
  if (/T\d+.*(?:鸡腿堡|汉堡|辣翅|鸡腿)/.test(name)) return '汉堡套餐';

  // 轻食简餐
  if (/沙拉|三明治|谷物碗|轻食|减脂餐/.test(text)) return '轻食简餐';

  // 火锅麻辣烫
  if (/麻辣烫|麻辣香锅|冒菜|火锅|串串|麻辣拌|香锅/.test(text)) return '火锅麻辣烫';
  if (/^冒/.test(name) && !/冒菜/.test(name)) return '火锅麻辣烫';

  // 早餐面点
  if (/粥$|粥（|粥\(/.test(name)) return '早餐面点';
  if (/^.*粥/.test(name) && name.length <= 5) return '早餐面点';
  if (/包$|包子|馒头|烧麦|油条|豆腐脑|锅贴|盒子|粽子|汤圆|麻团|发糕|花卷|糖包|豆沙包|小笼包|生煎|煎包|肉包|菜包|豆沙|奶黄包/.test(name)) return '早餐面点';
  if (/肉灌饼|掉渣饼|手抓饼|煎饼|卷饼|鸡蛋饼|酱香饼|葱花饼|肉夹馍|烤地瓜|烤红薯|蒸饺|馅饼|麦多馅饼/.test(name)) return '早餐面点';
  if (/馍/.test(name) && !/煮馍|泡馍|炒馍|烩馍|夹馍/.test(name) && name.length <= 5) return '早餐面点';
  if (/饼$/.test(name) && !/饭|面|粉|锅|煲|炒/.test(name) && name.length <= 5) return '早餐面点';
  if (/鸡肉饼|土豆饼|韭菜饼|萝卜饼/.test(name)) return '早餐面点';
  if (/豆浆|豆奶|杂粮汁|玉米汁|山药汁|银耳汤|醪糟/.test(name)) return '早餐面点';

  // 面食粉类
  if (/面$|面（|面\(|拉面|拌面|刀削|板面|担担面|凉面|热干面|炸酱面|牛肉面|排骨面|鸡块面|肉丝面|鸡蛋面|番茄面|酸菜面|雪菜面|榨菜面|臊子面|油泼面|炒面|汤面|捞面/.test(name)) return '面食粉类';
  if (/粉$|粉（|粉\(|米粉|河粉|螺蛳粉|酸辣粉|土豆粉|红薯粉|炒粉|汤粉/.test(name)) return '面食粉类';
  if (/米线|馄饨|水饺|饺子|抄手|云吞|面皮/.test(name)) return '面食粉类';

  // === 套餐饭 (combo/set rice meals) ===
  if (/套餐|双拼|双人餐|多人餐|组合|便当|焗饭|煲仔饭|盖浇饭|木桶饭|烧腊|全家桶/.test(name)) {
    if (!/汉堡|堡|薯条/.test(text)) return '套餐饭';
  }

  // === 快餐 (quick single-plate rice) ===
  if (/饭$|饭（|饭\(|盖饭|炒饭|拌饭|烤肉饭|鸡排饭|卤肉饭|咖喱饭|鸡饭|鸭饭/.test(name)) return '快餐';

  return '家常热菜';
}

const dishes = db.prepare(`
  SELECT d.id, d.name, d.cuisine, d.taste, d.tags_json as tags, d.ingredients_json as ingredients,
         s.name as stall_name, d.catalog_item_type, d.catalog_category as old_cat
  FROM dishes d JOIN stalls s ON s.id = d.stall_id
`).all();

console.log(`Total: ${dishes.length} dishes`);

const counts = {};
const changes = [];
for (const d of dishes) {
  const newCat = classify(d);
  counts[newCat] = (counts[newCat] || 0) + 1;
  if (newCat !== d.old_cat) {
    changes.push({ id: d.id, name: d.name, old: d.old_cat, new: newCat, type: d.catalog_item_type });
  }
}

console.log(`Changes: ${changes.length}`);
for (const c of changes.slice(0, 40)) console.log(`  [${c.type}] ${c.name}: ${c.old} → ${c.new}`);
if (changes.length > 40) console.log(`  ... and ${changes.length - 40} more`);

console.log('\n=== New distribution ===');
for (const [cat, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${n}`);
}

// Apply
const update = db.prepare('UPDATE dishes SET catalog_category = ? WHERE id = ?');
db.exec('BEGIN');
for (const c of changes) update.run(c.new, c.id);
db.exec('COMMIT');
console.log(`\nUpdated ${changes.length} dishes`);
db.close();
