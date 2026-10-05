import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { ConfirmationTokenCodec, PostgresReservationRepository, ReservationService } from '../../src/lifecycle/index.mjs';
import { PostgresReplanningSnapshotStore } from '../../src/replanning/postgres-snapshot.mjs';
import authorityConfig from '../../../platform/restaurant-authority.json' with { type:'json' };

const databaseUrl=process.env.TK_INTEGRATION_DATABASE_URL;
if(!databaseUrl)throw new Error('TK_INTEGRATION_DATABASE_URL must identify a migrated, seeded disposable PostgreSQL database');

const tenantId='10000000-0000-4000-8000-000000000001';
const venues=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000018'];
const pool=new pg.Pool({connectionString:databaseUrl,max:4});
const repository=new PostgresReservationRepository(pool);
const service=new ReservationService({repository,tokenCodec:new ConfirmationTokenCodec(Buffer.alloc(32,17)),buildId:'multi-venue-postgres-test'});

const futureRange=(days=2)=>{const now=Date.now(),local=new Date(now+8*3600_000+days*86400_000);const start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),11,0));return{start:start.toISOString(),end:new Date(+start+90*60_000).toISOString()};};
const actor={actorType:'GUEST',actorId:'postgres-integration-guest'};
const searchRequest=(venueId,partySize,requestedRange)=>({contract:{contractId:'C03',contractVersion:'2.0.0'},tenantId,queryId:randomUUID(),correlationId:randomUUID(),issuedAt:new Date().toISOString(),actor,queryType:'SEARCH_AVAILABILITY',parameters:{venueId,partySize,requestedRange}});
const command=(commandType,payload)=>({contract:{contractId:'C04',contractVersion:'2.0.0'},tenantId,commandId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),issuedAt:new Date().toISOString(),actor,commandType,payload});
const prepareCandidate=async(venueId,partySize,requestedRange,candidate)=>service.prepare(command('PREPARE_RESERVATION',{venueId,partySize,requestedRange,selection:{candidateId:candidate.candidateId,resourceIds:candidate.resources.map(x=>x.resourceId)}}));
const confirmPreparation=async preparation=>{
  const acceptedTerms=preparation.policyVersionIds.map(policyVersionId=>({policyVersionId,termsDigest:preparation.termsDigest,acceptedAt:new Date().toISOString(),acceptedBy:actor,acceptanceChannel:'WEB'}));
  return service.confirm(command('CONFIRM_RESERVATION',{confirmationToken:preparation.confirmationToken,acceptedTerms}));
};
const withTenantRead=async work=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('reservation_core.tenant_id', $1, true)",[tenantId]);
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{client.release()}
};
const activeResourcesForReservation=async reservationId=>(await withTenantRead(client=>client.query(`SELECT resource_id FROM reservation_core.reservation_allocations WHERE tenant_id=$1 AND reservation_id=$2 AND released_at IS NULL ORDER BY resource_id`,[tenantId,reservationId]))).rows.map(row=>row.resource_id);

test.before(async()=>{
  const clean=await withTenantRead(client=>client.query(`SELECT
    (SELECT count(*)::int FROM reservation_core.reservations WHERE tenant_id=$1) reservation_count,
    (SELECT count(*)::int FROM reservation_core.reservation_allocations WHERE tenant_id=$1) allocation_count`,[tenantId]));
  assert.deepEqual(clean.rows[0],{reservation_count:0,allocation_count:0},'TK_INTEGRATION_DATABASE_URL must identify a freshly migrated and seeded disposable database with no reservations or allocations');
});

test.after(()=>pool.end());

test('real PostgreSQL completes independent lifecycles at two non-Kumo venues',async()=>{
  const requestedRange=futureRange(),confirmed=[];
  for(const venueId of venues){
    const availability=await service.searchAvailability(searchRequest(venueId,2,requestedRange));
    assert.equal(availability.venueId,venueId);assert.ok(availability.candidates.length>0);
    const candidate=availability.candidates[0];
    const preparation=await service.prepare(command('PREPARE_RESERVATION',{venueId,partySize:2,requestedRange,selection:{candidateId:candidate.candidateId,resourceIds:candidate.resources.map(x=>x.resourceId)}}));
    assert.equal(preparation.venueId,venueId);
    const acceptedTerms=preparation.policyVersionIds.map(policyVersionId=>({policyVersionId,termsDigest:preparation.termsDigest,acceptedAt:new Date().toISOString(),acceptedBy:actor,acceptanceChannel:'WEB'}));
    const confirmation=await service.confirm(command('CONFIRM_RESERVATION',{confirmationToken:preparation.confirmationToken,acceptedTerms}));
    const readback=await service.getReservation({tenantId,reservationId:confirmation.result.reservationId});
    assert.equal(readback.status,'CONFIRMED');confirmed.push({readback,resources:await activeResourcesForReservation(confirmation.result.reservationId)});
  }
  assert.notDeepEqual(confirmed[0].resources,confirmed[1].resources);
  const after=await service.searchAvailability(searchRequest(venues[0],2,requestedRange));
  const occupied=new Set(confirmed[0].resources);
  assert.ok(after.candidates.every(candidate=>candidate.resources.every(resource=>!occupied.has(resource.resourceId))));
});

