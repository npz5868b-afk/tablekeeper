import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReservationHttpHandler } from '../../src/http/app.mjs';
import { LifecycleError } from '../../src/lifecycle/index.mjs';

const origin = 'http://localhost:4173';
const tenantId = '11111111-1111-4111-8111-111111111111';
const reservationId = '22222222-2222-4222-8222-222222222222';
const actor = { actorType: 'GUEST', actorId: 'guest-1' };
const trustedHeaders = { Origin: origin, Authorization: 'Bearer local-test-token' };
const envelope = extra => ({ tenantId, actor, correlationId: '33333333-3333-4333-8333-333333333333', ...extra });

async function withServer(service, work) {
  const resolveTrustedContext = request => request.headers.authorization === 'Bearer local-test-token' ? { tenantId, actor } : null;
  const server = createServer(createReservationHttpHandler({ service, resolveTrustedContext, allowedOrigin: origin }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const service = {
  async searchAvailability(body) { return { tenantId: body.tenantId, venueId: body.parameters.venueId, candidates: [], authoritativeAtCommitOnly: true }; },
  async prepare(body) { return { preparationId: '44444444-4444-4444-8444-444444444444', tenantId: body.tenantId }; },
  async confirm(body) { return { ok: true, correlationId: body.correlationId, contract: body.contract, result: { reservationId, status: 'CONFIRMED', version: 1 } }; },
  async cancel(body){return{ok:true,correlationId:body.correlationId,contract:body.contract,result:{reservationId,status:'CANCELLED',version:2}}},
  async getReservation({ tenantId: value }) { return { reservationId, tenantId: value, status: 'CONFIRMED' }; }
};

test('routes exact four Contract 2.0.0 operations without transforming success bodies', async () => withServer(service, async base => {
  const availability = envelope({ contract: { contractId: 'C03', contractVersion: '2.0.0' }, queryType: 'SEARCH_AVAILABILITY', parameters: { venueId: reservationId } });
  let response = await fetch(`${base}/v1/availability/search`, { method: 'POST', headers: { ...trustedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(availability) });
  assert.equal(response.status, 200); assert.equal((await response.json()).authoritativeAtCommitOnly, true);
  const preparation = envelope({ contract: { contractId: 'C04', contractVersion: '2.0.0' }, commandType: 'PREPARE_RESERVATION', idempotencyKey: 'prepare-key-00001' });
  response = await fetch(`${base}/v1/reservation-preparations`, { method: 'POST', headers: { ...trustedHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': preparation.idempotencyKey }, body: JSON.stringify(preparation) });
  assert.equal(response.status, 200); assert.equal((await response.json()).preparationId, '44444444-4444-4444-8444-444444444444');
  const confirmation = { ...preparation, commandType: 'CONFIRM_RESERVATION', idempotencyKey: 'confirm-key-00001' };
  response = await fetch(`${base}/v1/reservations:confirm`, { method: 'POST', headers: { ...trustedHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': confirmation.idempotencyKey }, body: JSON.stringify(confirmation) });
  assert.equal(response.status, 200); assert.equal((await response.json()).result.reservationId, reservationId);
  const cancellation={...preparation,commandType:'CANCEL_RESERVATION',idempotencyKey:'cancel-key-000001',payload:{reservationId}};
  response=await fetch(`${base}/v1/reservations/${reservationId}:cancel`,{method:'POST',headers:{...trustedHeaders,'Content-Type':'application/json','Idempotency-Key':cancellation.idempotencyKey},body:JSON.stringify(cancellation)});assert.equal(response.status,200);assert.equal((await response.json()).result.status,'CANCELLED');
  response = await fetch(`${base}/v1/reservations/${reservationId}`, { headers: trustedHeaders });
  assert.equal(response.status, 200); assert.equal((await response.json()).reservationId, reservationId);
}));

test('CORS permits only configured frontend origin and supports preflight', async () => withServer(service, async base => {
  let response = await fetch(`${base}/v1/availability/search`, { method: 'OPTIONS', headers: { Origin: origin } });
  assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), origin);
  response = await fetch(`${base}/v1/availability/search`, { method: 'OPTIONS', headers: { Origin: 'http://evil.invalid' } });
  assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
}));

test('missing trusted context and body/header mismatch fail closed', async () => withServer(service, async base => {
  let response = await fetch(`${base}/v1/availability/search`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401); assert.equal((await response.json()).code, 'AUTH_REQUIRED');
  const body = envelope({ tenantId: '11111111-1111-4111-8111-111111111112' });
  response = await fetch(`${base}/v1/availability/search`, { method: 'POST', headers: { ...trustedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'TENANT_SCOPE_VIOLATION');
}));

test('Idempotency-Key must match accepted command envelope', async () => withServer(service, async base => {
  const body = envelope({ commandType: 'CONFIRM_RESERVATION', idempotencyKey: 'confirm-key-00001' });
  const response = await fetch(`${base}/v1/reservations:confirm`, { method: 'POST', headers: { ...trustedHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': 'different-key-001' }, body: JSON.stringify(body) });
  assert.equal(response.status, 422); assert.equal((await response.json()).code, 'VALIDATION_FAILED');
}));

test('domain conflict, unknown readback, and database failure preserve C02 codes/statuses', async () => {
  for (const [error, status] of [[new LifecycleError('CONFLICT_ALLOCATION'), 409], [new LifecycleError('NOT_FOUND'), 404], [new LifecycleError('DEPENDENCY_UNAVAILABLE', 'database unavailable', { retryable: true }), 503]]) {
    const failing = { ...service, async getReservation() { throw error; } };
    await withServer(failing, async base => {
      const response = await fetch(`${base}/v1/reservations/${reservationId}`, { headers: trustedHeaders });
      const body = await response.json(); assert.equal(response.status, status); assert.equal(body.code, error.code); assert.equal(body.retryable, error.retryable === true); assert.match(body.correlationId, /^[0-9a-f-]{36}$/);
    });
  }
});

test('malformed JSON never reaches the application service', async () => withServer({ ...service, async searchAvailability() { assert.fail('must not be called'); } }, async base => {
  const response = await fetch(`${base}/v1/availability/search`, { method: 'POST', headers: { ...trustedHeaders, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 422); assert.equal((await response.json()).code, 'VALIDATION_FAILED');
}));
