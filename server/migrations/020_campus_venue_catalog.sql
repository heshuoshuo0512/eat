-- Canonical campus venue presentation and operating status.

ALTER TABLE canteens ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE canteens ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 999;
ALTER TABLE canteens ADD COLUMN IF NOT EXISTS operating_status TEXT NOT NULL DEFAULT 'open';

ALTER TABLE canteens DROP CONSTRAINT IF EXISTS canteens_operating_status_check;
ALTER TABLE canteens ADD CONSTRAINT canteens_operating_status_check
  CHECK (operating_status IN ('open', 'renovating', 'closed'));

UPDATE canteens
SET display_name = CASE
      WHEN id = 'campus-main' THEN '大食堂'
      WHEN id = 'east-zone' THEN '燕鸣湖'
      WHEN id = 'east-guangyuan' THEN '广源超市'
      WHEN id = 'east-dongdahuo' THEN '东大活'
      WHEN id = 'west-minzu' THEN '民族餐厅'
      WHEN id = 'west-xinyi' THEN '心怡餐厅'
      WHEN id = 'west-xijinjia' THEN '禧进甲餐厅'
      WHEN id = 'west-floor2-east' THEN '二楼东厅'
      WHEN id = 'west-darongshu' THEN '大榕树餐厅'
      WHEN id = 'west-floor3-east' THEN '三楼东厅'
      WHEN id = 'east-yanminghu-1f' THEN '一楼'
      WHEN id = 'east-yanminghu-2f' THEN '二楼'
      ELSE name
    END,
    display_order = CASE
      WHEN id = 'campus-main' THEN 1
      WHEN id = 'east-zone' THEN 2
      WHEN id = 'east-guangyuan' THEN 5
      WHEN id = 'east-dongdahuo' THEN 6
      WHEN id = 'west-minzu' THEN 1
      WHEN id = 'west-xinyi' THEN 2
      WHEN id = 'west-xijinjia' THEN 3
      WHEN id = 'west-floor2-east' THEN 4
      WHEN id = 'west-darongshu' THEN 5
      WHEN id = 'west-floor3-east' THEN 6
      WHEN id = 'east-yanminghu-1f' THEN 1
      WHEN id = 'east-yanminghu-2f' THEN 2
      ELSE display_order
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default';

UPDATE canteens SET name = '西区大食堂', location = '西区', parent_id = NULL, venue_kind = 'dining_hall', operating_status = 'open', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'campus-main';
UPDATE canteens SET name = '东区燕鸣湖', location = '东区', parent_id = NULL, venue_kind = 'dining_hall', operating_status = 'open', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'east-zone';
UPDATE canteens SET name = '西区广源超市', location = '西区', parent_id = NULL, venue_kind = 'supermarket', operating_status = 'open', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'east-guangyuan';
UPDATE canteens SET name = '东区东大活', location = '东区', parent_id = NULL, venue_kind = 'service_building', operating_status = 'open', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'east-dongdahuo';
UPDATE canteens SET name = '大榕树餐厅', location = '西区大食堂 · 三楼西', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'west-darongshu';

INSERT INTO canteens
  (id, tenant_id, name, display_name, display_order, operating_status, location, hours, crowd_level,
   tags_json, description, parent_id, canteen_type, image, venue_kind, created_at, updated_at)
VALUES
  ('west-yanyuan', 'default', '西区燕园', '燕园', 3, 'renovating', '西区', '装修中', 0,
   '["装修中"]', '西区燕园正在装修，开放后将提供正式校园餐饮目录。', NULL, 'primary', '', 'dining_hall', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('east-shanshuiyuan', 'default', '东区山水园', '山水园', 4, 'renovating', '东区', '装修中', 0,
   '["装修中"]', '东区山水园正在装修，开放后将提供正式校园餐饮目录。', NULL, 'primary', '', 'dining_hall', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  operating_status = EXCLUDED.operating_status,
  location = EXCLUDED.location,
  hours = EXCLUDED.hours,
  tags_json = EXCLUDED.tags_json,
  description = EXCLUDED.description,
  parent_id = NULL,
  canteen_type = 'primary',
  venue_kind = 'dining_hall',
  updated_at = CURRENT_TIMESTAMP
WHERE canteens.tenant_id = EXCLUDED.tenant_id;

CREATE INDEX IF NOT EXISTS idx_canteens_tenant_catalog_order
  ON canteens(tenant_id, parent_id, display_order, name, id);
CREATE INDEX IF NOT EXISTS idx_canteens_tenant_operating_status
  ON canteens(tenant_id, operating_status, id);
