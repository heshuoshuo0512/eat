ALTER TABLE dishes ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS price_display TEXT NOT NULL DEFAULT '';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS pricing_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS aliases_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS semantic_labels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS source_ref_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE stalls ADD COLUMN IF NOT EXISTS aliases_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE dishes ALTER COLUMN rating SET DEFAULT 0;
ALTER TABLE stalls ALTER COLUMN rating SET DEFAULT 0;

UPDATE dishes
SET price_display = CASE
  WHEN price_display = '' THEN trim(to_char(price, 'FM999999990.##')) || '元'
  ELSE price_display
END;

ALTER TABLE dishes DROP CONSTRAINT IF EXISTS dishes_pricing_mode_check;
ALTER TABLE dishes ADD CONSTRAINT dishes_pricing_mode_check
  CHECK (pricing_mode IN ('fixed','per_weight','per_unit','per_person','variants','tiered'));

CREATE TABLE IF NOT EXISTS catalog_import_rows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  batch_id TEXT NOT NULL REFERENCES data_import_batches(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('accepted','review_required','excluded')),
  raw_text TEXT NOT NULL DEFAULT '',
  normalized_json TEXT NOT NULL DEFAULT '{}',
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_rows_batch
  ON catalog_import_rows(tenant_id, batch_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_import_rows_source
  ON catalog_import_rows(batch_id, source_hash, source_locator, entity_type, COALESCE(entity_id, ''));

ALTER TABLE catalog_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_import_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_import_rows_tenant_staff ON catalog_import_rows;
CREATE POLICY catalog_import_rows_tenant_staff ON catalog_import_rows
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    AND current_setting('app.role', true) IN ('operator','stall_admin','canteen_admin','auditor','tenant_admin','admin','super_admin','worker')
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    AND current_setting('app.role', true) IN ('operator','stall_admin','canteen_admin','auditor','tenant_admin','admin','super_admin','worker')
  );
