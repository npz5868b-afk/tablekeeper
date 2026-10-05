import test from "node:test";
import assert from "node:assert/strict";
import { applyTurn, createConversationState, extractIntent, rankCandidates, recommend } from "../src/index.mjs";

test("extracts C07-compatible intent with explicit hard and soft constraints", () => {
  const result = extractIntent("Need vegan Italian dinner for four in Bangsar under RM120, preferably quiet, tomorrow at 8 pm");
  assert.equal(result.intentType, "SEARCH_AVAILABILITY");
  assert.equal(result.sourceMode, "LOCAL_AI");
  assert.equal(result.slots.partySize.value, 4);
  assert.deepEqual(result.constraints.map(({ key, hardness }) => [key, hardness]), [
    ["cuisine", "HARD"], ["location", "HARD"], ["pricePerPersonMax", "HARD"], ["dietary", "HARD"], ["ambience", "SOFT"]
  ]);
});

test("extracts an explicit calendar date from a natural availability request", () => {
  const result=extractIntent("I want dinner for 2 on October 5 at 7 PM.",{sourceMode:"DETERMINISTIC"});
  assert.equal(result.intentType,"SEARCH_AVAILABILITY");
  assert.equal(result.slots.partySize.value,2);
  assert.equal(result.slots.dateText.value,"october 5");
  assert.equal(result.slots.timeText.value,"7:00 pm");
});

test("canonicalizes natural party-size answers",()=>{
  const cases=[
    ["just two of us",2],["two of us",2],["the two of us",2],["just us two",2],
    ["for two",2],["2 people",2],["There will be four of us",4],["six people",6]
  ];
  for(const [turn,expected] of cases) assert.equal(extractIntent(turn,{sourceMode:"DETERMINISTIC"}).slots.partySize.value,expected,turn);
});

test("carries constraints across turns and resolves a presented ordinal reference", () => {
  let state = createConversationState();
  state = applyTurn(state, "Find Italian dinner in Bangsar");
  const output = recommend(state, [
    { id: "a", name: "A", facts: { cuisine: "italian", location: "bangsar" } },
    { id: "b", name: "B", facts: { cuisine: "italian", location: "bangsar" } }
  ]);
  state = applyTurn(output.state, "The second one, but it must be quiet");
  assert.equal(state.selectedCandidateId, "b");
  assert.equal(state.constraints.find(item => item.key === "ambience").hardness, "HARD");
  assert.equal(state.history.length, 2);
});

test("unknown facts never satisfy hard constraints", () => {
  const constraints = [{ key: "dietary", value: "vegan", hardness: "HARD", sourceText: "vegan" }];
  const ranked = rankCandidates([
    { id: "unknown", name: "Unknown", facts: {} },
    { id: "unsafe", name: "Unsafe", facts: { dietary: { vegan: false } } },
    { id: "known", name: "Known", facts: { dietary: { vegan: true } } }
  ], constraints);
  assert.deepEqual(ranked.map(item => item.candidate.id), ["known"]);
});

test("ranking is deterministic and explanations use only matching supplied facts", () => {
  let state = createConversationState();
  state = applyTurn(state, "Italian in Bangsar, preferably quiet with a view");
  const candidates = [
    { id: "z", name: "Zulu", facts: { cuisine: "italian", location: "bangsar", ambience: ["quiet"], features: ["view"] } },
    { id: "a", name: "Alpha", facts: { cuisine: "italian", location: "bangsar", ambience: ["quiet"], features: [] } },
    { id: "b", name: "Beta", facts: { cuisine: "italian", location: "bangsar", ambience: ["quiet"], features: ["view"] } }
  ];
  const output = recommend(state, candidates);
  assert.deepEqual(output.recommendations.map(item => item.id), ["b", "z", "a"]);
  assert.deepEqual(output.recommendations[0].reasons, ["location: bangsar", "cuisine: italian", "ambience: quiet"]);
  assert.equal(output.bookingConfirmed, false);
  assert.equal(output.reservationAuthority, "RESERVATION_CORE");
});

test("does not claim matches when a hard operational fact is absent", () => {
  const state = { ...createConversationState(), constraints: [{ key: "pricePerPersonMax", value: 100, hardness: "HARD", sourceText: "under RM100" }] };
  const output = recommend(state, [{ id: "x", name: "No price supplied", facts: {} }]);
  assert.deepEqual(output.recommendations, []);
  assert.match(output.summary, /haven't assumed missing availability, pricing, dietary/);
});
