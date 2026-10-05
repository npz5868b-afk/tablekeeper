\set ON_ERROR_STOP on

DO $assert$
DECLARE
  bad_count integer;
BEGIN
  IF current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'PostgreSQL major is not 17';
  END IF;

  SELECT count(*) INTO bad_count
  FROM pg_roles
  WHERE rolname IN ('reservation_core_migration', 'core_runtime')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls);
  IF bad_count <> 0 THEN RAISE EXCEPTION 'unsafe role attributes'; END IF;

  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('reservation_core_migration', 'core_runtime') AND rolcanlogin) <> 2 THEN
    RAISE EXCEPTION 'required login roles absent';
  END IF;

  IF pg_has_role('core_runtime', 'reservation_core_migration', 'MEMBER') THEN
    RAISE EXCEPTION 'core_runtime is a member of migration role';
  END IF;

  SELECT count(*) INTO bad_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'reservation_core'
    AND c.relname IN (
      'tenants','venues','service_periods','table_resources','table_groups','table_group_members',
      'policy_versions','preparations','reservations','reservation_allocations','accepted_terms',
      'idempotency_records','domain_audit_records','outbox_events','command_attempts'
    )
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF bad_count <> 0 THEN RAISE EXCEPTION '% tenant tables lack forced RLS', bad_count; END IF;

  IF has_schema_privilege('public', 'reservation_core', 'USAGE') OR has_schema_privilege('public', 'reservation_core', 'CREATE') THEN
    RAISE EXCEPTION 'PUBLIC retains reservation_core schema privilege';
  END IF;

  IF has_table_privilege('core_runtime', 'reservation_core.policy_versions', 'UPDATE')
     OR has_table_privilege('core_runtime', 'reservation_core.accepted_terms', 'DELETE')
     OR has_table_privilege('core_runtime', 'reservation_core.domain_audit_records', 'UPDATE')
     OR has_table_privilege('core_runtime', 'reservation_core.command_attempts', 'DELETE') THEN
    RAISE EXCEPTION 'core_runtime has forbidden immutable-record privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservation_allocations_no_overlap' AND contype = 'x'
  ) THEN RAISE EXCEPTION 'allocation exclusion constraint absent'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reservation_core.idempotency_records'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%tenant_id, command_type, idempotency_key_digest%'
  ) THEN RAISE EXCEPTION 'idempotency scope unique constraint absent'; END IF;
END
$assert$;

SET ROLE core_runtime;
BEGIN;
SET LOCAL reservation_core.tenant_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO reservation_core.tenants (tenant_id, display_name, created_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'Tenant One', '2026-09-30T00:00:00Z');

DO $cross_tenant$
BEGIN
  BEGIN
    INSERT INTO reservation_core.tenants (tenant_id, display_name, created_at)
    VALUES ('22222222-2222-4222-8222-222222222222', 'Tenant Two', '2026-09-30T00:00:00Z');
    RAISE EXCEPTION 'cross-tenant insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$cross_tenant$;
ROLLBACK;
RESET ROLE;
