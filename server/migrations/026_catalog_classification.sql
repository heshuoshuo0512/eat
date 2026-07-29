ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS catalog_category TEXT NOT NULL DEFAULT '其他餐食';

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_catalog_item_type_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_catalog_item_type_check
  CHECK (catalog_item_type IN ('meal', 'beverage', 'snack', 'addon', 'fee', 'variant', 'section'));

CREATE INDEX IF NOT EXISTS idx_dishes_tenant_catalog_category
  ON dishes(tenant_id, catalog_item_type, catalog_category, status, name);

-- Rebuild the classification from stable catalog evidence. Existing merged
-- variants retain their parent links and inactive status.
UPDATE dishes
SET catalog_item_type = 'meal',
    catalog_category = '其他餐食',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND NOT (catalog_item_type = 'variant' AND parent_dish_id IS NOT NULL);

UPDATE dishes
SET catalog_item_type = 'fee',
    catalog_category = '费用',
    reservation_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND name ~ '(打包费|餐盒费|包装费|服务费|低消)$';

UPDATE dishes
SET catalog_item_type = 'section',
    catalog_category = '目录分组',
    status = 'inactive',
    reservation_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND name ~ '^([一二三四五六七八九十百0-9.]+元(以上|以下)?区|[一二三四五六七八九十百0-9.]+元区|价格区|其他类|单价品类|以上套餐加|青菜类|纯素菜类|鸡肉花荤类|鸡鸭肉类|猪肉花荤类|猪肉主荤类|炒鸡蛋类)$';

UPDATE dishes
SET catalog_item_type = 'meal',
    catalog_category = CASE WHEN name ~ '(汉堡|堡|炸鸡)' THEN '汉堡套餐' ELSE '组合套餐' END,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND status = 'active'
  AND name !~ '(加|\+|＋)$'
  AND (name ~ '(套餐|组合|全家桶|双人餐|多人餐|\+|＋)' OR name ~ '^T[0-9]+[（(]');

UPDATE dishes
SET catalog_item_type = 'snack',
    catalog_category = CASE
      WHEN name ~ '(汉堡|堡)' THEN '汉堡小吃'
      WHEN name ~ '(鲜奶|圣代|甜筒|蛋挞)' THEN '甜品小吃'
      ELSE '小吃单品'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND status = 'active'
  AND name !~ '(套餐|组合|全家桶|双人餐|多人餐|\+|＋)'
  AND name ~ '^(.*(汉堡|鸡腿堡|牛肉堡)(\*[0-9]+|[（(].*[）)])?|薯条|洋葱圈|鸡块|鸡米花|鸡翅|黄金鸡翅根|黄金鸡翅中|黄金炸鸡腿|炸鸡排|脆炸鸡腿|中式炸翅根\*[0-9]+|中式炸鸡腿\*[0-9]+|中式炸肉|韩式炸鸡(大份|小份)?|脆皮炸鸡肉|炸肉|香炸肉|五香炸肉|烤肠|香肠|骨肉相连|蛋挞|热狗|脆皮鲜奶|圣代|甜筒|豆腐串)$';

UPDATE dishes d
SET catalog_item_type = 'beverage',
    catalog_category = '饮品',
    updated_at = CURRENT_TIMESTAMP
FROM stalls s
WHERE d.tenant_id = 'default'
  AND s.tenant_id = d.tenant_id
  AND s.id = d.stall_id
  AND d.status = 'active'
  AND d.catalog_item_type = 'meal'
  AND d.name !~ '(套餐|组合|全家桶|双人餐|多人餐|\+|＋)'
  AND d.name !~ '^T[0-9]+[（(]'
  AND (
    s.name ~ '(水之源|茶言茶语)'
    OR (
      d.name ~ '(豆浆|豆奶|鲜奶|椰奶|杂粮汁|果蔬汁|果汁|玉米汁|山药汁|饮料|饮品|可乐|雪碧|芬达|奶茶|咖啡|酸奶|乳酸菌|养乐多|矿泉水|纯净水|苏打水|柠檬水|椰汁|酸梅汤|冰红茶|乌龙茶|绿茶|红茶|果茶|茶粹|脉动|今麦郎|康师傅系列|啤酒|汽水|旺仔)'
      AND d.name !~ '(可乐鸡|茶叶蛋|麻花|面包|粥|包|饼|饭|面|粉|鸡|肉|蛋|汉堡|堡)'
    )
  );

