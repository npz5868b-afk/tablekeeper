import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmationTokenCodec, LifecycleError, ReservationService } from '../../src/lifecycle/index.mjs';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111', otherTenant: '11111111-1111-4111-8111-111111111112', venue: '22222222-2222-4222-8222-222222222222',
  group: '33333333-3333-4333-8333-333333333333', table: '44444444-4444-4444-8444-444444444444', policy: '55555555-5555-4555-8555-555555555555',
  query: '66666666-6666-4666-8666-666666666666', command: '77777777-7777-4777-8777-777777777777', correlation: '88888888-8888-4888-8888-888888888888'
};
const termsDigest = `sha256:${'a'.repeat(64)}`;
const at = '2030-01-01T18:00:00.000Z';
const timeRange = { start: '2030-01-01T19:00:00.000Z', end: '2030-01-01T20:30:00.000Z' };

class MemoryRepository {
  constructor() { this.preparations = new Map(); this.reservations = new Map(); this.idempotency = new Map(); this.blocked = false; this.failAfterWrites = false; }
  async findAvailableCandidates(tenantId, venueId) { return !this.blocked && tenantId === ids.tenant && venueId === ids.venue ? [[ids.table]] : []; }
  async getRequiredPolicy(tenantId, venueId) { return tenantId === ids.tenant && venueId === ids.venue ? { policyVersionId: ids.policy, termsDigest, termsArtifact: 'Booking terms v1' } : null; }
  async createPreparation(tenantId, input) {
    const key = `${tenantId}:PREPARE:${input.idempotencyKeyDigest}`;
    const prior = this.idempotency.get(key);
    if (prior) { if (prior.fingerprint !== input.requestFingerprint) throw new LifecycleError('IDEMPOTENCY_KEY_REUSED'); return prior.value; }
    const value = { preparationId: input.preparationId, tenantId, venueId: input.venueId, partySize: input.partySize, requestedRange: input.timeRange, resolvedResourceSnapshot: { groupId: ids.group, groupVersion: 1, resourceIds: input.resourceIds }, policyVersionIds: [input.policy.policyVersionId], termsDigest: input.policy.termsDigest, termsArtifact: input.policy.termsArtifact, createdAt: input.createdAt, expiresAt: input.expiresAt, status: 'OPEN', confirmationToken: input.confirmationToken };
    this.preparations.set(input.preparationId, structuredClone(value)); this.idempotency.set(key, { fingerprint: input.requestFingerprint, value }); return value;
  }
  async findCommandResult(tenantId, type, digest) { const prior = this.idempotency.get(`${tenantId}:${type === 'CONFIRM_RESERVATION' ? 'CONFIRM' : type}:${digest}`); return prior ? { requestFingerprint: prior.fingerprint, result: prior.value } : null; }
  async confirm(tenantId, input) {
    const key = `${tenantId}:CONFIRM:${input.idempotencyKeyDigest}`;
    const prior = this.idempotency.get(key);
    if (prior) { if (prior.fingerprint !== input.requestFingerprint) throw new LifecycleError('IDEMPOTENCY_KEY_REUSED'); return prior.value; }
    const prep = this.preparations.get(input.claims.preparationId);
    if (!prep || prep.tenantId !== tenantId) throw new LifecycleError('TOKEN_INVALID');
    if (prep.status === 'CONSUMED') throw new LifecycleError('TOKEN_CONSUMED');
    if (this.blocked) throw new LifecycleError('CONFLICT_ALLOCATION');
    const reservationId = input.reservationId();
    const reservation = { reservationId, tenantId, venueId: prep.venueId, status: 'CONFIRMED', version: 1, partySize: prep.partySize, timeRange: prep.requestedRange, occupiedRange: prep.requestedRange, resources: prep.resolvedResourceSnapshot.resourceIds.map(resourceId => ({ resourceId, resourceType: 'TABLE' })), acceptedTerms: input.acceptedTerms, createdAt: input.now, updatedAt: input.now };
    if (this.failAfterWrites) throw new LifecycleError('DEPENDENCY_UNAVAILABLE');
    prep.status = 'CONSUMED'; this.reservations.set(reservationId, reservation);
    const value = { reservationId, status: 'CONFIRMED', version: 1 };
    this.idempotency.set(key, { fingerprint: input.requestFingerprint, value }); return value;
  }
  async getReservation(tenantId, reservationId) { const value = this.reservations.get(reservationId); return value?.tenantId === tenantId ? value : null; }
  async cancel(tenantId,input){const key=`${tenantId}:CANCEL_RESERVATION:${input.idempotencyKeyDigest}`,prior=this.idempotency.get(key);if(prior){if(prior.fingerprint!==input.requestFingerprint)throw new LifecycleError('IDEMPOTENCY_KEY_REUSED');return prior.value}const reservation=this.reservations.get(input.reservationId);if(!reservation||reservation.tenantId!==tenantId)throw new LifecycleError('NOT_FOUND');reservation.status='CANCELLED';reservation.version+=1;reservation.cancelledAt=input.now;reservation.resources=[];const value={reservationId:input.reservationId,status:'CANCELLED',version:reservation.version};this.idempotency.set(key,{fingerprint:input.requestFingerprint,value});return value}
}

