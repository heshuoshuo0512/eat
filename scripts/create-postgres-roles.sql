\set ON_ERROR_STOP on

-- Run once before migrations with a PostgreSQL administrator account. The
-- second provisioning pass grants table and function privileges after DDL.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

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
GRANT CONNECT ON DATABASE :"DBNAME" TO smart_canteen_migrator, smart_canteen_api, smart_canteen_worker;
GRANT USAGE, CREATE ON SCHEMA public TO smart_canteen_migrator;
