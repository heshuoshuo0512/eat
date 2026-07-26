CREATE OR REPLACE FUNCTION app_current_tenant()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_id', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION app_current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'anonymous');
$$;

CREATE OR REPLACE FUNCTION app_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION app_is_tenant_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN (
    'operator', 'stall_admin', 'canteen_admin', 'auditor',
    'finance', 'tenant_admin', 'admin', 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION app_can_write_catalog()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN (
    'operator', 'stall_admin', 'canteen_admin',
    'tenant_admin', 'admin', 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION app_can_manage_canteens()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN ('canteen_admin', 'tenant_admin', 'admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION app_can_moderate_community()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN ('canteen_admin', 'tenant_admin', 'admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION app_can_read_users()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN ('canteen_admin', 'tenant_admin', 'auditor', 'admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION app_can_manage_users()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN ('tenant_admin', 'admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION app_can_read_audit()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN (
    'canteen_admin', 'tenant_admin', 'auditor', 'finance', 'admin', 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION app_can_configure_ai()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_current_role() IN ('tenant_admin', 'admin', 'super_admin');
$$;

CREATE OR REPLACE FUNCTION app_tenant_matches(row_tenant TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_is_super_admin() OR row_tenant = app_current_tenant();
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'canteens', 'stalls', 'dishes', 'reviews', 'campus_posts',
    'health_profiles', 'auth_verification_codes', 'user_identities',
    'auth_sessions', 'uploads', 'rag_documents', 'app_settings', 'audit_logs',
    'menus', 'menu_items', 'orders', 'order_items', 'payments',
    'agent_sessions', 'agent_messages', 'agent_actions', 'agent_memories',
    'agent_eval_runs', 'agent_eval_cases', 'agent_eval_case_runs',
    'ai_usage_logs', 'user_dish_preferences', 'campus_environment', 'retrieval_index_runs',
    'data_import_batches', 'outbox_events'
  ] LOOP
    IF to_regclass(table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name TEXT;
  write_guard TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'canteens', 'stalls', 'dishes', 'menus', 'menu_items', 'campus_environment'
  ] LOOP
    IF to_regclass(table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_read', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (app_tenant_matches(tenant_id))',
      table_name || '_tenant_read', table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_staff_write', table_name);
    write_guard := CASE
      WHEN table_name IN ('canteens', 'campus_environment') THEN 'app_can_manage_canteens()'
      ELSE 'app_can_write_catalog()'
    END;
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (app_tenant_matches(tenant_id) AND %s) WITH CHECK (app_tenant_matches(tenant_id) AND %s)',
      table_name || '_staff_write', table_name, write_guard, write_guard
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS users_access ON users;
CREATE POLICY users_access ON users
  FOR SELECT USING (
    (app_current_role() = 'authenticator' AND app_tenant_matches(tenant_id))
    OR (
      app_tenant_matches(tenant_id)
      AND (
      id = app_current_user_id()
      OR app_can_read_users()
      )
    )
  );
DROP POLICY IF EXISTS users_write ON users;
CREATE POLICY users_write ON users
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR app_can_manage_users())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR app_can_manage_users())
  );

DROP POLICY IF EXISTS health_profiles_owner ON health_profiles;
CREATE POLICY health_profiles_owner ON health_profiles
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR user_id = app_current_user_id())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR user_id = app_current_user_id())
  );

DROP POLICY IF EXISTS preferences_owner ON user_dish_preferences;
CREATE POLICY preferences_owner ON user_dish_preferences
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND user_id = app_current_user_id()
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND user_id = app_current_user_id()
  );

DROP POLICY IF EXISTS orders_owner ON orders;
DROP POLICY IF EXISTS orders_read ON orders;
CREATE POLICY orders_read ON orders
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND (user_id = app_current_user_id() OR app_is_tenant_staff())
  );
CREATE POLICY orders_owner ON orders
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (user_id = app_current_user_id() OR app_can_write_catalog())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (user_id = app_current_user_id() OR app_can_write_catalog())
  );

DROP POLICY IF EXISTS order_items_owner ON order_items;
DROP POLICY IF EXISTS order_items_read ON order_items;
CREATE POLICY order_items_read ON order_items
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND (orders.user_id = app_current_user_id() OR app_is_tenant_staff())
    )
  );
CREATE POLICY order_items_owner ON order_items
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND (orders.user_id = app_current_user_id() OR app_can_write_catalog())
    )
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND (orders.user_id = app_current_user_id() OR app_can_write_catalog())
    )
  );

DROP POLICY IF EXISTS payments_owner ON payments;
DROP POLICY IF EXISTS payments_read ON payments;
CREATE POLICY payments_read ON payments
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payments.order_id
        AND (orders.user_id = app_current_user_id() OR app_is_tenant_staff())
    )
  );
CREATE POLICY payments_owner ON payments
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payments.order_id
        AND (orders.user_id = app_current_user_id() OR app_can_write_catalog())
    )
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payments.order_id
        AND (orders.user_id = app_current_user_id() OR app_can_write_catalog())
    )
  );