let sequence;
const nextId = () => `99999999-9999-4999-8999-${String(++sequence).padStart(12, '0')}`;
const query = (tenantId = ids.tenant) => ({ contract: { contractId: 'C03', contractVersion: '2.0.0' }, tenantId, queryId: ids.query, correlationId: ids.correlation, issuedAt: at, actor: { actorType: 'GUEST', actorId: 'guest-1' }, queryType: 'SEARCH_AVAILABILITY', parameters: { venueId: ids.venue, partySize: 2, requestedRange: timeRange } });
const command = (type, payload, key = 'idempotency-key-0001', tenantId = ids.tenant) => ({ contract: { contractId: 'C04', contractVersion: '2.0.0' }, tenantId, commandId: ids.command, idempotencyKey: key, correlationId: ids.correlation, issuedAt: at, actor: { actorType: 'GUEST', actorId: 'guest-1' }, commandType: type, payload });

function fixture() {
  sequence = 0;
  const repository = new MemoryRepository();
  const service = new ReservationService({ repository, tokenCodec: new ConfirmationTokenCodec(Buffer.alloc(32, 7)), clock: () => new Date(at), ids: nextId });
  return { repository, service };
}

async function prepared(service) {
  const availability = await service.searchAvailability(query());
  const selected = availability.candidates[0];
  const preparation = await service.prepare(command('PREPARE_RESERVATION', { venueId: ids.venue, partySize: 2, requestedRange: timeRange, selection: { candidateId: selected.candidateId, resourceIds: selected.resources.map(r => r.resourceId) } }));
  const acceptedTerms = [{ policyVersionId: ids.policy, termsDigest, acceptedAt: at, acceptedBy: { actorType: 'GUEST', actorId: 'guest-1' }, acceptanceChannel: 'WEB' }];
  return { availability, preparation, acceptedTerms };
}

test('complete authoritative lifecycle persists and reads back', async () => {
  const { service } = fixture(); const { availability, preparation, acceptedTerms } = await prepared(service);
  assert.equal(availability.authoritativeAtCommitOnly, true); assert.equal(preparation.status, 'OPEN');
  const confirmed = await service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001'));
  const readback = await service.getReservation({ tenantId: ids.tenant, reservationId: confirmed.result.reservationId });
  assert.equal(readback.status, 'CONFIRMED'); assert.equal(readback.reservationId, confirmed.result.reservationId);
});

test('unavailable and stale selection fail closed', async () => {
  const { service, repository } = fixture(); const availability = await service.searchAvailability(query()); repository.blocked = true;
  await assert.rejects(service.prepare(command('PREPARE_RESERVATION', { venueId: ids.venue, partySize: 2, requestedRange: timeRange, selection: { candidateId: availability.candidates[0].candidateId, resourceIds: [ids.table] } })), { code: 'STALE_RESOURCE_SNAPSHOT' });
});

test('invalid contract input fails closed', async () => { const { service } = fixture(); await assert.rejects(service.searchAvailability({}), { code: 'CONTRACT_VERSION_UNSUPPORTED' }); });

test('forged token is rejected', async () => { const { service } = fixture(); const { preparation, acceptedTerms } = await prepared(service); const forged = `${preparation.confirmationToken.slice(0,-1)}x`; await assert.rejects(service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: forged, acceptedTerms }, 'confirm-key-000001')), { code: 'TOKEN_INVALID' }); });

