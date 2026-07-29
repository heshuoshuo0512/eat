ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS catalog_item_type TEXT NOT NULL DEFAULT 'meal';
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS parent_dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL;

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_status_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_status_check
  CHECK (status IN ('active', 'hidden', 'inactive', 'archived'));

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_catalog_item_type_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_catalog_item_type_check
  CHECK (catalog_item_type IN ('meal', 'beverage', 'addon', 'fee', 'variant'));

CREATE INDEX IF NOT EXISTS idx_dishes_tenant_item_type
  ON dishes(tenant_id, catalog_item_type, status, name);
CREATE INDEX IF NOT EXISTS idx_dishes_parent
  ON dishes(tenant_id, parent_dish_id);

UPDATE dishes
SET catalog_item_type = 'beverage', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND stall_id IN ('stall-2cb9f6f2e4b462', 'stall-d389b7d2f83a97');

UPDATE dishes
SET catalog_item_type = 'fee', reservation_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND name IN ('打包费', '汤类打包费');

UPDATE dishes
SET catalog_item_type = 'addon', reservation_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default'
  AND name IN ('加面', '加饭', '加料');

UPDATE dishes
SET name = '香辣烤鱼',
    price = 38,
    pricing_mode = 'variants',
    price_display = '38-66元',
    pricing_json = '{"mode":"variants","display":"38-66元","baseAmount":38,"baseQuantity":null,"unit":"份","minAmount":38,"maxAmount":66,"budgetComparable":true,"variants":[{"label":"2人份（≥1.5斤草鱼）","amount":38},{"label":"3-4人份（≥3斤草鱼）","amount":66}],"modifiers":[],"raw":"香辣烤鱼：2人份（≥1.5斤草鱼）38元；3-4人份（≥3斤草鱼）66元"}',
    aliases_json = '["香辣烤鱼2人份","香辣烤鱼3-4人份"]',
    semantic_labels_json = '["烤鱼","多人餐","蛋白质菜品"]',
    source_ref_json = '{"batchId":"real-catalog-campus-2026-07-27-v2","dataVersion":"campus-catalog-2026-07-27-v2","sources":[{"name":"东校区二楼.docx","sha256":"2c667fa8ea17961953277838e4cf7237deb2220e71a391d76dea731ab8df1a2c","locator":"paragraph:417","rawText":"香辣烤鱼"},{"name":"东校区二楼.docx","sha256":"2c667fa8ea17961953277838e4cf7237deb2220e71a391d76dea731ab8df1a2c","locator":"paragraph:418","rawText":"1. 2人份(≥1.5斤草鱼)‐38元"},{"name":"东校区二楼.docx","sha256":"2c667fa8ea17961953277838e4cf7237deb2220e71a391d76dea731ab8df1a2c","locator":"paragraph:419","rawText":"2. 3‐4人份(≥3斤草鱼)‐66元"}]}',
    description = '香辣烤鱼按人数和草鱼重量分为2人份与3-4人份两档；目录价格为38-66元，今日供应待确认。',
    catalog_item_type = 'meal',
    parent_dish_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-2a3b8d894013ac';

UPDATE dishes
SET status = 'inactive',
    reservation_enabled = FALSE,
    catalog_item_type = 'variant',
    parent_dish_id = 'dish-2a3b8d894013ac',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-58240b793c681e';

UPDATE dishes
SET name = '特色烤草鱼',
    price = 25,
    pricing_mode = 'variants',
    price_display = '25-55元',
    pricing_json = '{"mode":"variants","display":"25-55元","baseAmount":25,"baseQuantity":null,"unit":"份","minAmount":25,"maxAmount":55,"budgetComparable":true,"variants":[{"label":"1人份","amount":25},{"label":"2人份","amount":45},{"label":"3-4人份","amount":55}],"modifiers":[],"raw":"特色烤草鱼（米饭免费，4种配菜）：1人份25元；2人份45元；3-4人份55元"}',
    aliases_json = '["特色烤草鱼1人份","特色烤草鱼2人份","特色烤草鱼3-4人份"]',
    semantic_labels_json = '["烤鱼","多人餐","蛋白质菜品"]',
    source_ref_json = '{"batchId":"real-catalog-campus-2026-07-27-v2","dataVersion":"campus-catalog-2026-07-27-v2","sources":[{"name":"[只读]三楼西(2).docx","sha256":"ce52047284a077e064afe21db121be024fe5c593ad4d1ebd8605550795d3eba2","locator":"paragraph:245","rawText":"特色烤草鱼(米饭免费,4种配菜)"},{"name":"[只读]三楼西(2).docx","sha256":"ce52047284a077e064afe21db121be024fe5c593ad4d1ebd8605550795d3eba2","locator":"paragraph:246","rawText":"1. 1人份:25元"},{"name":"[只读]三楼西(2).docx","sha256":"ce52047284a077e064afe21db121be024fe5c593ad4d1ebd8605550795d3eba2","locator":"paragraph:247","rawText":"2. 2人份:45元"},{"name":"[只读]三楼西(2).docx","sha256":"ce52047284a077e064afe21db121be024fe5c593ad4d1ebd8605550795d3eba2","locator":"paragraph:248","rawText":"3. 3‐4人份:55元"}]}',
    description = '特色烤草鱼目录注明米饭免费并配4种配菜，按1人份、2人份和3-4人份计价；目录价格为25-55元，今日供应待确认。',
    catalog_item_type = 'meal',
    parent_dish_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'dish-004f9a66d69ddb';

-- These documents were built before catalog rows were separated. The worker
-- recreates the two renamed parent dishes; non-searchable rows stay absent.
DELETE FROM rag_documents
WHERE tenant_id = 'default'
  AND source_type = 'dish'
  AND source_id IN (
    SELECT id FROM dishes
    WHERE tenant_id = 'default'
      AND (
        catalog_item_type IN ('addon', 'fee', 'variant')
        OR id IN ('dish-2a3b8d894013ac', 'dish-004f9a66d69ddb')
      )
  );
