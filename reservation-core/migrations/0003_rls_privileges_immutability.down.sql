SET ROLE reservation_core_migration;
SET search_path = reservation_core, pg_catalog;

REVOKE ALL ON ALL TABLES IN SCHEMA reservation_core FROM core_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reservation_core FROM core_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA reservation_core FROM core_runtime;

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'venues', 'service_periods', 'table_resources', 'table_groups',
    'table_group_members', 'policy_versions', 'preparations', 'reservations',
    'reservation_allocations', 'accepted_terms', 'idempotency_records',
    'domain_audit_records', 'outbox_events', 'command_attempts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON reservation_core.%I', table_name);
    EXECUTE format('ALTER TABLE reservation_core.%I DISABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$rls$;

DROP TRIGGER IF EXISTS command_attempts_immutable ON command_attempts;
DROP TRIGGER IF EXISTS domain_audit_records_immutable ON domain_audit_records;
DROP TRIGGER IF EXISTS accepted_terms_immutable ON accepted_terms;
DROP TRIGGER IF EXISTS policy_versions_immutable ON policy_versions;
DROP FUNCTION IF EXISTS reservation_core.reject_immutable_change();
DROP FUNCTION IF EXISTS reservation_core.current_tenant_id();

RESET ROLE;
