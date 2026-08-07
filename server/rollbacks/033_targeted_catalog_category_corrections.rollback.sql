-- Rollback for catalog-targeted-corrections-2026-08-08-v1.
-- Stop the API and rebuild the dish retrieval index after rollback.

DO $$
DECLARE
  mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM catalog_classification_audits a
  JOIN dishes d ON d.tenant_id = a.tenant_id AND d.id = a.dish_id
  WHERE a.tenant_id = 'default'
    AND a.batch_id = 'catalog-targeted-corrections-2026-08-08-v1'
    AND (d.catalog_item_type <> a.after_item_type OR d.catalog_category <> a.after_category);

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION '033 rollback refused: % target classifications changed after migration', mismatch_count;
  END IF;
END $$;

UPDATE dishes d
SET catalog_item_type = a.before_item_type,
    catalog_category = a.before_category,
    updated_at = CURRENT_TIMESTAMP
FROM catalog_classification_audits a
WHERE a.tenant_id = 'default'
  AND a.batch_id = 'catalog-targeted-corrections-2026-08-08-v1'
  AND d.tenant_id = a.tenant_id
  AND d.id = a.dish_id;

DELETE FROM rag_documents
WHERE tenant_id = 'default' AND source_type = 'dish'
  AND source_id IN (
    'dish-ac282f05b7c41f', 'dish-b1095ed4fb698a', 'dish-ace8c088a34851',
    'dish-ff85aeb1e23ed9', 'dish-48661b438aa112', 'dish-f2be14fefddff6'
  );
