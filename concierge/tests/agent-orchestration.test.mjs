import test from "node:test";
import assert from "node:assert/strict";
import { ContractValidationError, createDiningIntent, mergeIntent, validateIntentUpdate } from "../src/contracts/dining-intent.mjs";
import { DeterministicLanguageUnderstandingProvider } from "../src/providers/deterministic-provider.mjs";
import { AzureOpenAIStructuredOutputProvider, ProviderUnavailableError } from "../src/providers/azure-openai-provider.mjs";
import { MemoryCheckpointer } from "../src/persistence/memory-checkpointer.mjs";
import { ReservationCoreHttpTools } from "../src/tools/reservation-core-http.mjs";
import { ConciergeGraph } from "../src/graph/concierge-graph.mjs";
import { ConciergeService } from "../src/service/concierge-service.mjs";

const field = (value, sourceText) => ({ value, sourceText, provenance: "EXPLICIT", confidence: 1 });
const graphWith = ({ provider = new DeterministicLanguageUnderstandingProvider(), reservationTools } = {}) => new ConciergeGraph({
  provider, checkpointer: new MemoryCheckpointer(), reservationTools,
  retriever: { async retrieve(_query, intent) { return [{ id: "r1", intent }]; } },
  decisionEngine: { async rank(_intent, candidates) { return candidates.map(item => ({ id: item.id, evidence: [{ claimId: "fixture:r1", sourceId: "fixture" }] })); } }
});

test("IntentUpdate is closed and PATCH/MERGE preserves unrelated state", () => {
  let intent = createDiningIntent();
  intent = mergeIntent(intent, { intentType: "SEARCH_AVAILABILITY", slots: { partySize: field(2, "two"), dateText: field("tomorrow", "tomorrow") }, constraints: [{ key: "cuisine", value: "italian", hardness: "SOFT", ...field("italian", "Italian") }] });
  intent = mergeIntent(intent, { slots: { timeText: field("20:30", "8:30") }, constraints: [{ key: "cuisine", value: "japanese", hardness: "HARD", ...field("japanese", "must be Japanese") }] });
  assert.equal(intent.slots.partySize.value, 2);
  assert.equal(intent.slots.timeText.value, "20:30");
  assert.equal(intent.constraints.length, 1);
  assert.equal(intent.constraints[0].value, "japanese");
  assert.equal(intent.readiness.ready, true);
  assert.throws(() => validateIntentUpdate({ invented: true }), ContractValidationError);
});

test("multi-turn graph clarifies one missing field then reaches a checkpointed decision", async () => {
  const graph = graphWith();
  const first = await graph.invoke({ threadId: "multi", turn: "Italian dinner for two tomorrow" });
  assert.equal(first.stage, "WAIT_FOR_USER");
  assert.equal(first.clarification.question, "What time would you prefer?");
  const second = await graph.invoke({ threadId: "multi", turn: "At 8 pm" });
  assert.equal(second.stage, "WAIT_FOR_DECISION");
  assert.equal(second.intent.slots.partySize.value, 2);
  assert.equal(second.intent.slots.timeText.value, "8:00 pm");
  assert.ok(second.transitions.some(item => item.to === "RETRIEVE_CANDIDATES"));
});

test("provider failure preserves prior checkpoint and returns retryable safe response", async () => {
  let calls = 0;
  const provider = { async understand() { calls += 1; if (calls === 1) return { slots: { partySize: field(2, "two") }, ambiguities: [], contradictions: [] }; throw new ProviderUnavailableError("secret api-key=do-not-leak"); } };
  const graph = graphWith({ provider });
  const before = await graph.invoke({ threadId: "provider", turn: "two people" });
  const failed = await graph.invoke({ threadId: "provider", turn: "tomorrow" });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "LANGUAGE_PROVIDER_FAILURE");
  assert.equal(failed.intent.slots.partySize.value, 2);
  assert.doesNotMatch(JSON.stringify(failed.trace), /api-key/i);
  assert.equal(before.stage, "WAIT_FOR_USER");
});

