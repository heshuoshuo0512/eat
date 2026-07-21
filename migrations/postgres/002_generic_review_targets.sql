ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_target_type_check;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_target_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_target_type_check CHECK (target_type IN ('dish','canteen'));

ALTER TABLE health_profiles DROP CONSTRAINT IF EXISTS health_profiles_students;
ALTER TABLE health_profiles ADD CONSTRAINT health_profiles_students check(is_student(health_profiles.user_id));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_students;
ALTER TABLE orders ADD CONSTRAINT orders_students check(is_student(orders.user_id));

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_students;
ALTER TABLE reviews ADD CONSTRAINT reviews_students check(is_student(reviews.user_id));

ALTER TABLE user_dish_preferences DROP CONSTRAINT IF EXISTS student_dish_preferences_students;
ALTER TABLE user_dish_preferences ADD CONSTRAINT student_dish_preferences_students check(is_student(user_dish_preferences.user_id));
