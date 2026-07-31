import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dbPath = resolve(import.meta.dirname || '.', '..', 'data', 'smart-canteen.sqlite');
const db = new DatabaseSync(dbPath);

// Stall-based type overrides (checked first)
const STALL_SNACKS = new Set([
  '临榆炸鸡腿', '爆脾气生炸鸡架',
]);
const STALL_DRINKS = new Set([
  '水吧冷饮', '蜜雪冰城', '瑞幸咖啡', '库迪咖啡', '幸运咖',
  '甜啦啦', '甜艺屋', '益和堂', '益禾堂', '茶瀑布', '茶言茶语',
  '淳菓酸奶', '喜悦冰糖葫芦', '小孙学长 绵绵冰炒酸奶',
]);
const KNOWN_OTHER_DISHES = new Set([
  '猪肚鸡', '玉米鸡', '素锦锅', '无肚鸡',
]);

// --- Dish type ---
function classifyDishType(name, price, catalogItemType, catalogCategory, stallName, stallId) {
  const n = name.trim();
  for (const s of STALL_SNACKS) { if ((stallName || '').includes(s)) return '小吃'; }
  for (const s of STALL_DRINKS) { if ((stallName || '').includes(s)) return '饮品'; }
  if (/打包费|打包盒|餐盒费|配送费|服务费|加工费|餐具费|纸巾/.test(n)) return '加购';
  if (catalogItemType === 'addon' || catalogItemType === 'fee') return '加购';
  if (/^(可乐|雪碧|芬达|美年达|七喜|汽水|苏打水|矿泉水|纯净水)$/.test(n)) return '饮品';
  if (/^(可口可乐|百事可乐|零度可乐|无糖可乐|冰可乐)$/.test(n)) return '饮品';
  if (/^(美式咖啡|拿铁|摩卡|卡布奇诺|冰美式|热美式)\s*(\(.+\))?$/.test(n)) return '饮品';
  if (/^(奶茶|奶盖|果茶|柠檬茶|冰茶|凉茶|绿茶|红茶|乌龙茶)\s*(\(.+\))?$/.test(n)) return '饮品';
  if (/^(豆浆|冰豆浆|热豆浆|豆奶|牛奶|鲜奶|酸奶)\s*(\(.+\))?$/.test(n)) return '饮品';
  if (/^(果汁|橙汁|西瓜汁|芒果汁|椰汁|椰奶|现榨果汁)\s*(\(.+\))?$/.test(n)) return '饮品';
  if (/^(冰淇淋|圣代|雪糕|冰棍|甜筒|冰沙|奶昔)\s*(\(.+\))?$/.test(n)) return '饮品';
  if (/^(薯条|薯角|薯格|薯饼|炸薯条)\s*(\(.+\))?$/.test(n)) return '小吃';
  if (/^(鸡米花|鸡柳|鸡条|上校鸡块|麦乐鸡|洋葱圈)\s*(\(.+\))?$/.test(n)) return '小吃';
  if (/^(鸡翅|翅中|翅根|烤翅|炸翅|香辣翅|奥尔良翅|炸鸡翅)\s*(\(.+\))?$/.test(n)) return '小吃';
  if (/蛋挞|葡挞|甜点|布丁|爆米花/.test(n)) return '小吃';
  if (/^(春卷|煎饺|锅贴|生煎|烧卖|烧麦)$/.test(n)) return '小吃';
  if (/^(烤肠|热狗|火腿肠|香肠)\s*(\(.+\))?$/.test(n)) return '小吃';
  if (/寿司|饭团|手卷|刺身/.test(n)) return '小吃';
  if (/^卤(蛋|味|菜|煮)/.test(n)) return '小吃';
  if (/^(小吃|小食|零食|点心)/.test(n)) return '小吃';
  return '餐食';
}