UPDATE dishes
SET catalog_item_type = 'addon',
    catalog_category = '加购项',
    reservation_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND status = 'active'
  AND name ~ '^(单加|加(面|面饼|米线|饭|肉|鸡蛋|煎蛋|卤蛋|蛋|蛋花|肠|料|料单价|菜|粉|饼|豆腐|培根)|打卤|麻酱|蘸料|餐具)$|(.+加)$|(.+[+＋])$';

UPDATE dishes d
SET catalog_item_type = 'addon',
    catalog_category = CASE
      WHEN d.name ~ '(丸|蟹棒|蟹排|鱼豆腐|豆泡|豆皮|午餐肉|年糕|魔芋|海带|宽粉|粉丝)' THEN '火锅配菜'
      WHEN s.name ~ '(面|板面|馄饨|粉|米线)' THEN '面食加购'
      ELSE '佐餐加购'
    END,
    reservation_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
FROM stalls s
WHERE d.tenant_id = 'default'
  AND s.tenant_id = d.tenant_id
  AND s.id = d.stall_id
  AND d.status = 'active'
  AND d.catalog_item_type IN ('meal', 'snack')
  AND d.name !~ '(套餐|组合|全家桶|双人餐|多人餐|\+|＋)'
  AND d.price <= CASE WHEN s.name ~ '(面|粉|米线|馄饨|水饺|饺子|麻辣|香锅|冒菜|火锅|捞|粥香饭语|汤の饼相见|喜堂干饭|胡椒厨房|烤冷面|掉渣饼|家之味|燕鸣湖小份菜|鸡公煲|鸡排土豆泥|海南鸡饭)' THEN 7 ELSE 5 END
  AND (
    d.name ~ '(丸|卤蛋|煎蛋|荷包蛋|烤鸡蛋|鸡蛋|茶叶蛋|鸭蛋|米饭)'
    OR s.name ~ '(面|粉|米线|馄饨|水饺|饺子|麻辣|香锅|冒菜|火锅|捞|粥香饭语|汤の饼相见|喜堂干饭|胡椒厨房|烤冷面|掉渣饼|家之味|燕鸣湖小份菜|鸡公煲|鸡排土豆泥|海南鸡饭)'
  )
  AND d.name ~ '^(丸子|丸子类|.*丸|.*丸子|鱼丸|虾丸|牛肉丸|蟹棒|蟹排|鱼豆腐|鱼心卷|豆泡|豆皮|干豆腐(、豆干|丝|卷)?|豆腐卷|豆腐片|兰花干|炸豆腐|炸豆干|卤豆腐|卤油豆腐|豆花干|火腿|火腿肠|.*肠(（.*）|\(.*\))?|小油条|卤蛋(/煎蛋)?|煎蛋|煎鸡蛋|荷包蛋|烤鸡蛋|鸡蛋|去皮鸡蛋|水煮鸡蛋|茶叶蛋|鸭蛋|鹌鹑蛋|炸蛋|午餐肉|培根|年糕|魔芋|海带|宽粉|粉丝|方便面|米饭|馍|面筋扣?|面藕|营养面|响铃卷|榨菜|金针菇|娃娃菜|小白菜|小青菜|青菜|生菜|尖椒|土豆|圆白菜|花生|玉米粒|肉松|海苔|甜不辣|王中王|鸡架|鸡脖|.*鸡爪.*|鸡腿|.*腿|鸡胸|鸡排|黑椒肉肠|红焖肉|火锅肉片|小酥肉|排骨|肉排|肉丝|里脊肉|狮子头|牛杂|肉卷)$';

UPDATE dishes d
SET catalog_item_type = 'addon',
    catalog_category = CASE
      WHEN s.name ~ '汤の饼相见' THEN '佐餐加购'
      ELSE '面食加购'
    END,
    reservation_enabled = FALSE,
    updated_at = CURRENT_TIMESTAMP