test('real PostgreSQL rejects past and outside-hours searches',async()=>{
  const past={start:'2020-01-01T11:00:00.000Z',end:'2020-01-01T12:30:00.000Z'};
  assert.deepEqual((await service.searchAvailability(searchRequest(venues[0],2,past))).candidates,[]);
  const valid=futureRange(),day=valid.start.slice(0,10),outside={start:`${day}T01:00:00.000Z`,end:`${day}T02:00:00.000Z`};
  assert.deepEqual((await service.searchAvailability(searchRequest(venues[0],2,outside))).candidates,[]);
});

test('three occupied suitable tables fully saturate overlapping SEARCH',async()=>{
  const venueId='20000000-0000-4000-8000-000000000013',requestedRange=futureRange(4),allocated=new Set();
  for(const expectedLabel of ['Table 01','Table 02','Table 03']){
    const availability=await service.searchAvailability(searchRequest(venueId,2,requestedRange));
    assert.ok(availability.candidates.length>0,`${expectedLabel} must be available before it is occupied`);
    const candidate=availability.candidates[0];
    assert.equal(candidate.resources.length,1);
    const prepared=await prepareCandidate(venueId,2,requestedRange,candidate);
    const confirmed=await confirmPreparation(prepared);
    const readback=await service.getReservation({tenantId,reservationId:confirmed.result.reservationId});
    allocated.add((await activeResourcesForReservation(confirmed.result.reservationId))[0]);
  }
  assert.equal(allocated.size,3);
  const saturated=await service.searchAvailability(searchRequest(venueId,2,requestedRange));
  assert.deepEqual(saturated.candidates,[]);
});

test('last-table concurrent confirmation permits at most one allocation',async()=>{
  const venueId='20000000-0000-4000-8000-000000000003',requestedRange=futureRange(5),partySize=8;
  const [leftSearch,rightSearch]=await Promise.all([
    service.searchAvailability(searchRequest(venueId,partySize,requestedRange)),
    service.searchAvailability(searchRequest(venueId,partySize,requestedRange))
  ]);
  assert.equal(leftSearch.candidates.length,1);assert.equal(rightSearch.candidates.length,1);
  assert.deepEqual(leftSearch.candidates[0].resources,rightSearch.candidates[0].resources);
  // PREPARE is intentionally sequential: both clients retain the same advisory
  // SEARCH observation, while the concurrency boundary under proof is CONFIRM.
  const leftPreparation=await prepareCandidate(venueId,partySize,requestedRange,leftSearch.candidates[0]);
  const rightPreparation=await prepareCandidate(venueId,partySize,requestedRange,rightSearch.candidates[0]);
  const outcomes=await Promise.allSettled([confirmPreparation(leftPreparation),confirmPreparation(rightPreparation)]);
  const winners=outcomes.filter(outcome=>outcome.status==='fulfilled'),losers=outcomes.filter(outcome=>outcome.status==='rejected');
  assert.equal(winners.length,1);assert.equal(losers.length,1);
  assert.ok(['CONFLICT_ALLOCATION','CONFLICT_STATE'].includes(losers[0].reason.code));
  const client=await pool.connect();
  try{
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('reservation_core.tenant_id', $1, true)",[tenantId]);
    const result=await client.query(`SELECT count(DISTINCT r.reservation_id)::int reservation_count,count(a.allocation_id)::int allocation_count FROM reservation_core.reservations r JOIN reservation_core.reservation_allocations a ON a.tenant_id=r.tenant_id AND a.reservation_id=r.reservation_id AND a.released_at IS NULL WHERE r.tenant_id=$1 AND r.venue_id=$2 AND tstzrange(r.starts_at,r.ends_at,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)')`,[tenantId,venueId,requestedRange.start,requestedRange.end]);
    assert.deepEqual(result.rows[0],{reservation_count:1,allocation_count:1});
    await client.query('ROLLBACK');
  }finally{client.release()}
  const after=await service.searchAvailability(searchRequest(venueId,partySize,requestedRange));
  assert.deepEqual(after.candidates,[]);
});

