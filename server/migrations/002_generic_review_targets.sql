DROP INDEX IF EXISTS idx_reviews_tenant_target;
DROP INDEX IF EXISTS idx_reviews_target;

ALTER TABLE reviews RENAME TO reviews_dish_only;

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('dish','canteen')),
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL
);

INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at)
SELECT id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at FROM reviews_dish_only;

DROP TABLE reviews_dish_only;

CREATE INDEX idx_reviews_target ON reviews(target_type, target_id);
CREATE INDEX idx_reviews_tenant_target ON reviews(tenant_id, target_type, target_id);
