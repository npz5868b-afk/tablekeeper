DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservation_core_migration') THEN
    CREATE ROLE reservation_core_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_runtime') THEN
    CREATE ROLE core_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$migration$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS reservation_core AUTHORIZATION reservation_core_migration;
ALTER SCHEMA reservation_core OWNER TO reservation_core_migration;

REVOKE ALL ON SCHEMA reservation_core FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA reservation_core TO core_runtime;

CREATE TABLE IF NOT EXISTS reservation_core.schema_migrations (
  migration_id text PRIMARY KEY,
  file_name text NOT NULL UNIQUE,
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_by name NOT NULL DEFAULT current_user,
  contract_graph_sha256 text NOT NULL CHECK (contract_graph_sha256 ~ '^[0-9a-f]{64}$')
);
ALTER TABLE reservation_core.schema_migrations OWNER TO reservation_core_migration;
REVOKE ALL ON reservation_core.schema_migrations FROM PUBLIC;
GRANT SELECT ON reservation_core.schema_migrations TO core_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE reservation_core_migration IN SCHEMA reservation_core
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE reservation_core_migration IN SCHEMA reservation_core
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE reservation_core_migration IN SCHEMA reservation_core
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
