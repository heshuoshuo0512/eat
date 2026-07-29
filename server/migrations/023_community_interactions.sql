CREATE TABLE IF NOT EXISTS content_reactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  target_type TEXT NOT NULL CHECK(target_type IN ('post','review')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK(reaction IN ('like','dislike')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, target_type, target_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  post_id TEXT NOT NULL REFERENCES campus_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('post','review','comment')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_reactions_target ON content_reactions(tenant_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(tenant_id, post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports(tenant_id, target_type, target_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_pending_unique
  ON content_reports(tenant_id, reporter_id, target_type, target_id)
  WHERE status = 'pending';

ALTER TABLE content_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_reactions_access ON content_reactions;
DROP POLICY IF EXISTS content_reactions_read ON content_reactions;
CREATE POLICY content_reactions_read ON content_reactions
  FOR SELECT USING (app_tenant_matches(tenant_id));
DROP POLICY IF EXISTS content_reactions_owner_write ON content_reactions;
CREATE POLICY content_reactions_owner_write ON content_reactions
  FOR ALL USING (app_tenant_matches(tenant_id) AND user_id = app_current_user_id())
  WITH CHECK (app_tenant_matches(tenant_id) AND user_id = app_current_user_id());

DROP POLICY IF EXISTS post_comments_visibility ON post_comments;
CREATE POLICY post_comments_visibility ON post_comments
  FOR SELECT USING (app_tenant_matches(tenant_id) AND status = 'approved');
DROP POLICY IF EXISTS post_comments_author_insert ON post_comments;
CREATE POLICY post_comments_author_insert ON post_comments
  FOR INSERT WITH CHECK (app_tenant_matches(tenant_id) AND user_id = app_current_user_id() AND status = 'approved');
DROP POLICY IF EXISTS post_comments_author_update ON post_comments;
CREATE POLICY post_comments_author_update ON post_comments
  FOR UPDATE USING (app_tenant_matches(tenant_id) AND user_id = app_current_user_id())
  WITH CHECK (app_tenant_matches(tenant_id) AND user_id = app_current_user_id());
DROP POLICY IF EXISTS post_comments_author_delete ON post_comments;
CREATE POLICY post_comments_author_delete ON post_comments
  FOR DELETE USING (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_can_moderate_community()));

DROP POLICY IF EXISTS content_reports_author_insert ON content_reports;
CREATE POLICY content_reports_author_insert ON content_reports
  FOR INSERT WITH CHECK (app_tenant_matches(tenant_id) AND reporter_id = app_current_user_id() AND status = 'pending');
DROP POLICY IF EXISTS content_reports_author_read ON content_reports;
CREATE POLICY content_reports_author_read ON content_reports
  FOR SELECT USING (app_tenant_matches(tenant_id) AND (reporter_id = app_current_user_id() OR app_can_moderate_community()));
DROP POLICY IF EXISTS content_reports_moderate ON content_reports;
CREATE POLICY content_reports_moderate ON content_reports
  FOR UPDATE USING (app_tenant_matches(tenant_id) AND app_can_moderate_community())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_moderate_community());

DROP POLICY IF EXISTS reviews_author_update ON reviews;
CREATE POLICY reviews_author_update ON reviews
  FOR UPDATE USING (app_tenant_matches(tenant_id) AND user_id = app_current_user_id())
  WITH CHECK (app_tenant_matches(tenant_id) AND user_id = app_current_user_id() AND status = 'pending');
DROP POLICY IF EXISTS reviews_delete ON reviews;
CREATE POLICY reviews_delete ON reviews
  FOR DELETE USING (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_can_moderate_community()));

DROP POLICY IF EXISTS posts_author_update ON campus_posts;
CREATE POLICY posts_author_update ON campus_posts
  FOR UPDATE USING (app_tenant_matches(tenant_id) AND user_id = app_current_user_id())
  WITH CHECK (app_tenant_matches(tenant_id) AND user_id = app_current_user_id() AND status = 'pending');
DROP POLICY IF EXISTS posts_delete ON campus_posts;
CREATE POLICY posts_delete ON campus_posts
  FOR DELETE USING (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_can_moderate_community()));
