-- Targeted catalog corrections requested on 2026-08-08.
-- This migration changes only six stable dish IDs and does not import or delete dishes.

CREATE TABLE IF NOT EXISTS catalog_classification_audits (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  dish_id TEXT NOT NULL,
  before_item_type TEXT NOT NULL,
  before_category TEXT NOT NULL,
  after_item_type TEXT NOT NULL,
  after_category TEXT NOT NULL,
  rule TEXT NOT NULL,
  stall_name TEXT NOT NULL DEFAULT '',
  price NUMERIC,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, batch_id, dish_id)
);

CREATE TEMP TABLE catalog_category_033_proposed (
  dish_id TEXT PRIMARY KEY,
  expected_name TEXT NOT NULL,
  after_item_type TEXT NOT NULL,
  after_category TEXT NOT NULL,
  rule TEXT NOT NULL,
  evidence_json JSONB NOT NULL
) ON COMMIT DROP;

INSERT INTO catalog_category_033_proposed
  (dish_id, expected_name, after_item_type, after_category, rule, evidence_json)
VALUES
  ('dish-ac282f05b7c41f', '蒜蓉粉丝娃娃菜', 'meal', '家常热菜', 'vegetable_main_dish', '{"reason":"独立热菜，不以粉丝作为主食分类","source":"user_review_2026-08-08"}'::jsonb),
  ('dish-b1095ed4fb698a', '蒜蓉粉丝娃娃菜', 'meal', '家常热菜', 'vegetable_main_dish', '{"reason":"独立热菜，不以粉丝作为主食分类","source":"user_review_2026-08-08"}'::jsonb),
  ('dish-ace8c088a34851', '红油抄手(汤/拌)', 'meal', '面食粉类', 'noodle_dumpling_main_dish', '{"reason":"抄手属于面食粉类","source":"user_review_2026-08-08"}'::jsonb),
  ('dish-ff85aeb1e23ed9', '沙拉脆皮鸡饭', 'meal', '米饭套餐', 'rice_based_main_dish', '{"reason":"鸡饭以米饭为主食形态","source":"user_review_2026-08-08"}'::jsonb),
  ('dish-48661b438aa112', '沙拉烤肉拌饭', 'meal', '米饭套餐', 'rice_based_main_dish', '{"reason":"拌饭以米饭为主食形态","source":"user_review_2026-08-08"}'::jsonb),
  ('dish-f2be14fefddff6', '酸汤肉片', 'meal', '家常热菜', 'hot_dish_not_soup', '{"reason":"肉片为独立热菜，酸汤为烹调口味而非汤羹主类","source":"user_review_2026-08-08"}'::jsonb);

DO $$
DECLARE
  missing_count INTEGER;
  name_mismatch_count INTEGER;
  before_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM catalog_category_033_proposed p
  LEFT JOIN dishes d ON d.tenant_id = 'default' AND d.id = p.dish_id
  WHERE d.id IS NULL;

  SELECT COUNT(*) INTO name_mismatch_count
  FROM catalog_category_033_proposed p
  JOIN dishes d ON d.tenant_id = 'default' AND d.id = p.dish_id
  WHERE d.name <> p.expected_name;

  SELECT COUNT(*) INTO before_count
  FROM dishes d
  JOIN catalog_category_033_proposed p ON p.dish_id = d.id
  WHERE d.tenant_id = 'default';

  IF missing_count <> 0 OR name_mismatch_count <> 0 OR before_count <> 6 THEN
    RAISE EXCEPTION '033 target validation failed: missing %, name mismatch %, matched %', missing_count, name_mismatch_count, before_count;
  END IF;
END $$;

INSERT INTO catalog_classification_audits
  (tenant_id, batch_id, dish_id, before_item_type, before_category,
   after_item_type, after_category, rule, stall_name, price, evidence_json)
SELECT 'default', 'catalog-targeted-corrections-2026-08-08-v1', d.id,
       d.catalog_item_type, d.catalog_category,
       p.after_item_type, p.after_category, p.rule,
       COALESCE(s.name, ''), d.price,
       p.evidence_json || jsonb_build_object('beforeCategory', d.catalog_category)
FROM dishes d
JOIN catalog_category_033_proposed p ON p.dish_id = d.id
LEFT JOIN stalls s ON s.tenant_id = d.tenant_id AND s.id = d.stall_id
WHERE d.tenant_id = 'default'
ON CONFLICT (tenant_id, batch_id, dish_id) DO NOTHING;

UPDATE dishes d
SET catalog_item_type = p.after_item_type,
    catalog_category = p.after_category,
    updated_at = CURRENT_TIMESTAMP
FROM catalog_category_033_proposed p
WHERE d.tenant_id = 'default' AND d.id = p.dish_id;

DO $$
DECLARE
  invalid_count INTEGER;
  id_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM dishes d
  JOIN catalog_category_033_proposed p ON p.dish_id = d.id
  WHERE d.tenant_id = 'default'
    AND (d.catalog_item_type <> p.after_item_type OR d.catalog_category <> p.after_category);

  SELECT COUNT(*) INTO id_count
  FROM dishes d
  WHERE d.tenant_id = 'default'
    AND d.id IN (
      'dish-ac282f05b7c41f', 'dish-b1095ed4fb698a', 'dish-ace8c088a34851',
      'dish-ff85aeb1e23ed9', 'dish-48661b438aa112', 'dish-f2be14fefddff6'
    );

  IF invalid_count <> 0 OR id_count <> 6 THEN
    RAISE EXCEPTION '033 post-update validation failed: invalid %, target count %', invalid_count, id_count;
  END IF;
END $$;

DELETE FROM rag_documents
WHERE tenant_id = 'default' AND source_type = 'dish'
  AND source_id IN (
    'dish-ac282f05b7c41f', 'dish-b1095ed4fb698a', 'dish-ace8c088a34851',
    'dish-ff85aeb1e23ed9', 'dish-48661b438aa112', 'dish-f2be14fefddff6'
  );