FROM stalls s
WHERE d.tenant_id = 'default'
  AND s.tenant_id = d.tenant_id
  AND s.id = d.stall_id
  AND d.status = 'active'
  AND (
    (s.name ~ '掉渣饼' AND d.name ~ '^(烤鸡皮|虎皮椒|大鸡排)$')
    OR (s.name ~ '五谷渔粉面' AND d.name ~ '^(鱼肉|辣肉)$')
    OR (s.name ~ '长安畔.*牛肉米线' AND d.name ~ '^(肉汤卤尖椒|肉汤卤蛋|黄金大炸蛋|生烫吊龙牛肉)$')
    OR (s.name ~ '桂英嫂.*牛肉米线' AND d.name ~ '^(豌豆苗|鲜脆毛肚|鲜切牛肉)$')
    OR (s.name ~ '汤の饼相见' AND d.name = '牛肉')
  );

UPDATE dishes d
SET catalog_item_type = 'snack',
    catalog_category = CASE WHEN s.name ~ '汉堡' THEN '汉堡小吃' ELSE '烧烤卤味小吃' END,
    updated_at = CURRENT_TIMESTAMP
FROM stalls s
WHERE d.tenant_id = 'default'
  AND s.tenant_id = d.tenant_id
  AND s.id = d.stall_id
  AND d.status = 'active'
  AND d.catalog_item_type = 'meal'
  AND d.name !~ '(套餐|组合|全家桶|双人餐|多人餐|\+|＋)'
  AND d.name !~ '^T[0-9]+[（(]'
  AND (
    s.name ~ '(串吧|汉堡工坊|佰士客汉堡|燃能.*汉堡|鸭货)'
    OR d.name ~ '^(.*(汉堡|鸡腿堡|牛肉堡)(\*[0-9]+|（.*）|\(.*\))?|薯条|洋葱圈|鸡块|鸡米花|炸鸡米花|鸡柳|鸡翅|黄金鸡翅根|黄金鸡翅中|黄金炸鸡腿|炸鸡排|鸡排|奥尔良鸡排|脆炸鸡腿|中式炸翅根\*[0-9]+|中式炸鸡腿\*[0-9]+|中式炸肉|韩式炸鸡(大份|小份)?|脆皮炸鸡肉|炸肉|香炸肉|五香炸肉|风味炸蘑菇|小酥肉|烤肠|香肠|骨肉相连|蛋挞|热狗|辣条|脆皮鲜奶|圣代|甜筒|豆腐串)$'
  );

UPDATE dishes d
SET catalog_category = CASE
      WHEN d.name ~ '(鲜奶|圣代|甜筒|蛋挞)' THEN '甜品小吃'
      WHEN s.name ~ '汉堡' OR d.name ~ '(汉堡|堡)' THEN '汉堡小吃'
      WHEN s.name ~ '(串吧|鸭货)' THEN '烧烤卤味小吃'
      ELSE '小吃单品'
    END,
    updated_at = CURRENT_TIMESTAMP
FROM stalls s
WHERE d.tenant_id = 'default'
  AND s.tenant_id = d.tenant_id
  AND s.id = d.stall_id
  AND d.catalog_item_type = 'snack';

