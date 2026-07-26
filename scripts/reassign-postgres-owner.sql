\set ON_ERROR_STOP on

-- Run with the administrator account after creating the three runtime roles
-- and before applying migrations to an existing dedicated database:
-- psql "$DATABASE_ADMIN_URL" -v legacy_owner='smart_canteen' \
--   -f scripts/reassign-postgres-owner.sql

\if :{?legacy_owner}
\else
  \echo 'legacy_owner is required'
  \quit 3
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'legacy_owner'
) AS legacy_owner_exists \gset

\if :legacy_owner_exists
\else
  \echo 'The legacy database owner role does not exist'
  \quit 3
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'smart_canteen_migrator'
) AS migrator_exists \gset

\if :migrator_exists
\else
  \echo 'Run scripts/create-postgres-roles.sql before ownership reassignment'
  \quit 3
\endif

-- REASSIGN OWNED is scoped to the current database for database objects. The
-- Smart Canteen database must be dedicated to this application before running.
REASSIGN OWNED BY :"legacy_owner" TO smart_canteen_migrator;

SELECT
  current_database() AS database_name,
  :'legacy_owner' AS previous_owner,
  'smart_canteen_migrator' AS current_owner;
