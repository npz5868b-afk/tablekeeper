#!/bin/sh
set -eu
mkdir -p /evidence/raw
psql -v ON_ERROR_STOP=1 -f /proof/setup.sql > /evidence/raw/postgres-setup.txt 2>&1
set +e
psql -v ON_ERROR_STOP=1 -f /proof/allocation-a.sql > /evidence/raw/allocation-a.txt 2>&1 & pa=$!
sleep 0.3
psql -v ON_ERROR_STOP=1 -f /proof/allocation-b.sql > /evidence/raw/allocation-b.txt 2>&1 & pb=$!
wait $pa; sa=$?; wait $pb; sb=$?
set -e
allocation_count=$(psql -Atc "select count(*) from allocation")
allocation_exclusion=false; [ "$allocation_count" = "1" ] && { [ "$sa" = "0" ] || [ "$sb" = "0" ]; } && { [ "$sa" != "0" ] || [ "$sb" != "0" ]; } && allocation_exclusion=true
set +e
psql -v ON_ERROR_STOP=1 -c "begin; set role tk_app; select set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true); insert into allocation values('11111111-1111-4111-8111-111111111111','a3111111-1111-4111-8111-111111111111','71211111-1111-4111-8111-111111111111','[2026-10-01 11:00Z,2026-10-01 12:00Z)'); insert into allocation values('11111111-1111-4111-8111-111111111111','a4111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','[2026-10-01 11:30Z,2026-10-01 12:30Z)'); commit" > /evidence/raw/group-atomicity.txt 2>&1
sg=$?
set -e
group_partial=$(psql -Atc "select count(*) from allocation where resource_id='71211111-1111-4111-8111-111111111111'")
group_atomicity=false; [ "$sg" != "0" ] && [ "$group_partial" = "0" ] && group_atomicity=true
psql -v ON_ERROR_STOP=1 -f /proof/idempotency-a.sql > /evidence/raw/idempotency-a.txt 2>&1 & ia=$!
sleep 0.2
psql -v ON_ERROR_STOP=1 -f /proof/idempotency-b.sql > /evidence/raw/idempotency-b.txt 2>&1 & ib=$!
wait $ia; wait $ib
idempotency_count=$(psql -Atc "select count(*) from idempotency where key_digest='key-1'")
idempotency_same_key=false; [ "$idempotency_count" = "1" ] && idempotency_same_key=true
set +e
psql -v ON_ERROR_STOP=1 -c "begin; set role tk_app; select set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true); select claim_idempotency('11111111-1111-4111-8111-111111111111','CONFIRM','key-1','fingerprint-b'); commit" > /evidence/raw/idempotency-mismatch.txt 2>&1
sm=$?
psql -v ON_ERROR_STOP=1 -c "begin; insert into reservation values('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',1); insert into outbox values('11111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111'); select 1/0; commit" > /evidence/raw/outbox-rollback.txt 2>&1
so=$?
set -e
idempotency_mismatch=false; [ "$sm" != "0" ] && grep -q IDEMPOTENCY_KEY_REUSED /evidence/raw/idempotency-mismatch.txt && idempotency_mismatch=true
rollback_count=$(psql -Atc "select (select count(*) from reservation)+(select count(*) from outbox)")
outbox_atomicity=false; [ "$so" != "0" ] && [ "$rollback_count" = "0" ] && outbox_atomicity=true
rls_rows=$(psql -qAtc "begin; set role tk_app; select set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true); select count(*) from allocation; rollback")
rls_isolation=false; [ "$(printf '%s' "$rls_rows" | tail -n 1)" = "0" ] && rls_isolation=true
rls_join=$(psql -qAtc "begin; set role tk_app; select set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true); select count(*) from tenant_resource r join allocation a using(tenant_id,resource_id); rollback")
rls_join_isolation=false; [ "$(printf '%s' "$rls_join" | tail -n 1)" = "0" ] && rls_join_isolation=true
set +e
psql -v ON_ERROR_STOP=1 -c "begin; set role tk_app; select set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true); insert into allocation values('11111111-1111-4111-8111-111111111111','a5111111-1111-4111-8111-111111111111','71211111-1111-4111-8111-111111111111','[2026-10-02 11:00Z,2026-10-02 12:00Z)'); commit" > /evidence/raw/rls-cross-tenant-write.txt 2>&1
srw=$?
set -e
rls_write_isolation=false; [ "$srw" != "0" ] && rls_write_isolation=true
pool_reset=$(psql -qAtc "begin; select set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true); commit; select coalesce(nullif(current_setting('app.tenant_id',true),''),'RESET')")
pool_context_reset=false; [ "$(printf '%s' "$pool_reset" | tail -n 1)" = "RESET" ] && pool_context_reset=true
postgres17=false; psql -Atc "show server_version" | grep -q '^17\.' && postgres17=true
printf '{"postgresVersion17":%s,"assertions":{"allocationExclusion":%s,"groupAllocationAtomicity":%s,"idempotencySameKeyReplay":%s,"idempotencyMismatchRejected":%s,"outboxAtomicity":%s,"rlsReadIsolation":%s,"rlsJoinIsolation":%s,"rlsWriteIsolation":%s,"pooledContextReset":%s}}\n' "$postgres17" "$allocation_exclusion" "$group_atomicity" "$idempotency_same_key" "$idempotency_mismatch" "$outbox_atomicity" "$rls_isolation" "$rls_join_isolation" "$rls_write_isolation" "$pool_context_reset" > /evidence/raw/postgres-results.json
if grep -q ':false' /evidence/raw/postgres-results.json; then
  exit 1
fi
exit 0
