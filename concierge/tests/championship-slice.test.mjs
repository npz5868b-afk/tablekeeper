import test from "node:test";
import assert from "node:assert/strict";
import { buildSmartFallback } from "../src/decision/smart-fallback.mjs";
import { confirmedReservationResult, guardReservationOutcome } from "../src/reservation/reservation-guardian.mjs";

const intent = { intentType:"REJECT", constraints:[
  { key:"dietary", value:"vegan", hardness:"HARD", sourceText:"must be vegan" },
  { key:"ambience", value:"quiet", hardness:"SOFT", sourceText:"prefer quiet" }
] };
const grounded = { id:"r2", name:"Grounded Two", evidence:[{ claimId:"r2:dietary.vegan", sourceId:"fixture:r2" }] };

test("smart fallback preserves hard constraints and labels alternative availability as unchecked", () => {
  const result = buildSmartFallback({ intent, recommendations:[grounded], rejectedId:"r1" });
  assert.equal(result.status, "ALTERNATIVE_AVAILABLE");
  assert.deepEqual(result.preservedHardConstraints.map(x => [x.key,x.value]), [["dietary","vegan"]]);
  assert.equal(result.alternatives[0].availabilityStatus, "NOT_CHECKED");
  assert.equal(result.alternatives[0].next, "CHECK_RESERVATION_CORE");
  assert.match(result.unsupported.waitlist, /No waitlist/);
});

test("fallback does not invent nearby time, waitlist, or restaurant", () => {
  const result = buildSmartFallback({ intent:{...intent,intentType:"SEARCH_AVAILABILITY"}, recommendations:[], availability:{candidates:[]} });
  assert.equal(result.status, "NO_GROUNDED_ALTERNATIVE");
  assert.deepEqual(result.alternatives, []);
  assert.match(result.unsupported.nearbyTime, /exact-range/);
  assert.match(result.unsupported.scheduledBooking, /No scheduled-booking/);
});

test("fallback recognizes an empty accepted Reservation Core result envelope", () => {
  const result = buildSmartFallback({
    intent:{...intent,intentType:"SEARCH_AVAILABILITY"},
    recommendations:[grounded],
    availability:{ok:true,result:{candidates:[]}}
  });
  assert.equal(result.trigger,"REQUESTED_TIME_UNAVAILABLE");
  assert.equal(result.alternatives[0].availabilityStatus,"NOT_CHECKED");
});

test("lost confirm response is uncertainty, never confirmation", () => {
  const result = guardReservationOutcome({ ok:false, operation:"confirm", error:{code:"DEPENDENCY_UNAVAILABLE",retryable:true} });
  assert.equal(result.status, "UNCERTAIN");
  assert.equal(result.bookingConfirmed, false);
  assert.equal(result.authoritative, false);
  assert.deepEqual(result.recovery, { action:"RETRY_SAME_CONFIRM_COMMAND", reuseIdempotencyKey:true, authority:"RESERVATION_CORE" });
});

test("only an authoritative confirmed result becomes confirmed", () => {
  assert.equal(guardReservationOutcome({ok:true,operation:"confirm",result:{ok:true,result:{status:"CONFIRMED",reservationId:"res-1"}}}).status,"CONFIRMED");
  assert.notEqual(guardReservationOutcome({ok:true,operation:"confirm",result:{ok:true,result:{status:"PENDING"}}}).status,"CONFIRMED");
  assert.equal(guardReservationOutcome({ok:false,operation:"confirm",error:{code:"STALE_RESOURCE_SNAPSHOT",retryable:false}}).recovery.action,"RECHECK_AVAILABILITY");
});

test("successful envelopes are authoritative only with a recognized result shape",()=>{
  for(const malformed of [
    {ok:true,operation:"confirm"},
    {ok:true,operation:"confirm",result:{ok:true}},
    {ok:true,operation:"unknown",result:{status:"CONFIRMED",reservationId:"res-1"}}
  ]){
    const guarded=guardReservationOutcome(malformed);
    assert.equal(guarded.authoritative,false);
    assert.equal(guarded.bookingConfirmed,false);
    assert.equal(guarded.status,"MALFORMED_RESULT");
  }
});

test("raw and nested valid confirmation shapes normalize identically",()=>{
  const raw={ok:true,operation:"confirm",result:{status:"CONFIRMED",reservationId:"res-raw"}};
  const nested={ok:true,operation:"confirm",result:{ok:true,result:{status:"CONFIRMED",reservationId:"res-nested"}}};
  assert.equal(confirmedReservationResult(raw).reservationId,"res-raw");
  assert.equal(confirmedReservationResult(nested).reservationId,"res-nested");
  assert.equal(guardReservationOutcome(raw).status,"CONFIRMED");
  assert.equal(guardReservationOutcome(nested).status,"CONFIRMED");
});
