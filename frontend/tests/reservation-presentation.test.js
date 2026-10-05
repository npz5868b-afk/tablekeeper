import assert from "node:assert/strict";
import test from "node:test";
import { composeReservationRange, confirmedReservationRecord, customerBookingReference, nearbyReservationRanges, uniqueTimeCandidates } from "../src/reservation-presentation.js";

test("guest edits compose the final Kuala Lumpur search range",()=>{
  assert.deepEqual(composeReservationRange("2026-10-05","20:30"),{start:"2026-10-05T12:30:00.000Z",end:"2026-10-05T14:30:00.000Z"});
});

test("resource-level candidates collapse by guest-visible time and preserve first authority candidate",()=>{
  const timeRange={start:"2026-10-05T11:00:00.000Z",end:"2026-10-05T13:00:00.000Z"};
  const first={candidateId:"first",timeRange,resources:[{resourceId:"internal-a"}]};
  const duplicate={candidateId:"second",timeRange,resources:[{resourceId:"internal-b"}]};
  const alternative={candidateId:"third",timeRange:{start:"2026-10-05T11:30:00.000Z",end:"2026-10-05T13:30:00.000Z"},resources:[{resourceId:"internal-c"}]};
  assert.deepEqual(uniqueTimeCandidates([first,duplicate,alternative]),[first,alternative]);
});

test("deduplication never fabricates availability",()=>{
  assert.deepEqual(uniqueTimeCandidates([]),[]);
  assert.deepEqual(uniqueTimeCandidates([{candidateId:"invalid"}]),[]);
});

test("customer booking reference is short, deterministic and leaves authority identity untouched",()=>{
  const reservationId="7ad7d7a2-d216-4694-9033-bee925ba2ffe";
  assert.equal(customerBookingReference(reservationId,"Aegean Blue"),"TK-AEGEAN-2FFE");
  assert.equal(customerBookingReference(reservationId,"Aegean Blue"),"TK-AEGEAN-2FFE");
  assert.equal(reservationId,"7ad7d7a2-d216-4694-9033-bee925ba2ffe");
});

test("nearby dining ranges center on a 9 pm preference in Kuala Lumpur wall time",()=>{
  const ranges=nearbyReservationRanges("2026-10-05","21:00");
  assert.deepEqual(ranges.map(range=>range.time),["20:00","20:30","21:00","21:30","22:00"]);
  assert.equal(ranges[2].start,"2026-10-05T13:00:00.000Z");
  assert.equal(ranges[2].end,"2026-10-05T15:00:00.000Z");
});

test("changing the preferred time recomputes the nearby proposal window",()=>{
  assert.deepEqual(nearbyReservationRanges("2026-10-05","19:30").map(range=>range.time),["18:30","19:00","19:30","20:00","20:30"]);
});

test("persisted Dining Pass restoration accepts only an authoritative confirmed record",()=>{
  const confirmed={status:"CONFIRMED",reservationId:"res-1"};
  assert.equal(confirmedReservationRecord({result:confirmed}),confirmed);
  assert.deepEqual(confirmedReservationRecord({result:{status:"CANCELLED",reservationId:"res-1"}}),{status:"CANCELLED",reservationId:"res-1"});
  assert.equal(confirmedReservationRecord({result:{status:"CONFIRMED"}}),null);
  assert.equal(confirmedReservationRecord({ok:true}),null);
});
