import { createHash, randomUUID } from 'node:crypto';
import { LifecycleError, fail } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = value => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const candidateId = value => {
  const hex = createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = '8';
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
};

function range(value) {
  fail(value && typeof value.start === 'string' && typeof value.end === 'string', 'VALIDATION_FAILED');
  const start = new Date(value.start), end = new Date(value.end);
  fail(Number.isFinite(+start) && Number.isFinite(+end) && start < end && value.start.endsWith('Z') && value.end.endsWith('Z'), 'VALIDATION_FAILED');
  return { start: start.toISOString(), end: end.toISOString() };
}

function envelope(request, type, contractId) {
  fail(request?.contract?.contractId === contractId && request.contract.contractVersion === '2.0.0', 'CONTRACT_VERSION_UNSUPPORTED');
  fail(request?.[type === 'queryType' ? 'queryType' : 'commandType'] && UUID.test(request.tenantId) && UUID.test(request.correlationId), 'VALIDATION_FAILED');
}

export class ReservationService {
  constructor({ repository, tokenCodec, clock = () => new Date(), ids = () => randomUUID(), preparationTtlMs = 300000, buildId = 'reservation-core-local' }) {
    if (!repository || !tokenCodec) throw new TypeError('repository and tokenCodec required');
    Object.assign(this, { repository, tokenCodec, clock, ids, preparationTtlMs, buildId });
  }

  async searchAvailability(request) {
    envelope(request, 'queryType', 'C03');
    fail(request.queryType === 'SEARCH_AVAILABILITY', 'VALIDATION_FAILED');
    const { venueId, partySize, requestedRange } = request.parameters ?? {};
    fail(UUID.test(venueId) && Number.isInteger(partySize) && partySize > 0, 'VALIDATION_FAILED');
    const timeRange = range(requestedRange);
    const observedAt = this.clock().toISOString();
    const sets = await this.repository.findAvailableCandidates(request.tenantId, venueId, partySize, timeRange);
    return { tenantId: request.tenantId, venueId, candidates: sets.map(resourceIds => ({ candidateId: candidateId({ tenantId: request.tenantId, venueId, partySize, timeRange, resourceIds }), resources: resourceIds.map(resourceId => ({ resourceId, resourceType: 'TABLE' })), timeRange, advisory: true, observedAt })), authoritativeAtCommitOnly: true };
  }

  async prepare(request) {
    envelope(request, 'commandType', 'C04');
    fail(request.commandType === 'PREPARE_RESERVATION' && UUID.test(request.commandId) && typeof request.idempotencyKey === 'string' && request.idempotencyKey.length >= 16, 'VALIDATION_FAILED');
    const { venueId, partySize, requestedRange, selection } = request.payload ?? {};
    fail(UUID.test(venueId) && Number.isInteger(partySize) && partySize > 0 && UUID.test(selection?.candidateId) && Array.isArray(selection.resourceIds) && selection.resourceIds.length > 0 && selection.resourceIds.every(id => UUID.test(id)), 'VALIDATION_FAILED');
    const timeRange = range(requestedRange);
    const available = await this.searchAvailability({ contract: { contractId: 'C03', contractVersion: '2.0.0' }, tenantId: request.tenantId, queryId: request.commandId, correlationId: request.correlationId, issuedAt: request.issuedAt, actor: request.actor, queryType: 'SEARCH_AVAILABILITY', parameters: { venueId, partySize, requestedRange: timeRange } });
    const selected = available.candidates.find(c => c.candidateId === selection.candidateId && canonical(c.resources.map(r => r.resourceId)) === canonical(selection.resourceIds));
    if (!selected) throw new LifecycleError('STALE_RESOURCE_SNAPSHOT');
    const policy = await this.repository.getRequiredPolicy(request.tenantId, venueId);
    if (!policy) throw new LifecycleError('POLICY_VERSION_NOT_FOUND');
    const now = this.clock(), expiresAt = new Date(+now + this.preparationTtlMs);
    const preparationId = this.ids();
    const claims = { tokenId: this.ids(), tenantId: request.tenantId, venueId, preparationId, partySize, timeRange, proposedResourceIds: selection.resourceIds, policyVersionIds: [policy.policyVersionId], termsDigest: policy.termsDigest, issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
    const confirmationToken = this.tokenCodec.issue(claims);
    return this.repository.createPreparation(request.tenantId, { preparationId, venueId, partySize, timeRange, resourceIds: selection.resourceIds, policy, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), confirmationToken, idempotencyKeyDigest: digest(request.idempotencyKey), requestFingerprint: digest(request), commandType: request.commandType });
  }