// --- Dish category ---
function classifyDishCategory(name, taste, price, stallName, stallCategory) {
  const n = name.trim();
  // Strip trailing parenthetical notes for last-char matching
  const base = n.replace(/\s*[（(][^)）]*[)）]\s*$/, '').replace(/\s*\+\s*.*$/, '').trim();
  const last = base.charAt(base.length - 1);
  const lastTwo = base.length >= 2 ? base.slice(-2) : '';

  // --- Stall overrides ---
  if ((stallName || '').includes('临榆炸鸡腿') || (stallName || '').includes('爆脾气生炸鸡架')) return '炸鸡';

  const burgerStall = (stallName || '').includes('汉堡工坊') || (stallName || '').includes('汉堡工厂') ||
      (stallName || '').includes('塔斯汀') || (stallName || '').includes('燃能') ||
      (stallName || '').includes('肯德基') || (stallName || '').includes('麦当劳');
  if (burgerStall) {
    if (/^(薯条|鸡块|鸡翅|鸡米花|洋葱圈|蛋挞|薯饼|鸡排|可乐|雪碧|芬达|圣代|冰淇淋)/.test(n)) return '小吃零食';
    if (/粉丝|娃娃菜|金针菇|盖饭|炒|炖|煮|面|粉/.test(n)) {} // fall through
    else return '汉堡';
  }

  // Known exceptions
  if (KNOWN_OTHER_DISHES.has(n)) return '其他';

  // ====== LAST-CHARACTER MATCHING (most reliable) ======

  // 盖浇X → check last char: 面→面食, 饭→米饭
  if (/盖浇/.test(base) || /盖面/.test(base)) {
    if (last === '面') return '面食';
    if (last === '饭') return '米饭';
  }

  // Generic last-char rules (only when name is unambiguous)
  if (last === '面' && !/面包|方面|面积|拉面$|拌面$|炒面$|汤面$|捞面$/.test(base)) {
    // Check if it's a known noodle pattern
    if (/拉面|拌面|炒面|汤面|捞面|干面|凉面|热干面|炸酱面|担担面|烩面|焖面|板面|刀削面|手擀面|盖浇面|油泼面|冷面|方便面|小面/.test(base)) return '面食';
    if (/\S面$/.test(base) && !/面包|方面|面积/.test(base)) return '面食';
  }
  if (last === '面' && n.length <= 3) return '面食'; // short names ending in 面

  if (last === '饭') return '米饭';
  if (last === '包' && !/面包|汉堡包|书包|提包|背包|电脑包/.test(base)) return '面点饼类';
  if (last === '粉' && !/面粉|淀粉|奶粉|粉丝|粉条|粉皮/.test(base)) return '面食';
  if (last === '粥') return '粥粉';
  if (last === '饺' || lastTwo === '锅贴') return '饺子';
  if (last === '饼') return '面点饼类';
  if (last === '馍') return '面点饼类';
  if (last === '堡' && !/城堡/.test(base)) return '汉堡';
  if (last === '煲') return '炖菜煲类';
  if (last === '卷' && !/问卷|考卷|试卷/.test(base)) return '面点饼类';
  if (last === '糕') return /蛋糕|奶油|慕斯/.test(base) ? '烘焙甜点' : '面点饼类';
  if (last === '蛋' && base.length <= 5) return '蛋类';
  if (last === '拌' && !/凉拌|搅拌/.test(base)) return '面食';

  // 汤 → need more context
  if (last === '汤') {
    if (/粉丝汤|鸡蛋汤|蛋花汤|胡辣汤|大骨汤/.test(base)) return '汤品炖品';
    if (/汤面|汤粉|汤包|汤饺/.test(base)) return undefined; // fall through
    if (base.length <= 4) return '汤品炖品';
  }

  // 锅 → context-dependent
  if (last === '锅') {
    if (/麻辣|香锅/.test(base)) return '麻辣烫';
    if (/干锅|铁板/.test(base)) return '铁板烧';
    if (/火锅|涮锅/.test(base)) return '火锅';
    return '炖菜煲类';
  }

  // ====== Substring matching ======

  // Noodle/rice noodle patterns
  if (/拉面|拌面|炒面|汤面|捞面|干面|凉面|热干面|炸酱面|担担面|烩面|焖面|板面|刀削面|手擀面|油泼面/.test(n)) return '面食';
  if (/牛肉面|排骨面|鸡腿面|肥肠面|三鲜面|海鲜面|阳春面|葱油面|冷面|方便面|重庆小面/.test(n)) return '面食';
  if (/面皮|面\+|面\s*\+|粉\s*\/\s*面|麻食/.test(n)) return '面食';
  if (/米线|米粉|螺蛳粉|酸辣粉|河粉|肠粉|渔粉|花甲粉|土豆粉/.test(n)) return '面食';
  if (/牛肉粉|羊肉粉|老友粉/.test(n)) return '面食';
  if (/\S粉$/.test(base) && !/面粉|淀粉|奶粉|粉丝|粉条|粉皮/.test(base)) return '面食';
  if (/砂锅.*粉|砂锅.*面|砂锅.*线/.test(n)) return '面食';

  // Rice patterns (that don't end in 饭)
  if (/拌饭|抓饭|盖饭|炒饭|烩饭|焖饭|煲仔饭|石锅饭|铁板饭|木桶饭|荷叶饭|竹筒饭|蛋炒饭/.test(n)) return '米饭';
  if (/卤肉饭|鸡腿饭|鸡排饭|猪排饭|排骨饭|红烧肉饭|扣肉饭|叉烧饭|烧鸭饭|烧鹅饭|牛腩饭|咖喱饭/.test(n)) return '米饭';
  if (/米饭|白饭|蒸饭/.test(n) && !/粉|面|粥/.test(n)) return '米饭';

  // 包子/馒头/面点
  if (/包子|馒头|花卷|油条|小笼|汤包|生煎|煎包|烧麦|烧卖/.test(n)) return '面点饼类';
  if (/肉夹馍|夹馍|馍\+|烩饼|焖饼|炒饼|灌饼|掉渣饼|烤冷面|煎饼果子/.test(n)) return '面点饼类';
  if (/热狗卷|脆骨卷|香葱卷|奶黄卷|肉松卷|开花漫画|红糖馒头|红糖卷/.test(n)) return '面点饼类';
  if (/流沙包|马拉糕/.test(n)) return '面点饼类';

  // 饺子/馄饨 (馄饨面 already caught above)
  if (/饺子|水饺|蒸饺|煎饺|馄饨|抄手|云吞|汤饺|锅贴/.test(n)) return '饺子';

  // Bread/bakery
  if (/面包|蛋糕|蛋挞|葡挞|曲奇|饼干|泡芙|牛角包|吐司|可颂|贝果|披萨|比萨|pizza/i.test(n)) return '烘焙甜点';

  // 汉堡
  if (/汉堡|鸡腿堡|牛肉堡|鳕鱼堡|虾堡|芝士堡|巨无霸|奥堡|鸡胸堡/.test(n)) return '汉堡';

  // 麻辣烫/冒菜
  if (/麻辣烫|冒菜|钵钵鸡|串串/.test(n)) return '麻辣烫';
  if (/^冒/.test(n)) return '麻辣烫';

  // 干锅/铁板/板烧
  if (/干锅|铁板|铁板烧|板烧/.test(n)) return '铁板烧';

  // 火锅
  if (/火锅|涮锅/.test(n)) return '火锅';

  // 炸鸡
  if (/炸鸡|韩式炸鸡|炸鸡腿|炸鸡翅|炸鸡排|炸鸡块|炸全鸡/.test(n)) return '炸鸡';
  if (/鸡排/.test(n) && /炸|大/.test(n) && !/饭|面/.test(n)) return '炸鸡';

  // 烧腊/卤味
  if (/烧腊|烧鸭|烧鹅|叉烧|白切|豉油鸡|盐焗鸡/.test(n)) return '烧腊';
  if (/^酱鸭|^酱板鸭|^口水鸭/.test(n)) return '烧腊';
  if (/^卤/.test(n) && /鸡|鸭|肉|蛋|肠|蹄|爪|翅|腿/.test(n) && !/饼|饭|面|粉|包|馍/.test(n)) return '烧腊';

  // 烧烤
  if (/烧烤|烤肉|烤串|羊肉串|烤羊|烤全羊|烤全鱼/.test(n)) return '烧烤';
  if (/烤鱼/.test(n) || /烤.*鱼/.test(n)) return '烧烤';
  if (/烤鸭|烤鸡|烤乳猪|烤猪/.test(n)) return '烧烤';
  if (/^烤/.test(n) && /鸡|鸭|猪|鱼/.test(n)) return '烧烤';

  // 蛋类
  if (/炒蛋|煎蛋|荷包蛋|卤蛋|茶叶蛋|蒸蛋|蛋羹|蛋花/.test(n)) return '蛋类';
  if (/^蛋/.test(n) && n.length <= 4) return '蛋类';

  // 炒菜小炒
  if (/小炒|爆炒|清炒|干煸|回锅|鱼香|宫保|宫爆|麻婆|红烧|糖醋|锅包|溜肉|京酱/.test(n)) return '炒菜小炒';
  if (/水煮/.test(n) && /鱼|肉|牛|鸡|虾|片|全|素/.test(n)) return '炒菜小炒';
  if (/^剁椒|^辣子|^木须|^三杯|^椒麻|^椒盐|^双椒|^黑椒|^杭椒|^青花椒/.test(n)) return '炒菜小炒';
  if (/^蒜蓉|^蒜香|^香辣|^麻辣|^酸辣|^青椒|^尖椒|^辣椒/.test(n) && !/面|粉|饭|拌/.test(n)) return '炒菜小炒';
  if (/炒蛋|炒肉|炒鸡|炒虾|炒鱿|炒肝|炒腰|炒肚|炒时蔬|炒青菜|炒豆|炒茄|炒土豆|炒面皮|炒粉条|炒腊肉/.test(n)) return '炒菜小炒';
  if (/肉丝|肉片|肉丁|肉沫/.test(n) && !/面|粉|饭|饼/.test(n)) return '炒菜小炒';
  if (/^农家/.test(n) && !/包|饼|馍/.test(n)) return '炒菜小炒';
  if (/^台湾/.test(n) && !/包|饼|馍/.test(n)) return '炒菜小炒';
  if (/^韩式|^咖喱|^浓香|^绝味|^老干妈|^老北京/.test(n)) return '炒菜小炒';
  if (/滕州|酱香|火爆|秘制/.test(n)) return '炒菜小炒';
  if (/手撕/.test(n) && !/面|饼/.test(n)) return '炒菜小炒';
  if (/炝/.test(n) && /肉/.test(n)) return '炒菜小炒';
  if (/^熘|^葱爆|^酱爆/.test(n)) return '炒菜小炒';
  if (/肉卷|咕咾肉|肉段|扒肉/.test(n)) return '炒菜小炒';
  if (/腊肉|鲜笋|松仁|酸豆角|菜花/.test(n) && !/面|粉|饭/.test(n)) return '炒菜小炒';
  if (/西葫芦/.test(n)) return '炒菜小炒';
  if (/大头菜/.test(n) && /五花|肉/.test(n)) return '炒菜小炒';
  if (/护心肉|小炒肉/.test(n)) return '炒菜小炒';
  if (/孜然/.test(n) && /鸡|肉|鸭|羊/.test(n)) return '炒菜小炒';
  if (/木耳/.test(n) && /蛋|肉/.test(n)) return '炒菜小炒';
  if (/角瓜|瓠瓜/.test(n) && /鸡蛋/.test(n)) return '炒菜小炒';
  if (/麻麻鸡|麻麻肥牛|招牌.*鸡/.test(n)) return '炒菜小炒';
  if (/辣子鸡|可乐鸡|枣香可乐/.test(n)) return '炒菜小炒';
  if (/土豆烧牛肉|土豆鸡块/.test(n)) return '炒菜小炒';
  if (/大葱火腿|大葱.*蛋/.test(n)) return '炒菜小炒';
  if (/番茄捞汁/.test(n)) return '炒菜小炒';
  if (/香菇.*肉|青椒.*肉/.test(n)) return '炒菜小炒';
  if (/^鲜椒/.test(n) && /鸡|肉|鱼/.test(n)) return '炒菜小炒';

  // 炖菜煲类
  if (last === '煲') return '炖菜煲类';
  if (/炖|焖|红烧|煲|砂锅/.test(n) && /肉|鸡|鸭|鱼|牛|羊|排骨|豆腐|白菜|萝卜|肠|肘/.test(n)) return '炖菜煲类';
  if (/小锅|鸡公煲|公煲/.test(n)) return '炖菜煲类';
  if (/把子肉|毛血旺|大盘鸡/.test(n)) return '炖菜煲类';
  if (/^金汤/.test(n)) return '炖菜煲类';
  if (/瓦香/.test(n)) return '炖菜煲类';
  if (/^糯米/.test(n) && /排骨|鸡|肉/.test(n)) return '炖菜煲类';
  if (/^蒸/.test(n) && /鱼|虾|蟹|鸡|鸭|翅|排骨|肉|丸/.test(n)) return '炖菜煲类';
  if (/肥牛|龙眼丸子|冬瓜.*丸|排骨.*冬瓜|酸菜.*白肉|金针肥牛/.test(n)) return '炖菜煲类';
  if (/番茄浓汤/.test(n) && /鱼|肉|鸡/.test(n)) return '炖菜煲类';

  // 汤品炖品
  if (last === '汤') return '汤品炖品';
  if (/汤/.test(n) && /瓦罐|炖汤|老火|煲汤|排骨汤|鸡汤|老鸭汤|全家福|疙瘩|肚丝|大骨|拆骨|牛杂|牛肉|羊杂|猪肉|紫菜|胡辣|粉丝汤|鸡蛋汤|蛋花汤/.test(n) && !/饺|面|粉|饭/.test(n)) return '汤品炖品';
  if (/蒸蛋|炖蛋|水蒸蛋|蛋羹/.test(n)) return '汤品炖品';
  if (/^疙瘩|^热汤/.test(n)) return '汤品炖品';
  if (/鲜嫩肉汤/.test(n)) return '汤品炖品';

  // 豆腐/素菜
  if (/豆腐|豆皮|豆干|腐竹|豆泡|千张|干丝/.test(n)) return '豆腐素菜';
  if (/素菜|青菜|时蔬|蔬菜|白菜|空心菜|油麦菜|生菜|菠菜|韭菜|豆芽|茄子|土豆丝|番茄炒蛋|西红柿炒蛋|地三鲜/.test(n)) return '豆腐素菜';
  if (/^素炒|^时令|^清炒/.test(n) && !/面|饭/.test(n)) return '豆腐素菜';
  if (/^香菇|^杏鲍菇|^金针菇|^平菇/.test(n) && /炒|烧|炖|烩|油菜/.test(n)) return '豆腐素菜';
  if (/手抓/.test(n) && /菜|菇|笋/.test(n)) return '豆腐素菜';
  if (/木耳/.test(n) && /蛋|肉|炒/.test(n)) return '豆腐素菜';
  if (/培根/.test(n) && /菇|菜|笋/.test(n)) return '豆腐素菜';
  if (/^海米/.test(n)) return '豆腐素菜';
  if (/番茄/.test(n) && /蛋/.test(n) && !/面|粉|饭/.test(n) && n.length <= 6) return '豆腐素菜';
  if (/^蒸/.test(n) && /蔬菜|白菜|菜心|娃娃菜|土豆|茄子|南瓜|山药|红薯/.test(n)) return '豆腐素菜';
  if (/^蒜蓉/.test(n) && /西蓝|西兰|菜心|油麦|生菜|娃娃菜/.test(n)) return '豆腐素菜';
  if (/粉条/.test(n) && /炒|炖|烩/.test(n)) return '豆腐素菜';
  if (/^葱花摊鸡蛋|^西红柿鸡蛋$|^西红柿炒蛋/.test(n)) return '豆腐素菜';
  if (/香甜玉米粒|玉米粒/.test(n)) return '豆腐素菜';

  // 凉拌冷菜
  if (/凉拌|凉菜|拌菜|拍黄瓜|口水鸡|夫妻肺片|蒜泥/.test(n)) return '凉拌冷菜';
  if (/^捞汁|^擂椒|^爽口/.test(n)) return '凉拌冷菜';

  // 小吃零食
  if (/汤圆|糍粑|年糕|麻薯|麻团|驴打滚|粽子|荷叶糯米鸡/.test(n)) return '小吃零食';
  if (/^红糖/.test(n) && !/馒头|花卷|卷|包|饼|糕/.test(n)) return '小吃零食';
  if (/焖子/.test(n)) return '小吃零食';
  if (/^煮玉米|^煮花生|^煮毛豆/.test(n)) return '小吃零食';
  if (/^烤地瓜|^烤红薯|^地瓜|^红薯|^烤面筋/.test(n)) return '小吃零食';

  // 油炸小吃
  if (/炸|酥/.test(n) && /鸡|鱼|虾|肉|排|藕|茄|薯|芋|蘑菇|菌/.test(n) && !/面|粉|饭/.test(n)) return '炸物小吃';

  // 沙拉简餐
  if (/沙拉|轻食|三明治|三文治|全谷物碗|波奇碗|poke/i.test(n)) return '沙拉简餐';

  // 套餐/自选
  if (/套餐|组合|双拼|三拼|盒饭|便当|快餐/.test(n)) return '套餐自选';
  if (/自选/.test(n) && !/夹馍|饼|包|面|粉|饭/.test(n)) return '套餐自选';
  if (/称重|按重/.test(n)) return '套餐自选';

  // Stall context hints (last resort)
  if ((stallName || '').includes('拉面') || (stallName || '').includes('刀削面') || (stallName || '').includes('板面') || (stallName || '').includes('面馆') || (stallName || '').includes('面庄') || (stallName || '').includes('拌面')) return '面食';
  if ((stallName || '').includes('饺子') || (stallName || '').includes('水饺')) return '饺子';
  if ((stallName || '').includes('麻辣烫') || (stallName || '').includes('冒菜')) return '麻辣烫';
  if ((stallName || '').includes('肠粉')) return '粥粉';
  if ((stallName || '').includes('烧饼') || (stallName || '').includes('煎饼')) return '面点饼类';
  if (/粉$/.test(stallName || '') && !/面粉/.test(stallName || '')) return '面食';

  // 粉丝类 side dishes → 小吃零食
  if (/粉丝/.test(n) && /肉|虾|丸|菜|娃娃/.test(n)) return '小吃零食';

  // +米饭(面) combo items → 套餐自选
  if (/\+\s*米饭/.test(n)) return '套餐自选';

  // 火腿土豆片 → 炒菜
  if (/火腿土豆片/.test(n)) return '炒菜小炒';

  // 炒两掺 → 面食
  if (/炒两掺/.test(n)) return '面食';

  // 面条 → 面食
  if (/^面条$|^面$/.test(n)) return '面食';

  // Small/cheap fallback
  if (price <= 6 && /蛋|肠|串|丸/.test(n) && n.length <= 6 && !/鸡蛋|火腿|大葱|角瓜|炒/.test(n)) return '小吃零食';

  return '其他';
}

