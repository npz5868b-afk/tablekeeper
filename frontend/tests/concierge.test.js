import test from "node:test";
import assert from "node:assert/strict";
import { interpretWish } from "../src/concierge.js";

test("extracts a rich evening without mutating reservation truth", () => {
  const result = interpretWish("Quiet anniversary dinner for four tonight at 8 pm, vegetarian, wheelchair accessible and possible late arrival");
  assert.equal(result.date, "Tonight");
  assert.equal(result.time, "8:00 pm");
  assert.equal(result.party, 4);
  assert.equal(result.occasion, "Anniversary");
  assert.equal(result.quiet, true);
  assert.equal(result.dietary, "Vegetarian");
  assert.equal(result.accessibility, true);
  assert.equal(result.lateArrival, true);
  assert.equal("status" in result, false);
});

test("returns stable defaults for an open-ended wish", () => {
  const result = interpretWish("Something warm and relaxed");
  assert.deepEqual({ date: result.date, time: result.time, party: result.party, occasion: result.occasion }, { date:"Friday", time:"7:30 pm", party:2, occasion:"Dinner" });
});

test("captures rich context without claiming reservation truth", () => {
  const result = interpretWish("Japanese dinner for two near Bangsar, around RM250, private window seating with a view");
  assert.equal(result.cuisine, "japanese");
  assert.equal(result.location, "bangsar");
  assert.equal(result.budget, "250");
  assert.equal(result.privateSeating, true);
  assert.equal(result.view, true);
  assert.equal("available" in result, false);
  assert.equal("status" in result, false);
});