test('all 24 venues have Guest and Staff capability parity with venue isolation',async()=>{
  const facts=await withTenantRead(client=>client.query(`SELECT v.venue_id,v.display_name,v.time_zone,count(DISTINCT r.resource_id)::int active_resources,array_agg(DISTINCT r.capacity ORDER BY r.capacity) capacities,count(DISTINCT h.service_hours_id)::int service_hours,min(h.day_of_week)::int sample_day,min(h.opens_at)::text sample_open,min(h.closes_at)::text sample_close FROM reservation_core.venues v JOIN reservation_core.table_resources r ON r.tenant_id=v.tenant_id AND r.venue_id=v.venue_id AND r.active JOIN reservation_core.venue_service_hours h ON h.tenant_id=v.tenant_id AND h.venue_id=v.venue_id AND h.active WHERE v.tenant_id=$1 GROUP BY v.venue_id,v.display_name,v.time_zone ORDER BY v.display_name`,[tenantId]));
  assert.equal(facts.rowCount,24);assert.equal(authorityConfig.restaurants.length,24);
  const fixtureByVenue=new Map(authorityConfig.restaurants.map(item=>[item.venueId,item]));
  const matrix=[];
  for(const row of facts.rows){
    const configured=fixtureByVenue.get(row.venue_id);assert.ok(configured,`missing catalog mapping for ${row.display_name}`);
    assert.equal(configured.name,row.display_name);assert.equal(row.time_zone,'Asia/Kuala_Lumpur');assert.ok(row.active_resources>0);assert.ok(row.service_hours>0);
    assert.deepEqual(row.capacities.map(Number),[...new Set(configured.capacities)].sort((a,b)=>a-b));
    const localNow=new Date(Date.now()+8*3600_000),base=new Date(Date.UTC(localNow.getUTCFullYear(),localNow.getUTCMonth(),localNow.getUTCDate()+10));
    const delta=(row.sample_day-base.getUTCDay()+7)%7,[hour,minute]=row.sample_open.split(':').map(Number);
    const start=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate()+delta,hour-8,minute));
    const requestedRange={start:start.toISOString(),end:new Date(+start+2*3600_000).toISOString()};
    const availability=await service.searchAvailability(searchRequest(row.venue_id,2,requestedRange));
    assert.equal(availability.venueId,row.venue_id);assert.ok(availability.candidates.length>0,`${row.display_name} must expose authoritative Guest availability`);
    const snapshot=await new PostgresReplanningSnapshotStore({pool,venueId:row.venue_id,buildId:'venue-parity'}).readState(tenantId);
    assert.equal(snapshot.venueId,row.venue_id);assert.equal(snapshot.resources.filter(resource=>resource.active).length,row.active_resources);
    assert.deepEqual(snapshot.resources.map(resource=>resource.capacity).sort((a,b)=>a-b),[...configured.capacities].sort((a,b)=>a-b));
    assert.ok(snapshot.reservations.every(reservation=>snapshot.resources.some(resource=>resource.id===reservation.resourceId)));
    matrix.push({catalogId:configured.catalogId,venue:row.display_name,venueId:row.venue_id,resources:row.active_resources,serviceHours:row.service_hours,guestSearch:'PASS',staffFloor:'PASS'});
  }
  assert.equal(new Set(matrix.map(item=>item.catalogId)).size,24);assert.equal(new Set(matrix.map(item=>item.venueId)).size,24);
  const aegean=await new PostgresReplanningSnapshotStore({pool,venueId:'20000000-0000-4000-8000-000000000018',buildId:'isolation'}).readState(tenantId);
  const kumo=await new PostgresReplanningSnapshotStore({pool,venueId:'10000000-0000-4000-8000-000000000012',buildId:'isolation'}).readState(tenantId);
  const basil=await new PostgresReplanningSnapshotStore({pool,venueId:'20000000-0000-4000-8000-000000000007',buildId:'isolation'}).readState(tenantId);
  assert.equal(aegean.reservations.length,1);assert.equal(kumo.reservations.length,0);assert.equal(basil.reservations.length,0);
  const tableOnes=await withTenantRead(client=>client.query(`SELECT count(*)::int total,count(DISTINCT resource_id)::int distinct_resources,count(DISTINCT venue_id)::int distinct_venues FROM reservation_core.table_resources WHERE tenant_id=$1 AND label='Table 01'`,[tenantId]));
  assert.deepEqual(tableOnes.rows[0],{total:24,distinct_resources:24,distinct_venues:24});
  process.stdout.write(`VENUE_PARITY_MATRIX ${JSON.stringify(matrix)}\n`);
});