DROP POLICY IF EXISTS reviews_visibility ON reviews;
CREATE POLICY reviews_visibility ON reviews
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND (status = 'approved' OR user_id = app_current_user_id() OR app_can_moderate_community())
  );
DROP POLICY IF EXISTS reviews_author_write ON reviews;
DROP POLICY IF EXISTS reviews_insert ON reviews;
CREATE POLICY reviews_insert ON reviews
  FOR INSERT WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (
      (user_id = app_current_user_id() AND status = 'pending')
      OR app_can_moderate_community()
    )
  );
DROP POLICY IF EXISTS reviews_moderate ON reviews;
CREATE POLICY reviews_moderate ON reviews
  FOR UPDATE USING (app_tenant_matches(tenant_id) AND app_can_moderate_community())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_moderate_community());
DROP POLICY IF EXISTS reviews_delete ON reviews;
CREATE POLICY reviews_delete ON reviews
  FOR DELETE USING (app_tenant_matches(tenant_id) AND app_can_moderate_community());

DROP POLICY IF EXISTS posts_visibility ON campus_posts;
CREATE POLICY posts_visibility ON campus_posts
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND (status = 'approved' OR user_id = app_current_user_id() OR app_can_moderate_community())
  );
DROP POLICY IF EXISTS posts_author_write ON campus_posts;
DROP POLICY IF EXISTS posts_insert ON campus_posts;
CREATE POLICY posts_insert ON campus_posts
  FOR INSERT WITH CHECK (
    app_tenant_matches(tenant_id)
    AND user_id = app_current_user_id()
    AND status = 'pending'
  );
DROP POLICY IF EXISTS posts_moderate ON campus_posts;
CREATE POLICY posts_moderate ON campus_posts
  FOR UPDATE USING (app_tenant_matches(tenant_id) AND app_can_moderate_community())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_moderate_community());
DROP POLICY IF EXISTS posts_delete ON campus_posts;
CREATE POLICY posts_delete ON campus_posts
  FOR DELETE USING (app_tenant_matches(tenant_id) AND app_can_moderate_community());

DROP POLICY IF EXISTS identities_owner ON user_identities;
DROP POLICY IF EXISTS identities_read ON user_identities;
CREATE POLICY identities_read ON user_identities
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR user_id = app_current_user_id())
  );
DROP POLICY IF EXISTS identities_authenticator_write ON user_identities;
CREATE POLICY identities_authenticator_write ON user_identities
  FOR ALL USING (app_tenant_matches(tenant_id) AND app_current_role() = 'authenticator')
  WITH CHECK (app_tenant_matches(tenant_id) AND app_current_role() = 'authenticator');

DROP POLICY IF EXISTS sessions_owner ON auth_sessions;
CREATE POLICY sessions_owner ON auth_sessions
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR user_id = app_current_user_id())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'authenticator' OR user_id = app_current_user_id())
  );

ALTER TABLE auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_tokens_session_access ON auth_refresh_tokens;
CREATE POLICY refresh_tokens_session_access ON auth_refresh_tokens
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (
      app_current_role() = 'authenticator'
      OR EXISTS (
      SELECT 1 FROM auth_sessions
      WHERE auth_sessions.id = auth_refresh_tokens.session_id
        AND auth_sessions.user_id = app_current_user_id()
      )
    )
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (
      app_current_role() = 'authenticator'
      OR EXISTS (
      SELECT 1 FROM auth_sessions
      WHERE auth_sessions.id = auth_refresh_tokens.session_id
        AND auth_sessions.user_id = app_current_user_id()
      )
    )
  );

DROP POLICY IF EXISTS verification_codes_authenticator ON auth_verification_codes;
CREATE POLICY verification_codes_authenticator ON auth_verification_codes
  FOR ALL USING (app_tenant_matches(tenant_id) AND app_current_role() = 'authenticator')
  WITH CHECK (app_tenant_matches(tenant_id) AND app_current_role() = 'authenticator');

DROP POLICY IF EXISTS uploads_owner ON uploads;
CREATE POLICY uploads_owner ON uploads
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (
      owner_id = app_current_user_id()
      OR app_can_write_catalog()
      OR app_can_moderate_community()
    )
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (
      owner_id = app_current_user_id()
      OR app_can_write_catalog()
      OR app_can_moderate_community()
    )
  );
DROP POLICY IF EXISTS uploads_signed_read ON uploads;
CREATE POLICY uploads_signed_read ON uploads
  FOR SELECT USING (app_current_role() = 'storage_reader');

DROP POLICY IF EXISTS rag_documents_read ON rag_documents;
CREATE POLICY rag_documents_read ON rag_documents
  FOR SELECT USING (
    tenant_id = '__global__' OR app_tenant_matches(tenant_id)
  );
DROP POLICY IF EXISTS rag_documents_write ON rag_documents;
CREATE POLICY rag_documents_write ON rag_documents
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_write_catalog())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_write_catalog())
  );

