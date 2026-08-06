const SERVING_TIER_RE = /^(?:\d+\s*[-~至‐‑–—]\s*\d+|\d+|单|双|多)\s*人份(?:\s*[（(].*[）)])?$/u;
const FEE_RE = /(?:打包费|餐盒费|包装费|服务费|低消)$/u;
const SECTION_RE = /^(?:[一二三四五六七八九十百\d.]+元(?:以上|以下)?区|[一二三四五六七八九十百\d.]+元区|价格区|其他类|单价品类|以上套餐加|青菜类|纯素菜类|鸡肉花荤类|鸡鸭肉类|猪肉花荤类|猪肉主荤类|炒鸡蛋类)$/u;
const COMBO_RE = /套餐|组合|全家桶|双人餐|多人餐|[+＋]/u;
const TRAILING_ADDON_RE = /(?:加|[+＋])$/u;
const BEVERAGE_RE = /豆浆|豆奶|鲜奶|椰奶|杂粮汁|果蔬汁|果汁|玉米汁|山药汁|饮料|饮品|可乐|雪碧|芬达|奶茶|咖啡|酸奶|乳酸菌|养乐多|矿泉水|纯净水|苏打水|柠檬水|椰汁|酸梅汤|冰红茶|乌龙茶|绿茶|红茶|果茶|茶粹|脉动|今麦郎|康师傅系列|啤酒|汽水|旺仔/u;
const BEVERAGE_FOOD_EXCLUSION_RE = /可乐鸡|茶叶蛋|脆皮鲜奶|麻花|面包|粥|包|饼|饭|面|粉|鸡|肉|蛋|汉堡|堡/u;
const EXPLICIT_ADDON_RE = /^(?:单加|加(?:面|面饼|米线|饭|肉|鸡蛋|煎蛋|卤蛋|蛋|蛋花|肠|料|料单价|菜|粉|饼|豆腐|培根)|打卤|麻酱|蘸料|餐具)$/u;
const LOW_PRICE_COMPONENT_RE = /^(?:丸子|丸子类|.*丸|.*丸子|鱼丸|虾丸|牛肉丸|蟹棒|蟹排|鱼豆腐|鱼心卷|豆泡|豆皮|干豆腐(?:、豆干|丝|卷)?|豆腐卷|豆腐片|兰花干|炸豆腐|炸豆干|卤豆腐|卤油豆腐|豆花干|火腿|火腿肠|.*肠(?:[（(].*[）)])?|小油条|卤蛋(?:\/煎蛋)?|煎蛋|煎鸡蛋|荷包蛋|烤鸡蛋|鸡蛋|去皮鸡蛋|水煮鸡蛋|茶叶蛋|鸭蛋|鹌鹑蛋|炸蛋|午餐肉|培根|年糕|魔芋|海带|宽粉|粉丝|方便面|米饭|馍|面筋扣?|面藕|营养面|响铃卷|榨菜|金针菇|娃娃菜|小白菜|小青菜|青菜|生菜|尖椒|土豆|圆白菜|花生|玉米粒|肉松|海苔|甜不辣|王中王|鸡架|鸡脖|.*鸡爪.*|鸡腿|.*腿|鸡胸|鸡排|黑椒肉肠|红焖肉|火锅肉片|小酥肉|排骨|肉排|肉丝|里脊肉|狮子头|牛杂|肉卷)$/u;
const SNACK_RE = /^(?:.*(?:汉堡|鸡腿堡|牛肉堡)(?:\*\d+|[（(].*[）)])?|薯条|洋葱圈|鸡块|鸡米花|炸鸡米花|鸡柳|鸡翅|黄金鸡翅根|黄金鸡翅中|黄金炸鸡腿|炸鸡排|鸡排|奥尔良鸡排|脆炸鸡腿|中式炸翅根\*\d+|中式炸鸡腿\*\d+|中式炸肉|韩式炸鸡(?:大份|小份)?|脆皮炸鸡肉|炸肉|香炸肉|五香炸肉|风味炸蘑菇|小酥肉|烤肠|香肠|骨肉相连|蛋挞|热狗|辣条|脆皮鲜奶|圣代|甜筒|豆腐串)$/u;
const BEVERAGE_STALL_RE = /水之源|茶言茶语/u;
const ADDON_CONTEXT_STALL_RE = /面|粉|米线|馄饨|水饺|饺子|麻辣|香锅|冒菜|火锅|捞|粥香饭语|汤の饼相见|喜堂干饭|胡椒厨房|烤冷面|掉渣饼|家之味|燕鸣湖小份菜|鸡公煲|鸡排土豆泥|海南鸡饭/u;
const SNACK_CONTEXT_STALL_RE = /串吧|汉堡工坊|佰士客汉堡|燃能.*汉堡|鸭货/u;
const CONTEXT_VARIANT_RE = /^(?:原味|甜辣味|番茄味|沙拉味)$/u;
const CONTEXT_ADDON_RULES = Object.freeze([
  { stall: /掉渣饼/u, name: /^(?:烤鸡皮|虎皮椒|大鸡排)$/u, category: '面食加购' },
  { stall: /五谷渔粉面/u, name: /^(?:鱼肉|辣肉)$/u, category: '面食加购' },
  { stall: /长安畔.*牛肉米线/u, name: /^(?:肉汤卤尖椒|肉汤卤蛋|黄金大炸蛋|生烫吊龙牛肉)$/u, category: '面食加购' },
  { stall: /桂英嫂.*牛肉米线/u, name: /^(?:豌豆苗|鲜脆毛肚|鲜切牛肉)$/u, category: '面食加购' },
  { stall: /汤の饼相见/u, name: /^牛肉$/u, category: '佐餐加购' },
]);

