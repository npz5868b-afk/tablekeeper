import assert from "node:assert/strict";
import test from "node:test";
import { venueCalendar, venueWallTimeToInstant } from "../src/venue-time.js";

test("Kuala Lumpur wall time is independent of browser timezone",()=>{
  assert.equal(venueWallTimeToInstant("2030-01-02T19:30").toISOString(),"2030-01-02T11:30:00.000Z");
  assert.equal(venueWallTimeToInstant("2030-02-30T19:30"),null);
});

test("venue calendar uses Kuala Lumpur date across UTC day boundary",()=>{
  assert.deepEqual(venueCalendar(new Date("2030-01-01T17:00:00.000Z")),{year:2030,month:0,day:2});
});
