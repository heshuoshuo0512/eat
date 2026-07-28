-- Align the approved campus catalog with its real mixed-depth venue hierarchy.
-- Existing stall and dish foreign keys remain unchanged.

UPDATE canteens
SET name = '东区燕鸣湖',
    venue_kind = 'dining_hall',
    description = '东区燕鸣湖真实目录，包含一楼与二楼。',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'east-zone';

UPDATE canteens
SET name = '东大活',
    parent_id = NULL,
    venue_kind = 'service_building',
    description = '东大活真实档口目录。',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'east-dongdahuo';

UPDATE canteens
SET parent_id = NULL,
    venue_kind = 'supermarket',
    description = '广源超市真实档口与商品目录。',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'default' AND id = 'east-guangyuan';
