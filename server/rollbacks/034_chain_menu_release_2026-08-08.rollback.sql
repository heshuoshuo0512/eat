-- Controlled rollback template for chain-menu-release-2026-08-08-v1.
-- Run with: psql "$DATABASE_MIGRATION_URL" -v batch_id='chain-menu-release-2026-08-08-v1' -f this-file
\if :{?batch_id}
\else
  \echo 'batch_id is required'
  \quit 3
\endif

BEGIN;
SELECT set_config('app.tenant_id', 'default', true),
       set_config('app.user_id', 'chain-menu-release-rollback', true),
       set_config('app.role', 'super_admin', true);

CREATE TEMP TABLE chain_menu_release_rollback_dishes ON COMMIT DROP AS
SELECT dish_id AS id
  FROM chain_menu_release_items
 WHERE batch_id = :'batch_id'
   AND dish_id IS NOT NULL;

DELETE FROM rag_documents
 WHERE tenant_id = 'default'
   AND source_type = 'dish'
   AND source_id IN (SELECT id FROM chain_menu_release_rollback_dishes);

DELETE FROM dishes
 WHERE tenant_id = 'default'
   AND id IN (SELECT id FROM chain_menu_release_rollback_dishes);

DELETE FROM stalls s
 WHERE s.tenant_id = 'default'
   AND s.id IN (
     SELECT stall_id FROM chain_menu_release_stalls
      WHERE batch_id = :'batch_id' AND created_by_batch = 1
   )
   AND NOT EXISTS (SELECT 1 FROM dishes d WHERE d.tenant_id = s.tenant_id AND d.stall_id = s.id);

UPDATE chain_menu_release_items
   SET status = 'rolled_back', dish_id = NULL
 WHERE batch_id = :'batch_id';

UPDATE chain_menu_release_batches
   SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
 WHERE id = :'batch_id' AND tenant_id = 'default';

COMMIT;
