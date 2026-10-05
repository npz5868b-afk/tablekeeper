\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN CREATE ROLE tk_app NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE tenant_resource(tenant_id uuid NOT NULL, resource_id uuid NOT NULL, PRIMARY KEY(tenant_id,resource_id));
CREATE TABLE allocation(tenant_id uuid NOT NULL, allocation_id uuid NOT NULL, resource_id uuid NOT NULL, occupied tstzrange NOT NULL, PRIMARY KEY(tenant_id,allocation_id), FOREIGN KEY(tenant_id,resource_id) REFERENCES tenant_resource, EXCLUDE USING gist(tenant_id WITH =,resource_id WITH =,occupied WITH &&));
CREATE TABLE idempotency(tenant_id uuid NOT NULL, command_type text NOT NULL, key_digest text NOT NULL, fingerprint text NOT NULL, status text NOT NULL, logical_result jsonb, PRIMARY KEY(tenant_id,command_type,key_digest));
CREATE TABLE reservation(tenant_id uuid NOT NULL, reservation_id uuid NOT NULL, version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,reservation_id));
CREATE TABLE outbox(tenant_id uuid NOT NULL, event_id uuid NOT NULL, reservation_id uuid NOT NULL, PRIMARY KEY(tenant_id,event_id));
ALTER TABLE tenant_resource ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_resource FORCE ROW LEVEL SECURITY;
ALTER TABLE allocation ENABLE ROW LEVEL SECURITY; ALTER TABLE allocation FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency ENABLE ROW LEVEL SECURITY; ALTER TABLE idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE reservation ENABLE ROW LEVEL SECURITY; ALTER TABLE reservation FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY; ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_resource_rls ON tenant_resource USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY allocation_rls ON allocation USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY idempotency_rls ON idempotency USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY reservation_rls ON reservation USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY outbox_rls ON outbox USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tk_app;
CREATE OR REPLACE FUNCTION claim_idempotency(p_tenant uuid,p_type text,p_key text,p_fingerprint text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE existing text;
BEGIN
  INSERT INTO idempotency VALUES(p_tenant,p_type,p_key,p_fingerprint,'IN_PROGRESS',NULL) ON CONFLICT DO NOTHING;
  SELECT fingerprint INTO existing FROM idempotency WHERE tenant_id=p_tenant AND command_type=p_type AND key_digest=p_key;
  IF existing<>p_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN CASE WHEN existing=p_fingerprint THEN 'CLAIM_OR_REPLAY' ELSE 'ERROR' END;
END $$;
GRANT EXECUTE ON FUNCTION claim_idempotency(uuid,text,text,text) TO tk_app;
INSERT INTO tenant_resource VALUES
('11111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111'),
('11111111-1111-4111-8111-111111111111','71211111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222');