test('expired token is rejected', async () => { const { repository } = fixture(); sequence = 0; const service = new ReservationService({ repository, tokenCodec: new ConfirmationTokenCodec(Buffer.alloc(32,7)), clock: () => new Date('2030-01-01T18:10:00.000Z'), ids: nextId, preparationTtlMs: -1 }); const { preparation, acceptedTerms } = await prepared(service); await assert.rejects(service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001')), { code: 'TOKEN_EXPIRED' }); });

test('tenant token scope is enforced', async () => { const { service } = fixture(); const { preparation, acceptedTerms } = await prepared(service); await assert.rejects(service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001', ids.otherTenant)), { code: 'TOKEN_SCOPE_MISMATCH' }); });

test('same confirmation key and body replays logical result', async () => { const { service } = fixture(); const { preparation, acceptedTerms } = await prepared(service); const request = command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001'); const a = await service.confirm(request), b = await service.confirm(request); assert.deepEqual(b, a); });

test('confirmed reservation cancels authoritatively and repeated cancellation is idempotent',async()=>{const{service}=fixture(),{preparation,acceptedTerms}=await prepared(service),confirmed=await service.confirm(command('CONFIRM_RESERVATION',{confirmationToken:preparation.confirmationToken,acceptedTerms},'confirm-key-000001')),request=command('CANCEL_RESERVATION',{reservationId:confirmed.result.reservationId},'cancel-key-000001');const first=await service.cancel(request),repeated=await service.cancel(request),readback=await service.getReservation({tenantId:ids.tenant,reservationId:confirmed.result.reservationId});assert.deepEqual(repeated,first);assert.equal(readback.status,'CANCELLED');assert.deepEqual(readback.resources,[])});

test('idempotency key with a changed request is rejected', async () => { const { service } = fixture(); const one = await prepared(service); const request = command('CONFIRM_RESERVATION', { confirmationToken: one.preparation.confirmationToken, acceptedTerms: one.acceptedTerms }, 'confirm-key-000001'); await service.confirm(request); request.commandId = '77777777-7777-4777-8777-777777777778'; await assert.rejects(service.confirm(request), { code: 'IDEMPOTENCY_KEY_REUSED' }); });

test('reused token under a new key is rejected', async () => { const { service } = fixture(); const { preparation, acceptedTerms } = await prepared(service); await service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001')); await assert.rejects(service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000002')), { code: 'TOKEN_CONSUMED' }); });

test('concurrent confirmation has one winner', async () => { const { service } = fixture(); const { preparation, acceptedTerms } = await prepared(service); const results = await Promise.allSettled([service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001')), service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000002'))]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'TOKEN_CONSUMED').length, 1); });

test('forced failure leaves preparation open and no reservation', async () => { const { service, repository } = fixture(); const { preparation, acceptedTerms } = await prepared(service); repository.failAfterWrites = true; await assert.rejects(service.confirm(command('CONFIRM_RESERVATION', { confirmationToken: preparation.confirmationToken, acceptedTerms }, 'confirm-key-000001')), { code: 'DEPENDENCY_UNAVAILABLE' }); assert.equal(repository.preparations.get(preparation.preparationId).status, 'OPEN'); assert.equal(repository.reservations.size, 0); });

test('unknown and cross-tenant readback return NOT_FOUND', async () => { const { service } = fixture(); await assert.rejects(service.getReservation({ tenantId: ids.tenant, reservationId: ids.command }), { code: 'NOT_FOUND' }); });

test('guest dining map projects one authoritative allocation without internal identifiers',async()=>{const other='44444444-4444-4444-8444-444444444445',repository={getDiningMap:async()=>({reservation:{reservation_id:ids.command,venue_id:ids.venue,status:'CONFIRMED',party_size:2,starts_at:timeRange.start,ends_at:timeRange.end,display_name:'Basil House'},resources:[{resource_id:ids.table,label:'Table 01',capacity:2,allocated:false},{resource_id:other,label:'Table 02',capacity:4,allocated:true}]})};const map=await new ReservationService({repository,tokenCodec:{}}).getDiningMap({tenantId:ids.tenant,reservationId:ids.command});assert.equal(map.allocationEstablished,true);assert.equal(map.tables.length,2);assert.equal(map.tables.filter(x=>x.isYours).length,1);assert.equal(map.tables[1].label,'Table 02');assert.doesNotMatch(JSON.stringify(map),new RegExp(ids.table));assert.doesNotMatch(JSON.stringify(map),new RegExp(other))});

test('guest dining map fails closed without exactly one confirmed allocation',async()=>{const repository={getDiningMap:async()=>({reservation:{reservation_id:ids.command,venue_id:ids.venue,status:'CONFIRMED',party_size:2,starts_at:timeRange.start,ends_at:timeRange.end,display_name:'Basil House'},resources:[{resource_id:ids.table,label:'Table 01',capacity:2,allocated:false}]})};const map=await new ReservationService({repository,tokenCodec:{}}).getDiningMap({tenantId:ids.tenant,reservationId:ids.command});assert.equal(map.allocationEstablished,false);assert.equal(map.tables.some(x=>x.isYours),false)});
test('cancelled booking cannot expose an active table projection',async()=>{const repository={getDiningMap:async()=>({reservation:{reservation_id:ids.command,venue_id:ids.venue,status:'CANCELLED',party_size:2,starts_at:timeRange.start,ends_at:timeRange.end,display_name:'Basil House'},resources:[{resource_id:ids.table,label:'Table 01',capacity:2,allocated:false}]})};const map=await new ReservationService({repository,tokenCodec:{}}).getDiningMap({tenantId:ids.tenant,reservationId:ids.command});assert.equal(map.allocationEstablished,false);assert.equal(map.tables.some(x=>x.isYours),false)});