DROP POLICY IF EXISTS retrieval_runs_read ON retrieval_index_runs;
CREATE POLICY retrieval_runs_read ON retrieval_index_runs
  FOR SELECT USING (app_tenant_matches(tenant_id) AND app_can_read_audit());
DROP POLICY IF EXISTS retrieval_runs_write ON retrieval_index_runs;
CREATE POLICY retrieval_runs_write ON retrieval_index_runs
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_write_catalog())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() = 'worker' OR app_can_write_catalog())
  );

DROP POLICY IF EXISTS app_settings_tenant ON app_settings;
CREATE POLICY app_settings_tenant ON app_settings
  FOR SELECT USING (
    app_tenant_matches(tenant_id)
    AND app_current_role() NOT IN ('anonymous', 'authenticator', 'storage_reader')
  );
DROP POLICY IF EXISTS app_settings_staff_write ON app_settings;
CREATE POLICY app_settings_staff_write ON app_settings
  FOR ALL USING (app_tenant_matches(tenant_id) AND app_can_configure_ai())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_configure_ai());

DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (user_id IS NULL OR user_id = app_current_user_id() OR app_is_tenant_staff())
  );
DROP POLICY IF EXISTS audit_staff_read ON audit_logs;
CREATE POLICY audit_staff_read ON audit_logs
  FOR SELECT USING (app_tenant_matches(tenant_id) AND app_can_read_audit());

DROP POLICY IF EXISTS ai_usage_insert ON ai_usage_logs;
CREATE POLICY ai_usage_insert ON ai_usage_logs
  FOR INSERT WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (user_id IS NULL OR user_id = app_current_user_id() OR app_is_tenant_staff())
  );
DROP POLICY IF EXISTS ai_usage_staff_read ON ai_usage_logs;
CREATE POLICY ai_usage_staff_read ON ai_usage_logs
  FOR SELECT USING (app_tenant_matches(tenant_id) AND app_can_configure_ai());

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_sessions', 'agent_memories'
  ] LOOP
    IF to_regclass(table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_owner', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (app_tenant_matches(tenant_id) AND user_id = app_current_user_id()) WITH CHECK (app_tenant_matches(tenant_id) AND user_id = app_current_user_id())',
      table_name || '_owner', table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['agent_eval_runs', 'agent_eval_case_runs'] LOOP
    IF to_regclass(table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_owner', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_is_tenant_staff())) WITH CHECK (app_tenant_matches(tenant_id) AND (user_id = app_current_user_id() OR app_is_tenant_staff()))',
      table_name || '_owner', table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS agent_eval_cases_staff ON agent_eval_cases;
CREATE POLICY agent_eval_cases_staff ON agent_eval_cases
  FOR ALL USING (app_tenant_matches(tenant_id) AND app_is_tenant_staff())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_is_tenant_staff());

DROP POLICY IF EXISTS agent_messages_owner ON agent_messages;
CREATE POLICY agent_messages_owner ON agent_messages
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM agent_sessions
      WHERE agent_sessions.id = agent_messages.session_id
        AND agent_sessions.user_id = app_current_user_id()
    )
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND EXISTS (
      SELECT 1 FROM agent_sessions
      WHERE agent_sessions.id = agent_messages.session_id
        AND agent_sessions.user_id = app_current_user_id()
    )
  );

DROP POLICY IF EXISTS agent_actions_owner ON agent_actions;
CREATE POLICY agent_actions_owner ON agent_actions
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND user_id = app_current_user_id()
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND user_id = app_current_user_id()
  );

DROP POLICY IF EXISTS import_batches_staff ON data_import_batches;
CREATE POLICY import_batches_staff ON data_import_batches
  FOR ALL USING (app_tenant_matches(tenant_id) AND app_can_write_catalog())
  WITH CHECK (app_tenant_matches(tenant_id) AND app_can_write_catalog());

DROP POLICY IF EXISTS outbox_api_insert ON outbox_events;
CREATE POLICY outbox_api_insert ON outbox_events
  FOR INSERT WITH CHECK (
    app_current_role() = 'worker'
    OR (
      app_tenant_matches(tenant_id)
      AND app_current_role() NOT IN ('anonymous', 'authenticator', 'storage_reader')
    )
  );
DROP POLICY IF EXISTS outbox_worker_access ON outbox_events;
CREATE POLICY outbox_worker_access ON outbox_events
  FOR ALL USING (app_current_role() = 'worker' OR app_is_super_admin())
  WITH CHECK (app_current_role() = 'worker' OR app_is_super_admin());
DROP POLICY IF EXISTS outbox_metrics_read ON outbox_events;
CREATE POLICY outbox_metrics_read ON outbox_events
  FOR SELECT USING (
    app_current_role() = 'metrics_reader'
    OR (app_tenant_matches(tenant_id) AND app_can_read_audit())
  );

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_read ON tenants;
CREATE POLICY tenants_read ON tenants
  FOR SELECT USING (
    id = app_current_tenant()
    OR app_is_super_admin()
    OR app_current_role() = 'worker'
  );
DROP POLICY IF EXISTS tenants_super_admin_write ON tenants;
CREATE POLICY tenants_super_admin_write ON tenants
  FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
