import test from "node:test";
import assert from "node:assert/strict";
import { IntelligenceModeController, ScriptedBoundary } from "../src/resilience.mjs";

const boundary = (health, advisory = "cloud advice") => new ScriptedBoundary({ health: Array.isArray(health) ? health : [health], advisories: [{ advisory }] });
const core = () => ({
  calls: [],
  async prepare(value) { this.calls.push(["prepare", value]); return { status: "PREPARED", preparationId: "prep-1" }; },
  async confirm(value) { this.calls.push(["confirm", value]); return { status: value === "prep-1" ? "CONFIRMED" : "REJECTED", ...(value === "prep-1" ? { reservationId: "res-1" } : {}) }; }
});

test("healthy cloud returns machine-readable mode and provenance", async () => {
  const result = await new IntelligenceModeController({ cloud: boundary("HEALTHY"), local: boundary("HEALTHY") }).handle({ input: "Italian dinner" });
  assert.equal(result.mode, "CLOUD");
  assert.equal(result.provenance[0].kind, "REMOTE_MODEL");
  assert.equal(result.bookingConfirmed, false);
});

test("cloud failure selects local", async () => {
  const result = await new IntelligenceModeController({ cloud: boundary("UNAVAILABLE"), local: boundary("HEALTHY") }).handle({ input: "Italian in KLCC" });
  assert.equal(result.mode, "LOCAL");
  assert.equal(result.recommendations[0].id, "fixture-ember-room");
});

test("cloud timeout selects local without touching a network", async () => {
  const result = await new IntelligenceModeController({ cloud: boundary("TIMEOUT"), local: boundary("HEALTHY") }).handle({ input: "Malaysian in Bangsar" });
  assert.equal(result.mode, "LOCAL");
  assert.equal(result.health.cloud.status, "TIMEOUT");
});

test("local failure selects survival", async () => {
  const result = await new IntelligenceModeController({ cloud: boundary("UNAVAILABLE"), local: boundary("UNAVAILABLE") }).handle({ input: "Malaysian in Bangsar" });
  assert.equal(result.mode, "SURVIVAL");
  assert.equal(result.aiActive, false);
  assert.equal(result.availability.status, "UNKNOWN");
});

test("both unavailable at startup begins in survival", async () => {
  const result = await new IntelligenceModeController({}).handle({ input: "restaurant" });
  assert.deepEqual([result.transition.from, result.transition.to], [null, "SURVIVAL"]);
});

test("local recovers automatically to cloud", async () => {
  const controller = new IntelligenceModeController({ cloud: boundary(["UNAVAILABLE", "HEALTHY"]), local: boundary("HEALTHY") });
  assert.equal((await controller.handle({ input: "Italian" })).mode, "LOCAL");
  const recovered = await controller.handle({ input: "in KLCC" });
  assert.equal(recovered.mode, "CLOUD");
  assert.deepEqual([recovered.transition.from, recovered.transition.to], ["LOCAL", "CLOUD"]);
});

test("survival recovers through local and then cloud", async () => {
  const controller = new IntelligenceModeController({ cloud: boundary(["UNAVAILABLE", "UNAVAILABLE", "HEALTHY"]), local: boundary(["UNAVAILABLE", "HEALTHY"]) });
  assert.equal((await controller.handle({ input: "Italian" })).mode, "SURVIVAL");
  assert.equal((await controller.handle({ input: "in KLCC" })).mode, "LOCAL");
  assert.equal((await controller.handle({})).mode, "CLOUD");
});

test("representable intent survives transitions and opaque context loss is explicit", async () => {
  const cloud = new ScriptedBoundary({ health: ["HEALTHY", "UNAVAILABLE"], advisories: [{ advisory: "ok", opaqueContext: { hidden: true } }] });
  const controller = new IntelligenceModeController({ cloud, local: boundary("HEALTHY") });
  await controller.handle({ input: "Italian for two" });
  const local = await controller.handle({ input: "in KLCC" });
  assert.equal(local.continuity.slots.partySize.value, 2);
  assert.ok(local.continuity.constraints.some(x => x.key === "cuisine" && x.value === "italian"));
  assert.ok(local.continuity.constraints.some(x => x.key === "location" && x.value === "klcc"));
  assert.deepEqual(local.continuity.lostContext.map(x => x.kind), ["CLOUD_OPAQUE_CONTEXT"]);
});

test("unsupported facts fail closed in local and survival", async () => {
  for (const [cloudHealth, localHealth, expectedMode] of [["UNAVAILABLE", "HEALTHY", "LOCAL"], ["UNAVAILABLE", "UNAVAILABLE", "SURVIVAL"]]) {
    const result = await new IntelligenceModeController({ cloud: boundary(cloudHealth), local: boundary(localHealth) }).handle({ action: "FACT", restaurantId: "fixture-lotus-yard", topic: "live availability" });
    assert.equal(result.mode, expectedMode);
    assert.equal(result.status, "UNSUPPORTED");
    assert.equal(result.answer, null);
    assert.equal(result.provenance[0].kind, "FAIL_CLOSED");
  }
});

test("survival never fabricates availability or confirmation", async () => {
  const result = await new IntelligenceModeController({ cloud: boundary("UNAVAILABLE"), local: boundary("UNAVAILABLE") }).handle({ input: "Italian in KLCC" });
  assert.deepEqual(result.availability, { status: "UNKNOWN", next: "RESERVATION_CORE_HANDOFF" });
  assert.equal(result.bookingConfirmed, false);
});

test("cloud and local cannot mutate reservations", async () => {
  for (const [cloudHealth, localHealth] of [["HEALTHY", "HEALTHY"], ["UNAVAILABLE", "HEALTHY"]]) {
    const reservationCore = core();
    const result = await new IntelligenceModeController({ cloud: boundary(cloudHealth), local: boundary(localHealth), reservationCore }).handle({ action: "PREPARE_RESERVATION" });
    assert.equal(result.status, "SURVIVAL_HANDOFF_REQUIRED");
    assert.equal(reservationCore.calls.length, 0);
  }
});

test("survival prepare and confirm remain under Reservation Core authority", async () => {
  const reservationCore = core();
  const controller = new IntelligenceModeController({ cloud: boundary("UNAVAILABLE"), local: boundary("UNAVAILABLE"), reservationCore });
  await controller.handle({ input: "Italian in KLCC" });
  controller.state.selectedCandidateId = "fixture-ember-room";
  const prepared = await controller.handle({ action: "PREPARE_RESERVATION", payload: { partySize: 2 } });
  assert.equal(prepared.status, "PREPARED");
  assert.equal(prepared.bookingConfirmed, false);
  const rejected = await controller.handle({ action: "CONFIRM_RESERVATION", preparationId: "wrong" });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.bookingConfirmed, false);
  const confirmed = await controller.handle({ action: "CONFIRM_RESERVATION", preparationId: prepared.preparationId });
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.bookingConfirmed, true);
  assert.deepEqual(reservationCore.calls.map(x => x[0]), ["prepare", "confirm", "confirm"]);
  assert.ok(confirmed.provenance.some(x => x.kind === "RESERVATION_CORE"));
});