  async confirm(request) {
    envelope(request, 'commandType', 'C04');
    fail(request.commandType === 'CONFIRM_RESERVATION' && UUID.test(request.commandId) && typeof request.idempotencyKey === 'string' && request.idempotencyKey.length >= 16, 'VALIDATION_FAILED');
    const { confirmationToken, acceptedTerms } = request.payload ?? {};
    fail(typeof confirmationToken === 'string' && confirmationToken.length >= 32 && Array.isArray(acceptedTerms) && acceptedTerms.length > 0, 'VALIDATION_FAILED');
    const idempotencyKeyDigest = digest(request.idempotencyKey);
    const requestFingerprint = digest(request);
    const replay = await this.repository.findCommandResult?.(request.tenantId, 'CONFIRM_RESERVATION', idempotencyKeyDigest);
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) throw new LifecycleError('IDEMPOTENCY_KEY_REUSED');
      return { ok: true, correlationId: request.correlationId, contract: { contractId: 'C04', contractVersion: '2.0.0' }, result: replay.result };
    }
    const claims = this.tokenCodec.verify(confirmationToken, { tenantId: request.tenantId, now: this.clock() });
    fail(acceptedTerms.length === claims.policyVersionIds.length && acceptedTerms.every(term => claims.policyVersionIds.includes(term.policyVersionId) && term.termsDigest === claims.termsDigest), 'TERMS_NOT_ACCEPTED');
    const result = await this.repository.confirm(request.tenantId, { claims, acceptedTerms, command: request, now: this.clock().toISOString(), idempotencyKeyDigest, requestFingerprint, buildId: this.buildId, reservationId: this.ids, eventId: this.ids });
    return { ok: true, correlationId: request.correlationId, contract: { contractId: 'C04', contractVersion: '2.0.0' }, result };
  }

  async cancel(request) {
    envelope(request,'commandType','C04');
    fail(request.commandType==='CANCEL_RESERVATION'&&UUID.test(request.commandId)&&typeof request.idempotencyKey==='string'&&request.idempotencyKey.length>=16,'VALIDATION_FAILED');
    const reservationId=request.payload?.reservationId;
    fail(UUID.test(reservationId),'VALIDATION_FAILED');
    const idempotencyKeyDigest=digest(request.idempotencyKey),requestFingerprint=digest(request);
    const replay=await this.repository.findCommandResult?.(request.tenantId,'CANCEL_RESERVATION',idempotencyKeyDigest);
    if(replay){if(replay.requestFingerprint!==requestFingerprint)throw new LifecycleError('IDEMPOTENCY_KEY_REUSED');return{ok:true,correlationId:request.correlationId,contract:{contractId:'C04',contractVersion:'2.0.0'},result:replay.result};}
    const result=await this.repository.cancel(request.tenantId,{reservationId,command:request,now:this.clock().toISOString(),idempotencyKeyDigest,requestFingerprint,buildId:this.buildId,eventId:this.ids});
    return{ok:true,correlationId:request.correlationId,contract:{contractId:'C04',contractVersion:'2.0.0'},result};
  }

  async getReservation({ tenantId, reservationId, actorId }) {
    fail(UUID.test(tenantId) && UUID.test(reservationId), 'VALIDATION_FAILED');
    const reservation = await this.repository.getReservation(tenantId, reservationId, actorId);
    if (!reservation) throw new LifecycleError('NOT_FOUND');
    return reservation;
  }

  async getDiningMap({tenantId,reservationId,actorId}){
    fail(UUID.test(tenantId)&&UUID.test(reservationId),'VALIDATION_FAILED');
    const snapshot=await this.repository.getDiningMap(tenantId,reservationId,actorId);
    if(!snapshot)throw new LifecycleError('NOT_FOUND');
    const r=snapshot.reservation,allocated=snapshot.resources.filter(resource=>resource.allocated===true);
    const established=r.status==='CONFIRMED'&&allocated.length===1;
    return {status:r.status,venueName:r.display_name,partySize:Number(r.party_size),timeRange:{start:new Date(r.starts_at).toISOString(),end:new Date(r.ends_at).toISOString()},allocationEstablished:established,tables:snapshot.resources.map(resource=>({tableKey:createHash('sha256').update(`dining-map|${tenantId}|${r.venue_id}|${resource.resource_id}`).digest('hex').slice(0,16),label:resource.label,capacity:Number(resource.capacity),isYours:established&&resource.allocated===true}))};
  }
}
