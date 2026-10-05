import test from "node:test";
import assert from "node:assert/strict";
import { reservationSelectionDetail } from "../src/reservation-selection.js";

test("grounded Concierge selection maps to the existing Reservation Core journey",()=>{
  const detail=reservationSelectionDetail({type:"selection",payload:{restaurantId:"fixture-kumo-dining",name:"Kumo Dining",reservationAuthority:"RESERVATION_CORE",bookingConfirmed:false}});
  assert.deepEqual(detail,{restaurantId:"fixture-kumo-dining",name:"Kumo Dining"});
});

test("untrusted or prematurely confirmed selection payloads fail closed",()=>{
  assert.equal(reservationSelectionDetail({type:"selection",payload:{restaurantId:"invented",name:"Atlantis",reservationAuthority:"LLM",bookingConfirmed:false}}),null);
  assert.equal(reservationSelectionDetail({type:"selection",payload:{restaurantId:"fixture-kumo-dining",name:"Kumo Dining",reservationAuthority:"RESERVATION_CORE",bookingConfirmed:true}}),null);
});