// --- Apply ---
const stalls = db.prepare('SELECT id, name, category FROM stalls').all();
const stallMap = {};
stalls.forEach(s => { stallMap[s.id] = { name: s.name, category: s.category }; });

const dishes = db.prepare('SELECT id, name, price, taste, stall_id, catalog_item_type, catalog_category FROM dishes').all();
const update = db.prepare('UPDATE dishes SET dish_type = ?, dish_category = ?, meal_period = ? WHERE id = ?');

let countMeal = 0, countSnack = 0, countDrink = 0, countAddon = 0;
const catCount = {};

for (const d of dishes) {
  const stall = stallMap[d.stall_id] || { name: '', category: '' };
  const dishType = classifyDishType(d.name, d.price, d.catalog_item_type, d.catalog_category, stall.name, d.stall_id);
  const dishCategory = classifyDishCategory(d.name, d.taste, d.price, stall.name, stall.category);
  const mealPeriod = '全天';
  update.run(dishType, dishCategory, mealPeriod, d.id);

  if (dishType === '餐食') countMeal++;
  else if (dishType === '小吃') countSnack++;
  else if (dishType === '饮品') countDrink++;
  else if (dishType === '加购') countAddon++;
  catCount[dishCategory] = (catCount[dishCategory] || 0) + 1;
}

console.log('=== Classification Complete ===');
console.log('Total dishes:', dishes.length);
console.log('\ndish_type:  餐食:', countMeal, '小吃:', countSnack, '饮品:', countDrink, '加购:', countAddon);
console.log('\ndish_category:');
for (const [cat, count] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + cat + ':', count);
}
console.log('\nmeal_period: 全天 for all dishes');
db.close();
