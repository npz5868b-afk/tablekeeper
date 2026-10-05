import test from "node:test";
import assert from "node:assert/strict";
import {
  answerKnowledgeQuestion,
  applyTurn,
  createConversationState,
  loadGroundedCandidates,
  recommendFromKnowledge,
  retrieveKnowledge
} from "../src/index.mjs";

test("every fixture fact has inspectable source provenance", () => {
  const candidates = loadGroundedCandidates();
  assert.equal(candidates.length, 3);
  for (const candidate of candidates) {
    assert.equal(candidate.fixtureBacked, true);
    assert.ok(candidate.evidence.length > 0);
    for (const evidence of candidate.evidence) {
      assert.match(evidence.claimId, new RegExp(`^${candidate.id}:`));
      assert.equal(evidence.source.kind, "FIXTURE");
      assert.match(evidence.source.locator, /^fixtures:\/\//);
      assert.match(evidence.source.notice, /Synthetic product-development fixtures/);
    }
  }
});

test("retrieval returns only matching claims with their evidence", () => {
  const results = retrieveKnowledge({ query: "corkage Lotus Yard" });
  assert.deepEqual(results.map(result => result.claim.path), ["policy.corkage"]);
  assert.equal(results[0].claim.value, "RM60 per bottle");
  assert.equal(results[0].source.sourceId, results[0].claim.evidence.sourceId);
});

test("knowledge answers fail closed for unknown and unsupported facts", () => {
  assert.deepEqual(answerKnowledgeQuestion({ restaurantId: "fixture-harbor-leaf", topic: "corkage" }).status, "UNKNOWN");
  assert.deepEqual(answerKnowledgeQuestion({ restaurantId: "fixture-lotus-yard", topic: "live availability" }), {
    status: "UNSUPPORTED", answer: null, evidence: [], reservationAuthority: "RESERVATION_CORE", bookingConfirmed: false
  });
});

test("grounded recommendations use the existing Concierge boundary", () => {
  let state = createConversationState();
  state = applyTurn(state, "Need vegan Mediterranean in Damansara");
  const output = recommendFromKnowledge(state);
  assert.deepEqual(output.recommendations.map(item => item.id), ["fixture-harbor-leaf"]);
  assert.deepEqual(output.recommendations[0].evidence.map(item => item.path).sort(), ["cuisine", "dietary.vegan", "location"]);
  assert.ok(output.recommendations[0].evidence.every(item => item.source.kind === "FIXTURE"));
  assert.equal(output.reservationAuthority, "RESERVATION_CORE");
  assert.equal(output.bookingConfirmed, false);
});

test("missing fixture facts cannot satisfy hard restaurant constraints", () => {
  let state = createConversationState();
  state = applyTurn(state, "Need vegan Italian in KLCC");
  const output = recommendFromKnowledge(state);
  assert.deepEqual(output.recommendations, []);
  assert.match(output.summary, /haven't assumed missing/);
});
