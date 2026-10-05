import test from "node:test";
import assert from "node:assert/strict";
import {
  answerKnowledgeQuestion,
  applyTurn,
  createConversationState,
  createReservationHandoff,
  explainSelectedRecommendation,
  recommendFromKnowledge
} from "../src/index.mjs";

test("Brain × RAG multi-turn consultant journey remains grounded and advisory", () => {
  const initial = "Tomorrow around 8pm for our anniversary, two people. Somewhere romantic and elegant but not too noisy, preferably private or with a nice view. Around RM300–400 total, and my partner doesn't eat beef.";
  let state = applyTurn(createConversationState(), initial);
  assert.equal(state.slots.dateText.value, "tomorrow");
  assert.equal(state.slots.timeText.value, "8:00 pm");
  assert.equal(state.slots.partySize.value, 2);
  assert.equal(state.slots.occasion.value, "anniversary");
  assert.equal(state.slots.budgetMin.value, 300);
  assert.equal(state.slots.budgetMax.value, 400);
  assert.deepEqual(Object.fromEntries(state.constraints.map(item => [item.key, item.hardness])), {
    pricePerPersonMax: "SOFT", dietary: "HARD", ambience: "SOFT", occasionAmbience: "SOFT",
    style: "SOFT", seating: "SOFT", feature: "SOFT"
  });

  const first = recommendFromKnowledge(state);
  assert.deepEqual(first.recommendations.map(item => item.id), ["fixture-ember-room", "fixture-lotus-yard"]);
  assert.ok(first.recommendations.flatMap(item => item.evidence).every(item => item.claimId && item.source?.locator));
  assert.deepEqual(recommendFromKnowledge(state).recommendations, first.recommendations);

  state = applyTurn(first.state, "Why this one?");
  const why = explainSelectedRecommendation(state, first.recommendations);
  assert.equal(why.restaurantId, "fixture-ember-room");
  assert.equal(why.status, "GROUNDED");
  assert.ok(why.evidence.length > 0);

  state = applyTurn(state, "What about the second one?");
  assert.equal(state.selectedCandidateId, "fixture-lotus-yard");
  assert.equal(state.slots.occasion.value, "anniversary");

  state = applyTurn(state, "Actually make it 8:30 and something more private.");
  assert.equal(state.slots.timeText.value, "8:30");
  assert.equal(state.slots.partySize.value, 2);
  assert.equal(state.constraints.find(item => item.key === "seating").value, "private");

  const updated = recommendFromKnowledge(state);
  assert.deepEqual(updated.recommendations.map(item => item.id), ["fixture-lotus-yard", "fixture-ember-room"]);

  state = applyTurn(updated.state, "Book the first one.");
  const handoff = createReservationHandoff(state);
  assert.equal(handoff.status, "HANDOFF_REQUIRED");
  assert.equal(handoff.restaurantId, "fixture-lotus-yard");
  assert.equal(handoff.reservationAuthority, "RESERVATION_CORE");
  assert.equal(handoff.bookingConfirmed, false);

  assert.equal(answerKnowledgeQuestion({ restaurantId: handoff.restaurantId, topic: "live availability" }).status, "UNSUPPORTED");
  assert.equal(answerKnowledgeQuestion({ restaurantId: "fixture-harbor-leaf", topic: "corkage" }).status, "UNKNOWN");
  assert.equal(answerKnowledgeQuestion({ restaurantId: "fixture-ember-room", topic: "vegan" }).status, "UNKNOWN");
  assert.equal(first.bookingConfirmed, false);
});
