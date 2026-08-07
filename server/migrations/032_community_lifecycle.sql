ALTER TABLE campus_posts ADD COLUMN IF NOT EXISTS archived_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE campus_posts ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE campus_posts ADD COLUMN IF NOT EXISTS restored_at TEXT;
ALTER TABLE campus_posts ADD COLUMN IF NOT EXISTS moderation_version TEXT NOT NULL DEFAULT '';

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS archived_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS restored_at TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_version TEXT NOT NULL DEFAULT '';

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS archived_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS restored_at TEXT;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS moderation_version TEXT NOT NULL DEFAULT '';

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'campus_posts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE campus_posts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE campus_posts ADD CONSTRAINT campus_posts_status_check
    CHECK(status IN ('pending','approved','rejected','archived'));

  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'reviews'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE reviews DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE reviews ADD CONSTRAINT reviews_status_check
    CHECK(status IN ('pending','approved','rejected','archived'));

  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'post_comments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE post_comments DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE post_comments ADD CONSTRAINT post_comments_status_check
    CHECK(status IN ('pending','approved','rejected','archived'));
END $$;

CREATE TABLE IF NOT EXISTS community_moderation_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  target_type TEXT NOT NULL CHECK(target_type IN ('profile','post','review','comment')),
  target_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  input_hash TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('approved','rejected','pending')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  rule_version TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_moderation_target
  ON community_moderation_decisions(tenant_id, target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_community_moderation_outcome
  ON community_moderation_decisions(tenant_id, outcome, created_at);
CREATE INDEX IF NOT EXISTS idx_community_content_archived
  ON campus_posts(tenant_id, archived_at, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_archived
  ON reviews(tenant_id, archived_at, created_at);

ALTER TABLE community_moderation_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_moderation_admin_read ON community_moderation_decisions;
CREATE POLICY community_moderation_admin_read ON community_moderation_decisions
  FOR SELECT USING (app_tenant_matches(tenant_id) AND app_can_moderate_community());
DROP POLICY IF EXISTS community_moderation_service_write ON community_moderation_decisions;
CREATE POLICY community_moderation_service_write ON community_moderation_decisions
  FOR INSERT WITH CHECK (app_tenant_matches(tenant_id));