export const CATALOG_CATEGORY_ORDER = Object.freeze({
  meal: Object.freeze(['早餐面点', '面食粉类', '米饭套餐', '家常热菜', '汤羹', '火锅麻辣烫', '汉堡套餐']),
  snack: Object.freeze(['汉堡小吃', '烧烤卤味小吃', '小吃单品', '甜品小吃']),
  beverage: Object.freeze(['饮品']),
});

export const RETIRED_MEAL_CATEGORIES = Object.freeze([
  '组合套餐', '干锅菜', '砂锅煲类', '水煮菜', '蒸菜', '轻食简餐', '精品小炒', '多人烤鱼', '烤鱼',
]);

function text(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function contextualAddon(name, stall) {
  return CONTEXT_ADDON_RULES.find((rule) => rule.stall.test(stall) && rule.name.test(name)) || null;
}

function snackCategory(name, stall) {
  if (/鲜奶|圣代|甜筒|蛋挞/u.test(name)) return '甜品小吃';
  if (/汉堡/u.test(stall) || /汉堡|堡/u.test(name)) return '汉堡小吃';
  if (/串吧|鸭货/u.test(stall)) return '烧烤卤味小吃';
  return '小吃单品';
}

function categoryResult(category, reason, itemType = 'meal') {
  return {
    itemType,
    category,
    independentlyOrderable: !['addon', 'fee', 'variant', 'section'].includes(itemType),
    reason,
  };
}

function classifyMealByContext(name, stall, reason = 'meal_context_category') {
  const normalizedName = text(name);
  const normalizedStall = text(stall);
  const combined = `${normalizedName} ${normalizedStall}`;

  if (/汉堡|堡|炸鸡/u.test(combined)) return categoryResult('汉堡套餐', reason);
  if (/水煮/u.test(normalizedName)) {
    if (/面|粉|米线|馄饨|水饺|饺子/u.test(normalizedStall)) return categoryResult('面食粉类', reason);
    return categoryResult('米饭套餐', reason);
  }
  if (/米饭|盖饭|黄焖鸡|鸡公煲|拌饭|便当|套餐饭/u.test(normalizedName)) return categoryResult('米饭套餐', reason);
  if (/面|粉|米线|河粉|板面|刀削|馄饨|水饺|饺子|方便面|油泼/u.test(normalizedName)) return categoryResult('面食粉类', reason);
  if (/豆浆|油条|粥|包子|馒头|烧麦|烧饼|饼|豆腐脑|锅贴|盒子|粽子|夹馍|汤圆|早餐|三明治|卷饼/u.test(normalizedName)) {
    return categoryResult('早餐面点', reason);
  }
  if (/小炒盖饭|海南鸡饭|盖饭|黄焖鸡|鸡公煲|拌饭|快餐|拼饭/u.test(normalizedStall)) return categoryResult('米饭套餐', reason);
  if (/面|粉|米线|馄饨|水饺|饺子|木桶面|手擀面|土豆粉/u.test(normalizedStall)) return categoryResult('面食粉类', reason);
  if (/粥|饼|早餐|烧饼|豆浆|油条|面点/u.test(normalizedStall)) return categoryResult('早餐面点', reason);
  return categoryResult('家常热菜', reason);
}

export function isServingTierCatalogName(value) {
  return SERVING_TIER_RE.test(text(value));
}

export function classifyCatalogItem({ name = '', price = 0, stallName = '', currentType = 'meal' } = {}) {
  const normalizedName = text(name);
  const normalizedStall = text(stallName);
  const amount = Number(price);

  if (isServingTierCatalogName(normalizedName)) {
    return { itemType: 'variant', category: '规格选项', independentlyOrderable: false, reason: 'serving_tier' };
  }
  if (FEE_RE.test(normalizedName)) {
    return { itemType: 'fee', category: '费用', independentlyOrderable: false, reason: 'fee' };
  }
  if (SECTION_RE.test(normalizedName)) {
    return { itemType: 'section', category: '目录分组', independentlyOrderable: false, reason: 'section_heading' };
  }
  if (TRAILING_ADDON_RE.test(normalizedName)) {
    return { itemType: 'addon', category: '加购项', independentlyOrderable: false, reason: 'trailing_addon' };
  }
  if (CONTEXT_VARIANT_RE.test(normalizedName) && /掉渣饼/u.test(normalizedStall)) {
    return { itemType: 'variant', category: '口味选项', independentlyOrderable: false, reason: 'context_variant' };
  }
  if (/^(?:肥瘦|纯瘦)$/u.test(normalizedName) && /西安名吃/u.test(normalizedStall)) {
    return { itemType: 'variant', category: '规格选项', independentlyOrderable: false, reason: 'context_variant' };
  }
  if (COMBO_RE.test(normalizedName) || /^T\d+[（(]/iu.test(normalizedName)) {
    return classifyMealByContext(normalizedName, normalizedStall, 'complete_combo_context');
  }
  if (BEVERAGE_STALL_RE.test(normalizedStall)
      || (BEVERAGE_RE.test(normalizedName) && !BEVERAGE_FOOD_EXCLUSION_RE.test(normalizedName))) {
    return { itemType: 'beverage', category: '饮品', independentlyOrderable: true, reason: 'beverage_name' };
  }
  if (EXPLICIT_ADDON_RE.test(normalizedName)) {
    return { itemType: 'addon', category: '加购项', independentlyOrderable: false, reason: 'explicit_addon' };
  }
  const matchedContextAddon = contextualAddon(normalizedName, normalizedStall);
  if (matchedContextAddon) {
    return { itemType: 'addon', category: matchedContextAddon.category, independentlyOrderable: false, reason: 'context_addon' };
  }
  if (LOW_PRICE_COMPONENT_RE.test(normalizedName) && Number.isFinite(amount) && amount <= (ADDON_CONTEXT_STALL_RE.test(normalizedStall) ? 7 : 5)
      && (/丸|卤蛋|煎蛋|荷包蛋|烤鸡蛋|鸡蛋|茶叶蛋|鸭蛋|米饭/u.test(normalizedName) || ADDON_CONTEXT_STALL_RE.test(normalizedStall))) {
    const category = /丸|蟹棒|蟹排|鱼豆腐|豆泡|豆皮|午餐肉|年糕|魔芋|海带|宽粉|粉丝/u.test(normalizedName)
      ? '火锅配菜'
      : /面|板面|馄饨|粉|米线/u.test(normalizedStall)
        ? '面食加购'
        : '佐餐加购';
    return { itemType: 'addon', category, independentlyOrderable: false, reason: 'low_price_component' };
  }
  if (SNACK_RE.test(normalizedName)) {
    return { itemType: 'snack', category: snackCategory(normalizedName, normalizedStall), independentlyOrderable: true, reason: 'standalone_snack' };
  }
  if (/沙拉|轻食/u.test(normalizedName)) {
    return categoryResult('小吃单品', 'light_food_snack', 'snack');
  }
  if (SNACK_CONTEXT_STALL_RE.test(normalizedStall)) {
    return { itemType: 'snack', category: snackCategory(normalizedName, normalizedStall), independentlyOrderable: true, reason: 'snack_stall' };
  }
  if (/香锅|麻辣烫/u.test(normalizedStall) && /^冒/u.test(normalizedName)) return { itemType: 'meal', category: '火锅麻辣烫', independentlyOrderable: true, reason: 'stall_meal_category' };
  if (/小炒盖饭|海南鸡饭/u.test(normalizedStall)) return { itemType: 'meal', category: '米饭套餐', independentlyOrderable: true, reason: 'stall_meal_category' };
  if (/青年盖饭干锅/u.test(normalizedStall)) {
    return classifyMealByContext(normalizedName, normalizedStall, 'stall_meal_context');
  }
  if (/手工水饺/u.test(normalizedStall) && /^(?:大葱香菜肉|白菜莲藕肉|芹菜香菇肉|酸菜油梭肉|茴香鸡蛋肉|猪肉玉米)$/u.test(normalizedName)) {
    return { itemType: 'meal', category: '面食粉类', independentlyOrderable: true, reason: 'stall_meal_category' };
  }
  if (/肉灌饼/u.test(normalizedStall) && /款$/u.test(normalizedName)) return { itemType: 'meal', category: '早餐面点', independentlyOrderable: true, reason: 'stall_meal_category' };
  if (/燕鸣湖小份菜/u.test(normalizedStall) && /卷$/u.test(normalizedName)) return { itemType: 'meal', category: '早餐面点', independentlyOrderable: true, reason: 'stall_meal_category' };
  if (/麻辣烫|麻辣香锅|火锅|冒菜|串串/u.test(normalizedName)) return { itemType: 'meal', category: '火锅麻辣烫', independentlyOrderable: true, reason: 'meal_category' };
  if (/面|粉|米线|河粉|板面|刀削|馄饨|水饺|饺子|蒸饺/u.test(normalizedName)) return { itemType: 'meal', category: '面食粉类', independentlyOrderable: true, reason: 'meal_category' };
  if (/饭|便当/u.test(normalizedName)) return { itemType: 'meal', category: '米饭套餐', independentlyOrderable: true, reason: 'meal_category' };
  if (/包|馒头|烧麦|粥|饼|油条|豆腐脑|锅贴|盒子|粽子|夹馍|汤圆|烤地瓜/u.test(normalizedName)) return { itemType: 'meal', category: '早餐面点', independentlyOrderable: true, reason: 'meal_category' };
  if (/汤|羹/u.test(normalizedName)) return { itemType: 'meal', category: '汤羹', independentlyOrderable: true, reason: 'meal_category' };
  if (/干锅|砂锅|煲|水煮/u.test(normalizedName)) return classifyMealByContext(normalizedName, normalizedStall);
  if (/蒸/u.test(normalizedName)) return categoryResult('家常热菜', 'steamed_to_house_dish');
  if (/三明治|卷饼/u.test(normalizedName)) return categoryResult('早餐面点', 'light_food_breakfast');
  if (/烤鱼/u.test(normalizedName)) return classifyMealByContext(normalizedName, normalizedStall, 'grilled_fish_context');

  const preservedType = ['meal', 'beverage', 'snack', 'addon', 'fee', 'variant', 'section'].includes(currentType) ? currentType : 'meal';
  const fallbackCategory = preservedType === 'beverage' ? '饮品' : preservedType === 'snack' ? '小吃单品' : '家常热菜';
  return { itemType: preservedType, category: fallbackCategory, independentlyOrderable: !['addon', 'fee', 'variant', 'section'].includes(preservedType), reason: 'fallback' };
}

export const catalogClassificationPatterns = Object.freeze({
  servingTier: SERVING_TIER_RE,
  fee: FEE_RE,
  section: SECTION_RE,
  combo: COMBO_RE,
  trailingAddon: TRAILING_ADDON_RE,
  beverage: BEVERAGE_RE,
  explicitAddon: EXPLICIT_ADDON_RE,
  lowPriceComponent: LOW_PRICE_COMPONENT_RE,
  snack: SNACK_RE,
});
