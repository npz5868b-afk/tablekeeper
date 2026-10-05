import test from "node:test";
import assert from "node:assert/strict";
import { createReservationAttemptKeys, reservationBoundary, reservationErrorMessage } from "../src/reservation-boundary.js";

const runtime = { baseUrl:"http://127.0.0.1:4180", bearerToken:"dev-token", tenantId:"11111111-1111-4111-8111-111111111111", actorId:"22222222-2222-4222-8222-222222222222", actorType:"GUEST" };
const candidate = { candidateId:"33333333-3333-4333-8333-333333333333", resources:[{resourceId:"44444444-4444-4444-8444-444444444444"}], timeRange:{start:"2026-10-02T12:00:00.000Z",end:"2026-10-02T14:00:00.000Z"} };

test.beforeEach(() => { globalThis.TABLEKEEPER_RESERVATION_CORE = runtime; });

test("search sends the C03 2.0.0 envelope and preserves returned candidates", async () => {
  globalThis.fetch = async (url, init) => { const body=JSON.parse(init.body); assert.equal(url,"http://127.0.0.1:4180/v1/availability/search"); assert.equal(init.headers.Authorization,"Bearer dev-token"); assert.deepEqual(body.contract,{contractId:"C03",contractVersion:"2.0.0"}); assert.match(body.queryId,/^[0-9a-f-]{36}$/); assert.deepEqual(body.actor,{actorId:runtime.actorId,actorType:"GUEST"}); return new Response(JSON.stringify({candidates:[candidate]}),{status:200}); };
  const result=await reservationBoundary.searchAvailability({venueId:"55555555-5555-4555-8555-555555555555",partySize:2,requestedRange:candidate.timeRange});
  assert.deepEqual(result.candidates[0],candidate);
});

test("prepare preserves identity and binds the caller-stable idempotency key", async () => {
  const idempotencyKey=createReservationAttemptKeys().prepare;
  globalThis.fetch=async (_url,init)=>{const body=JSON.parse(init.body);assert.deepEqual(body.contract,{contractId:"C04",contractVersion:"2.0.0"});assert.equal(init.headers["Idempotency-Key"],idempotencyKey);assert.equal(body.idempotencyKey,idempotencyKey);assert.equal(body.payload.selection.candidateId,candidate.candidateId);assert.deepEqual(body.payload.selection.resourceIds,[candidate.resources[0].resourceId]);return new Response(JSON.stringify({confirmationToken:"opaque"}),{status:200});};
  await reservationBoundary.prepareReservation({venueId:"55555555-5555-4555-8555-555555555555",partySize:2,requestedRange:candidate.timeRange,candidate,idempotencyKey});
});

test("confirm requires and reuses a distinct stable key", async () => {
  const keys=createReservationAttemptKeys(); assert.notEqual(keys.prepare,keys.confirm);
  globalThis.fetch=async (_url,init)=>{const body=JSON.parse(init.body);assert.equal(init.headers["Idempotency-Key"],keys.confirm);assert.equal(body.idempotencyKey,keys.confirm);return new Response(JSON.stringify({ok:true,result:{status:"CONFIRMED",reservationId:"reservation-1"}}),{status:200});};
  await reservationBoundary.confirmReservation({confirmationToken:"opaque",acceptedTerms:[],idempotencyKey:keys.confirm});
});

test("cancel uses a stable idempotency key and never synthesizes success",async()=>{const keys=createReservationAttemptKeys(),reservationId="77777777-7777-4777-8777-777777777777";assert.notEqual(keys.cancel,keys.confirm);globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);assert.equal(url,`http://127.0.0.1:4180/v1/reservations/${reservationId}:cancel`);assert.equal(init.headers["Idempotency-Key"],keys.cancel);assert.equal(body.commandType,"CANCEL_RESERVATION");assert.equal(body.payload.reservationId,reservationId);return new Response(JSON.stringify({ok:true,result:{reservationId,status:"CANCELLED",version:2}}),{status:200})};const result=await reservationBoundary.cancelReservation({reservationId,idempotencyKey:keys.cancel});assert.equal(result.result.status,"CANCELLED")});

test("C02 and network failures reject and never synthesize confirmation", async () => {
  globalThis.fetch=async()=>new Response(JSON.stringify({code:"DEPENDENCY_UNAVAILABLE",message:"Unavailable",retryable:true,correlationId:"c-1"}),{status:503});
  await assert.rejects(()=>reservationBoundary.confirmReservation({confirmationToken:"opaque",acceptedTerms:[],idempotencyKey:createReservationAttemptKeys().confirm}),error=>error.code==="DEPENDENCY_UNAVAILABLE"&&error.retryable===true);
  globalThis.fetch=async()=>{throw new TypeError("fetch failed")};
  await assert.rejects(()=>reservationBoundary.searchAvailability({venueId:"v",partySize:2,requestedRange:candidate.timeRange}),error=>error.code==="DEPENDENCY_UNAVAILABLE"&&error.retryable===true);
  assert.match(reservationErrorMessage({code:"DEPENDENCY_UNAVAILABLE"}),/temporarily unavailable/);
});
