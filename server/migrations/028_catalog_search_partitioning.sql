-- Logical catalog partitions are expressed through item type and category.
-- This migration deliberately does not rewrite catalog rows: the audited
-- classification produced by migrations 025-027 remains authoritative.
CREATE INDEX IF NOT EXISTS idx_dishes_catalog_search_partition
  ON dishes(
    tenant_id,
    review_status,
    retrieval_eligible,
    catalog_item_type,
    catalog_category,
    status
  );

-- Rollback (index only, no data rollback is required):
-- DROP INDEX IF EXISTS idx_dishes_catalog_search_partition;