UPDATE dishes d
SET catalog_category = CASE
      WHEN s.name ~ '(小炒盖饭|海南鸡饭)' THEN '米饭套餐'
      WHEN s.name ~ '青年盖饭干锅' AND d.name ~ '烤.*鱼' THEN '烤鱼'
      WHEN s.name ~ '青年盖饭干锅' AND d.name ~ '干锅' THEN '干锅菜'
      WHEN s.name ~ '青年盖饭干锅' THEN '米饭套餐'
      WHEN s.name ~ '香锅|麻辣烫' AND d.name ~ '^冒' THEN '火锅麻辣烫'
      WHEN s.name ~ '手工水饺' AND d.name ~ '^(大葱香菜肉|白菜莲藕肉|芹菜香菇肉|酸菜油梭肉|茴香鸡蛋肉|猪肉玉米)$' THEN '面食粉类'
      WHEN s.name ~ '肉灌饼' AND d.name ~ '款$' THEN '早餐面点'
      WHEN s.name ~ '燕鸣湖小份菜' AND d.name ~ '卷$' THEN '早餐面点'
      WHEN d.name ~ '(麻辣烫|麻辣香锅|火锅|冒菜|串串)' THEN '火锅麻辣烫'
      WHEN d.name ~ '(面|粉|米线|河粉|板面|刀削|馄饨|水饺|饺子|蒸饺)' THEN '面食粉类'
      WHEN d.name ~ '(饭|便当)' THEN '米饭套餐'
      WHEN d.name ~ '(包|馒头|烧麦|粥|饼|油条|豆腐脑|锅贴|盒子|粽子|夹馍|汤圆|烤地瓜)' THEN '早餐面点'
      WHEN d.name ~ '(汤|羹)' THEN '汤羹'
      WHEN d.name ~ '干锅' THEN '干锅菜'
      WHEN d.name ~ '(砂锅|煲)' THEN '砂锅煲类'
      WHEN d.name ~ '水煮' THEN '水煮菜'
      WHEN d.name ~ '蒸' THEN '蒸菜'
      WHEN d.name ~ '(沙拉|三明治|谷物)' THEN '轻食简餐'
      WHEN d.name ~ '烤鱼' THEN '烤鱼'
      ELSE '家常热菜'
    END,
    updated_at = CURRENT_TIMESTAMP
FROM stalls s
WHERE d.tenant_id = 'default'
  AND s.tenant_id = d.tenant_id
  AND s.id = d.stall_id
  AND d.status = 'active'
  AND d.catalog_item_type = 'meal'
  AND d.catalog_category = '其他餐食';

UPDATE dishes
SET catalog_category = '规格选项', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND catalog_item_type = 'variant';

-- Merge source rows that are price/flavour variants rather than independent
-- products. The retained parent keeps every literal source price.
UPDATE dishes
SET name = '掉渣饼', price = 3, pricing_mode = 'variants', price_display = '3-3.5元',
    pricing_json = '{"mode":"variants","display":"3-3.5元","baseAmount":3,"baseQuantity":null,"unit":"份","minAmount":3,"maxAmount":3.5,"budgetComparable":true,"variants":[{"label":"原味","amount":3},{"label":"甜辣味","amount":3.5},{"label":"番茄味","amount":3.5},{"label":"沙拉味","amount":3.5}],"modifiers":[],"raw":"基础饼：原味3元、甜辣味3.5元、番茄味3.5元、沙拉味3.5元"}',
    aliases_json = '["原味掉渣饼","甜辣味掉渣饼","番茄味掉渣饼","沙拉味掉渣饼"]',
    catalog_item_type = 'meal', catalog_category = '早餐面点', parent_dish_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-073fc872e79d15';

UPDATE dishes
SET catalog_item_type = 'variant', catalog_category = '口味选项', status = 'inactive',
    reservation_enabled = FALSE, parent_dish_id = 'dish-073fc872e79d15', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id IN ('dish-582691e425982f','dish-b575b67cf0e600','dish-f3121b9a50cc1f');

UPDATE dishes
SET pricing_mode = 'variants', price_display = '5-7元',
    pricing_json = '{"mode":"variants","display":"5-7元","baseAmount":5,"baseQuantity":null,"unit":"份","minAmount":5,"maxAmount":7,"budgetComparable":true,"variants":[{"label":"孜然青椒肉丝夹馍","amount":5},{"label":"肥瘦","amount":6},{"label":"纯瘦","amount":7}],"modifiers":[],"raw":"孜然青椒肉丝夹馍5元；肥瘦6元；纯瘦7元"}',
    aliases_json = '["肥瘦夹馍","纯瘦夹馍"]', catalog_item_type = 'meal',
    catalog_category = '早餐面点', parent_dish_id = NULL, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-d6f246046bba03';

