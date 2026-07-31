ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS dish_type TEXT NOT NULL DEFAULT '餐食';
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS dish_category TEXT NOT NULL DEFAULT '其他';
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS meal_period TEXT NOT NULL DEFAULT '午餐';

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_dish_type_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_dish_type_check
  CHECK (dish_type IN ('餐食', '小吃', '饮品', '加购'));

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_meal_period_check;
ALTER TABLE dishes
  ADD CONSTRAINT dishes_meal_period_check
  CHECK (meal_period IN ('早餐', '午餐', '晚餐', '全天', '未知'));