test("Azure provider uses server-side structured-output request and validates response", async () => {
  let request;
  const provider = new AzureOpenAIStructuredOutputProvider({ endpoint: "https://example.openai.azure.com", apiKey: "server-secret", deployment: "intent", fetchImpl: async (url, init) => { request = { url, init }; return { ok: true, async json() { return { choices: [{ message: { content: JSON.stringify({ intentType: "UNKNOWN", ambiguities: [], contradictions: [] }) } }] }; } }; } });
  const result = await provider.understand("hello", createDiningIntent());
  assert.equal(result.intentType, "UNKNOWN");
  assert.equal(JSON.parse(request.init.body).response_format.type, "json_schema");
  assert.equal(request.init.headers["api-key"], "server-secret");
});

test("Reservation Core adapter delegates accepted routes and unchanged envelopes", async () => {
  const calls = [];
  const tools = new ReservationCoreHttpTools({ bearerToken: "dev", fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, async json() { return { ok: true }; } }; } });
  const envelope = { idempotencyKey: "1234567890123456", payload: { confirmationToken: "opaque" } };
  await tools.search({ queryType: "SEARCH_AVAILABILITY" }); await tools.prepare(envelope); await tools.confirm(envelope); await tools.get("res/1");
  assert.deepEqual(calls.map(item => new URL(item.url).pathname), ["/v1/availability/search", "/v1/reservation-preparations", "/v1/reservations:confirm", "/v1/reservations/res%2F1"]);
  assert.deepEqual(JSON.parse(calls[1].init.body), envelope);
  assert.equal(calls[2].init.headers["idempotency-key"], envelope.idempotencyKey);
});

test("reservation failure never fabricates booking confirmation and retains review state", async () => {
  const reservationTools = { async confirm() { const error = new Error("database unavailable"); Object.assign(error, { code: "DEPENDENCY_UNAVAILABLE", retryable: true, correlationId: "core-1" }); throw error; } };
  const service = new ConciergeService({ graph: graphWith({ reservationTools }) });
  await service.handleTurn({ threadId: "reserve", turnId: "turn-1", message: "Dinner for two tomorrow at 8 pm" });
  const response = await service.handleTurn({ threadId: "reserve", turnId: "turn-2", message: "Book it", reservationAction: { operation: "confirm", input: { idempotencyKey: "1234567890123456" } } });
  assert.equal(response.stage, "WAIT_FOR_DECISION");
  assert.equal(response.interaction.type, "reservation");
  assert.equal(response.interaction.payload.ok, false);
  assert.equal(response.interaction.payload.error.retryable, true);
  assert.equal(response.bookingConfirmed, false);
  assert.equal(response.reservationAuthority, "RESERVATION_CORE");
  assert.equal(response.reservationGuardian.status, "UNCERTAIN");
  assert.equal(response.reservationGuardian.recovery.action, "RETRY_SAME_CONFIRM_COMMAND");
  assert.equal(response.reservationGuardian.recovery.reuseIdempotencyKey, true);
  assert.match(response.message, /unverified/i);
});

test("top-level confirmation truth accepts the same raw and nested shapes as the guardian",async()=>{
  for(const [suffix,reservation] of [
    ["raw",{ok:true,operation:"confirm",result:{status:"CONFIRMED",reservationId:"res-raw"}}],
    ["nested",{ok:true,operation:"confirm",result:{ok:true,result:{status:"CONFIRMED",reservationId:"res-nested"}}}]
  ]){
    const guardian={status:"CONFIRMED",authoritative:true,reservationId:`res-${suffix}`,recovery:null};
    const service=new ConciergeService({graph:{invoke:async()=>({ok:true,reservation,guardian,stage:"WAIT_FOR_DECISION",intent:{},trace:{traceId:`trace-${suffix}`}})}});
    const response=await service.handleTurn({threadId:`shape-${suffix}`,turnId:"turn-1",message:"confirm"});
    assert.equal(response.bookingConfirmed,true);
    assert.equal(response.reservationGuardian.status,"CONFIRMED");
  }
});

test("top-level confirmation truth fails closed for a malformed successful envelope",async()=>{
  const reservation={ok:true,operation:"confirm",result:{ok:true}};
  const guardian={status:"MALFORMED_RESULT",authoritative:false,bookingConfirmed:false,recovery:null};
  const service=new ConciergeService({graph:{invoke:async()=>({ok:true,reservation,guardian,stage:"WAIT_FOR_DECISION",intent:{},trace:{traceId:"trace-malformed"}})}});
  const response=await service.handleTurn({threadId:"shape-malformed",turnId:"turn-1",message:"confirm"});
  assert.equal(response.bookingConfirmed,false);
  assert.equal(response.reservationGuardian.authoritative,false);
});
