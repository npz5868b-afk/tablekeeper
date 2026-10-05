import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresReplanningSnapshotStore } from '../../src/replanning/postgres-snapshot.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',venueId='22222222-2222-4222-8222-222222222222';
function fixtureClient(){const calls=[];return{calls,async query(sql){calls.push(sql);if(sql.includes('table_resources'))return{rows:[{resource_id:'r1',label:'Table 1',capacity:4,active:true,version:1}]};if(sql.includes('JOIN reservation_core.reservation_allocations'))return{rows:[{reservation_id:'x1',version:2,status:'CONFIRMED',party_size:2,starts_at:'2026-10-05T11:00:00Z',ends_at:'2026-10-05T13:00:00Z',resource_id:'r1'}]};return{rowCount:1,rows:[]}},release(){}}}
test('snapshot adapter projects authoritative IDs and versions under tenant context',async()=>{const client=fixtureClient(),store=new PostgresReplanningSnapshotStore({pool:{connect:async()=>client},venueId});const state=await store.readState(tenantId);assert.equal(state.version,4);assert.equal(state.resources[0].id,'r1');assert.equal(state.reservations[0].id,'x1');assert.ok(client.calls.some(x=>x.includes("set_config('reservation_core.tenant_id'")))});
test('snapshot expected version rejects stale state',async()=>{const client=fixtureClient(),store=new PostgresReplanningSnapshotStore({pool:{connect:async()=>client},venueId});await assert.rejects(()=>store.read(client,tenantId,{expectedVersion:3,lock:true}),error=>error.code==='STALE_SNAPSHOT_VERSION')});
