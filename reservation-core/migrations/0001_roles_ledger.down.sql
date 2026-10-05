REVOKE ALL ON reservation_core.schema_migrations FROM core_runtime;
DROP TABLE IF EXISTS reservation_core.schema_migrations;
DROP SCHEMA IF EXISTS reservation_core;
DROP OWNED BY core_runtime;
DROP OWNED BY reservation_core_migration;
DROP ROLE IF EXISTS core_runtime;
DROP ROLE IF EXISTS reservation_core_migration;
