-- Auditable release boundary for approved chain-store menu documents.
-- Only the explicit release importer may move rows from approved to imported.

CREATE TABLE IF NOT EXISTS chain_menu_release_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'approved_for_production'
    CHECK (status IN ('approved_for_production', 'imported', 'rolled_back')),
  source_audit_sha256 TEXT NOT NULL,
  release_digest TEXT NOT NULL,
  accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  imported_at TEXT,
  rolled_back_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chain_menu_release_stalls (
  batch_id TEXT NOT NULL REFERENCES chain_menu_release_batches(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  stall_id TEXT NOT NULL REFERENCES stalls(id) ON DELETE RESTRICT,
  canteen_id TEXT NOT NULL REFERENCES canteens(id) ON DELETE RESTRICT,
  created_by_batch INTEGER NOT NULL DEFAULT 0 CHECK (created_by_batch IN (0, 1)),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, stall_id)
);

CREATE TABLE IF NOT EXISTS chain_menu_release_items (
  id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES chain_menu_release_batches(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  source_name TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_line INTEGER NOT NULL CHECK (source_line > 0),
  source_scope TEXT NOT NULL CHECK (source_scope IN ('single_store_source', 'shared_brand_menu')),
  merchant TEXT NOT NULL,
  location TEXT NOT NULL,
  stall_id TEXT NOT NULL REFERENCES stalls(id) ON DELETE RESTRICT,
  canteen_id TEXT NOT NULL REFERENCES canteens(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL CHECK (price >= 0),
  price_display TEXT NOT NULL,
  price_mode TEXT NOT NULL CHECK (price_mode IN ('fixed', 'from')),
  catalog_item_type TEXT NOT NULL CHECK (catalog_item_type IN ('meal', 'snack', 'beverage')),
  catalog_category TEXT NOT NULL,
  classification_rule TEXT NOT NULL,
  source_raw_text TEXT NOT NULL DEFAULT '',
  aggregate_duplicate_reference INTEGER NOT NULL DEFAULT 0 CHECK (aggregate_duplicate_reference IN (0, 1)),
  dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'imported', 'rolled_back')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, id),
  UNIQUE (batch_id, source_name, source_line, location, price)
);

CREATE INDEX IF NOT EXISTS idx_chain_menu_release_batches_tenant_status
  ON chain_menu_release_batches(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_menu_release_items_tenant_status
  ON chain_menu_release_items(tenant_id, status, batch_id);
CREATE INDEX IF NOT EXISTS idx_chain_menu_release_items_dish
  ON chain_menu_release_items(tenant_id, dish_id);

ALTER TABLE chain_menu_release_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_menu_release_stalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_menu_release_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chain_menu_release_batches_staff ON chain_menu_release_batches;
CREATE POLICY chain_menu_release_batches_staff ON chain_menu_release_batches
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() IN ('worker', 'admin', 'super_admin', 'tenant_admin', 'auditor') OR app_can_manage_canteens())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() IN ('worker', 'admin', 'super_admin', 'tenant_admin', 'auditor') OR app_can_manage_canteens())
  );

DROP POLICY IF EXISTS chain_menu_release_stalls_staff ON chain_menu_release_stalls;
CREATE POLICY chain_menu_release_stalls_staff ON chain_menu_release_stalls
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() IN ('worker', 'admin', 'super_admin', 'tenant_admin', 'auditor') OR app_can_manage_canteens())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() IN ('worker', 'admin', 'super_admin', 'tenant_admin', 'auditor') OR app_can_manage_canteens())
  );

DROP POLICY IF EXISTS chain_menu_release_items_staff ON chain_menu_release_items;
CREATE POLICY chain_menu_release_items_staff ON chain_menu_release_items
  FOR ALL USING (
    app_tenant_matches(tenant_id)
    AND (app_current_role() IN ('worker', 'admin', 'super_admin', 'tenant_admin', 'auditor') OR app_can_manage_canteens())
  ) WITH CHECK (
    app_tenant_matches(tenant_id)
    AND (app_current_role() IN ('worker', 'admin', 'super_admin', 'tenant_admin', 'auditor') OR app_can_manage_canteens())
  );
