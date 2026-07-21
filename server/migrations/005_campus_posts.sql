CREATE TABLE IF NOT EXISTS campus_posts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('dish','canteen')),
  target_id TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  linked_review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campus_posts_tenant_status
  ON campus_posts(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_campus_posts_user
  ON campus_posts(tenant_id, user_id, created_at);
