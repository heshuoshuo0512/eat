-- Rollback for catalog-reclassification-030-v1
-- Run only after stopping the API, then rebuild the RAG index.

DO $$
DECLARE
  mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM catalog_classification_audits a
  JOIN dishes d ON d.tenant_id = a.tenant_id AND d.id = a.dish_id
  WHERE a.tenant_id = 'default' AND a.batch_id = 'catalog-reclassification-030-v1'
    AND (d.catalog_item_type <> a.after_item_type OR d.catalog_category <> a.after_category);
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION '030 rollback refused: % dish classification(s) changed after migration', mismatch_count;
  END IF;
END $$;

UPDATE dishes d
SET catalog_item_type = a.before_item_type,
    catalog_category = a.before_category,
    updated_at = CURRENT_TIMESTAMP
FROM catalog_classification_audits a
WHERE a.tenant_id = 'default'
  AND a.batch_id = 'catalog-reclassification-030-v1'
  AND d.tenant_id = a.tenant_id
  AND d.id = a.dish_id;

DELETE FROM rag_documents
WHERE tenant_id = 'default' AND source_type = 'dish';