UPDATE dishes
SET catalog_item_type = 'variant', catalog_category = '规格选项', status = 'inactive',
    reservation_enabled = FALSE, parent_dish_id = 'dish-d6f246046bba03', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id IN ('dish-414406b0c9d094','dish-83242f9587bf85');

UPDATE dishes
SET pricing_mode = 'variants', price_display = '18-45元',
    pricing_json = '{"mode":"variants","display":"18-45元","baseAmount":18,"baseQuantity":null,"unit":"份","minAmount":18,"maxAmount":45,"budgetComparable":true,"variants":[{"label":"单人份","amount":18},{"label":"双人份","amount":32},{"label":"3-4人份","amount":45}],"modifiers":[],"raw":"烤里鱼：单人份18元；双人份32元；3-4人份45元"}',
    catalog_category = '多人烤鱼', parent_dish_id = NULL, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-5ecbe4de67fb30';

UPDATE dishes
SET catalog_item_type = 'variant', catalog_category = '规格选项', status = 'inactive',
    reservation_enabled = FALSE, parent_dish_id = 'dish-5ecbe4de67fb30', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id IN ('dish-4638b8e96ea9ee','dish-046c8ea6442415');

UPDATE dishes
SET pricing_mode = 'variants', price_display = '22-52元',
    pricing_json = '{"mode":"variants","display":"22-52元","baseAmount":22,"baseQuantity":null,"unit":"份","minAmount":22,"maxAmount":52,"budgetComparable":true,"variants":[{"label":"单人份","amount":22},{"label":"双人份","amount":38},{"label":"3-4人份","amount":52}],"modifiers":[],"raw":"烤草鱼：单人份22元；双人份38元；3-4人份52元"}',
    catalog_category = '多人烤鱼', parent_dish_id = NULL, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-01afb12a5e7142';

UPDATE dishes
SET catalog_item_type = 'variant', catalog_category = '规格选项', status = 'inactive',
    reservation_enabled = FALSE, parent_dish_id = 'dish-01afb12a5e7142', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id IN ('dish-ffb63a7f6fe979','dish-39289497c6ad66');

UPDATE dishes
SET name = '红烧大排面', catalog_category = '面食粉类', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-ba91190defb150';

UPDATE dishes
SET catalog_item_type = 'variant', catalog_category = '重复源记录', status = 'inactive',
    reservation_enabled = FALSE, parent_dish_id = 'dish-ba91190defb150', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-b43ac7746192af';

UPDATE dishes SET name = '香辣大排面', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-227006a11272f3';

UPDATE dishes
SET name = '番茄肉酱面', aliases_json = '[". 番茄肉酱面"]',
    catalog_category = '面食粉类', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-19a612019d757f';

UPDATE dishes
SET name = CASE id
      WHEN 'dish-876fb4fad966c5' THEN '溜肉段盖饭'
      WHEN 'dish-5183df9c183acc' THEN '土豆烧牛肉盖饭'
      WHEN 'dish-9a5d024dc6cb1f' THEN '尖椒护心肉盖饭'
      WHEN 'dish-7f2557b0691a71' THEN '蒜苔炒腊肉盖饭'
      WHEN 'dish-844df2f52c2e7e' THEN '孜然肉卷盖饭'
      WHEN 'dish-de6f056c55d012' THEN '菠萝咕咾肉盖饭'
    END,
    catalog_category = '米饭套餐', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND id IN ('dish-876fb4fad966c5','dish-5183df9c183acc','dish-9a5d024dc6cb1f','dish-7f2557b0691a71','dish-844df2f52c2e7e','dish-de6f056c55d012');

UPDATE dishes SET catalog_category = '精品小炒', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND id IN ('dish-5b2b23caa605a3','dish-818f41795f5b1f','dish-b102fcbd65fe1e','dish-44dfe8262552cc','dish-03c56260d1f721','dish-4020b18b0682c3');

