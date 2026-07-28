-- Run with a PostgreSQL owner account. Passwords are supplied as psql variables:
-- psql "$DATABASE_ADMIN_URL" \
--   -v migrator_password='...' -v api_password='...' -v worker_password='...' \
--   -f scripts/provision-postgres-roles.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_canteen_migrator') THEN
    CREATE ROLE smart_canteen_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_canteen_api') THEN
    CREATE ROLE smart_canteen_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_canteen_worker') THEN
    CREATE ROLE smart_canteen_worker NOLOGIN;
  END IF;
END $$;

ALTER ROLE smart_canteen_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE smart_canteen_api NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE smart_canteen_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

\if :{?migrator_password}
  ALTER ROLE smart_canteen_migrator LOGIN PASSWORD :'migrator_password';
\endif
\if :{?api_password}
  ALTER ROLE smart_canteen_api LOGIN PASSWORD :'api_password';
\endif
\if :{?worker_password}
  ALTER ROLE smart_canteen_worker LOGIN PASSWORD :'worker_password';
\endif

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE :"DBNAME" TO smart_canteen_migrator, smart_canteen_api, smart_canteen_worker;
GRANT USAGE ON SCHEMA public TO smart_canteen_api, smart_canteen_worker;
GRANT USAGE, CREATE ON SCHEMA public TO smart_canteen_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smart_canteen_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO smart_canteen_api;
REVOKE ALL ON schema_migrations FROM smart_canteen_api, smart_canteen_worker;

GRANT SELECT ON outbox_events, rag_documents, retrieval_index_runs, dishes, stalls, canteens, menus, menu_items, tenants TO smart_canteen_worker;
GRANT INSERT, UPDATE, DELETE ON outbox_events, rag_documents, retrieval_index_runs TO smart_canteen_worker;
GRANT SELECT ON dish_reference_images, dish_image_embeddings, dish_recipe_versions, dish_recipe_ingredients, dish_nutrition_versions TO smart_canteen_worker;
GRANT INSERT, UPDATE, DELETE ON dish_image_embeddings TO smart_canteen_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO smart_canteen_worker;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_current_role() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_is_super_admin() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_is_tenant_staff() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_write_catalog() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_manage_canteens() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_moderate_community() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_read_users() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_manage_users() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_read_audit() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_can_configure_ai() TO smart_canteen_api, smart_canteen_worker;
GRANT EXECUTE ON FUNCTION app_tenant_matches(TEXT) TO smart_canteen_api, smart_canteen_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE smart_canteen_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smart_canteen_api;
ALTER DEFAULT PRIVILEGES FOR ROLE smart_canteen_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO smart_canteen_api, smart_canteen_worker;

-- The migration role owns DDL. Existing objects created by another deployment
-- owner should be reassigned explicitly during the controlled cutover:
-- REASSIGN OWNED BY old_deploy_role TO smart_canteen_migrator;
