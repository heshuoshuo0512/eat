ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_target_type_check;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_target_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_target_type_check CHECK (target_type IN ('dish','canteen'));