-- Restore context that the source parser removed while separating prices.
UPDATE dishes
SET name = CASE id
      WHEN 'dish-51d49f3fc7888c' THEN '米线 / 酸辣粉 / 担担面'
      WHEN 'dish-b103b6708ede89' THEN '烤肉饭'
      WHEN 'dish-df2a6eb7ad52f8' THEN '热卤双拼拌饭'
    END,
    aliases_json = CASE id
      WHEN 'dish-51d49f3fc7888c' THEN '["米线 / 酸辣粉 / 担担面(统一售价"]'
      WHEN 'dish-b103b6708ede89' THEN '["烤肉饭(均"]'
      WHEN 'dish-df2a6eb7ad52f8' THEN '["热卤拌饭系列(任意双拼"]'
    END,
    catalog_category = CASE WHEN id = 'dish-51d49f3fc7888c' THEN '面食粉类' ELSE '米饭套餐' END,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND id IN ('dish-51d49f3fc7888c','dish-b103b6708ede89','dish-df2a6eb7ad52f8');

UPDATE dishes
SET name = CASE id
      WHEN 'dish-cf56cdaca411dd' THEN '标配肉灌饼'
      WHEN 'dish-6b54cb5badc7bb' THEN '腊肠肉灌饼'
      WHEN 'dish-3c5a994f172082' THEN '哈尔滨红肠肉灌饼'
      WHEN 'dish-de8cd6fbfa8ffc' THEN '煎蛋肉灌饼'
      WHEN 'dish-cb0fb66eefdfe7' THEN '烤鸡肉灌饼'
      WHEN 'dish-b139d1e15e960f' THEN '五花肉肉灌饼'
    END,
    aliases_json = CASE id
      WHEN 'dish-cf56cdaca411dd' THEN '["标配款"]'
      WHEN 'dish-6b54cb5badc7bb' THEN '["腊肠款"]'
      WHEN 'dish-3c5a994f172082' THEN '["哈尔滨红肠款"]'
      WHEN 'dish-de8cd6fbfa8ffc' THEN '["煎蛋款"]'
      WHEN 'dish-cb0fb66eefdfe7' THEN '["烤鸡款"]'
      WHEN 'dish-b139d1e15e960f' THEN '["五花肉款"]'
    END,
    catalog_category = '早餐面点',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND id IN ('dish-cf56cdaca411dd','dish-6b54cb5badc7bb','dish-3c5a994f172082','dish-de8cd6fbfa8ffc','dish-cb0fb66eefdfe7','dish-b139d1e15e960f');

UPDATE dishes
SET name = CASE id
      WHEN 'dish-8edd937fae6983' THEN '大葱香菜肉水饺'
      WHEN 'dish-45118797df34e4' THEN '白菜莲藕肉水饺'
      WHEN 'dish-1f691cf74b0431' THEN '芹菜香菇肉水饺'
      WHEN 'dish-8869f6c0466006' THEN '酸菜油梭肉水饺'
      WHEN 'dish-4b4f88c9861fb9' THEN '茴香鸡蛋肉水饺'
      WHEN 'dish-f62e6f07111ef1' THEN '猪肉玉米水饺'
    END,
    aliases_json = CASE id
      WHEN 'dish-8edd937fae6983' THEN '["大葱香菜肉"]'
      WHEN 'dish-45118797df34e4' THEN '["白菜莲藕肉"]'
      WHEN 'dish-1f691cf74b0431' THEN '["芹菜香菇肉"]'
      WHEN 'dish-8869f6c0466006' THEN '["酸菜油梭肉"]'
      WHEN 'dish-4b4f88c9861fb9' THEN '["茴香鸡蛋肉"]'
      WHEN 'dish-f62e6f07111ef1' THEN '["猪肉玉米"]'
    END,
    catalog_category = '面食粉类',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND id IN ('dish-8edd937fae6983','dish-45118797df34e4','dish-1f691cf74b0431','dish-8869f6c0466006','dish-4b4f88c9861fb9','dish-f62e6f07111ef1');

DELETE FROM rag_documents
WHERE tenant_id = 'default'
  AND source_type = 'dish'
  AND source_id IN (
    SELECT id FROM dishes
    WHERE tenant_id = 'default'
      AND catalog_item_type IN ('addon', 'fee', 'variant', 'section')
  );
