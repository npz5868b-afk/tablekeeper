\set ON_ERROR_STOP on
BEGIN; SET ROLE tk_app; SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
SELECT claim_idempotency('11111111-1111-4111-8111-111111111111','CONFIRM','key-1','fingerprint-a');
SELECT pg_sleep(1); COMMIT;
