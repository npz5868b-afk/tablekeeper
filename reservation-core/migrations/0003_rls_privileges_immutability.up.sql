SET ROLE reservation_core_migration;
SET search_path = reservation_core, pg_catalog;

CREATE FUNCTION reservation_core.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('reservation_core.tenant_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION reservation_core.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reservation_core.current_tenant_id() TO core_runtime;

CREATE FUNCTION reservation_core.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%s rows are immutable', TG_TABLE_NAME);
END
$$;

REVOKE ALL ON FUNCTION reservation_core.reject_immutable_change() FROM PUBLIC;

CREATE TRIGGER policy_versions_immutable
BEFORE UPDATE OR DELETE ON policy_versions
FOR EACH ROW EXECUTE FUNCTION reservation_core.reject_immutable_change();

CREATE TRIGGER accepted_terms_immutable
BEFORE UPDATE OR DELETE ON accepted_terms
FOR EACH ROW EXECUTE FUNCTION reservation_core.reject_immutable_change();

CREATE TRIGGER domain_audit_records_immutable
BEFORE UPDATE OR DELETE ON domain_audit_records
FOR EACH ROW EXECUTE FUNCTION reservation_core.reject_immutable_change();

CREATE TRIGGER command_attempts_immutable
BEFORE UPDATE OR DELETE ON command_attempts
FOR EACH ROW EXECUTE FUNCTION reservation_core.reject_immutable_change();

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
    EXECUTE format('ALTER TABLE reservation_core.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE reservation_core.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON reservation_core.%I USING (tenant_id = reservation_core.current_tenant_id()) WITH CHECK (tenant_id = reservation_core.current_tenant_id())',
      table_name
    );
  END LOOP;
END
$rls$;

REVOKE ALL ON ALL TABLES IN SCHEMA reservation_core FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reservation_core FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA reservation_core FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON tenants, venues, service_periods, table_resources, table_groups,
  table_group_members, preparations, reservations, reservation_allocations, idempotency_records
  TO core_runtime;
GRANT SELECT, INSERT ON policy_versions, accepted_terms, domain_audit_records, command_attempts
  TO core_runtime;
GRANT SELECT, INSERT ON outbox_events TO core_runtime;
GRANT UPDATE (published_at) ON outbox_events TO core_runtime;
GRANT EXECUTE ON FUNCTION reservation_core.current_tenant_id() TO core_runtime;

RESET ROLE;
