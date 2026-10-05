const normal = value => String(value ?? "").trim().toLowerCase();
const clone = value => structuredClone(value);

export const FIXTURE_CORPUS_NOTICE =
  "Synthetic product-development fixtures; not verified real-world restaurant information.";

const SOURCES = Object.freeze({
  "fixture:venue:lotus-yard:v1": Object.freeze({
    sourceId: "fixture:venue:lotus-yard:v1",
    kind: "FIXTURE",
    title: "Lotus Yard fixture profile v1",
    locator: "fixtures://restaurants/lotus-yard/v1",
    capturedAt: "2026-09-30T00:00:00.000Z",
    notice: FIXTURE_CORPUS_NOTICE
  }),
  "fixture:venue:ember-room:v1": Object.freeze({
    sourceId: "fixture:venue:ember-room:v1",
    kind: "FIXTURE",
    title: "Ember Room fixture profile v1",
    locator: "fixtures://restaurants/ember-room/v1",
    capturedAt: "2026-09-30T00:00:00.000Z",
    notice: FIXTURE_CORPUS_NOTICE
  }),
  "fixture:venue:harbor-leaf:v1": Object.freeze({
    sourceId: "fixture:venue:harbor-leaf:v1",
    kind: "FIXTURE",
    title: "Harbor Leaf fixture profile v1",
    locator: "fixtures://restaurants/harbor-leaf/v1",
    capturedAt: "2026-09-30T00:00:00.000Z",
    notice: FIXTURE_CORPUS_NOTICE
  })
});

const claim = (restaurantId, path, value, sourceId, quote) => Object.freeze({
  claimId: `${restaurantId}:${path}`,
  restaurantId,
  path,
  value,
  evidence: Object.freeze({ sourceId, quote })
});

const RESTAURANTS = Object.freeze([
  Object.freeze({ id: "fixture-lotus-yard", name: "Lotus Yard", claims: Object.freeze([
    claim("fixture-lotus-yard", "cuisine", "malaysian", "fixture:venue:lotus-yard:v1", "Cuisine: Malaysian"),
    claim("fixture-lotus-yard", "location", "bangsar", "fixture:venue:lotus-yard:v1", "Area: Bangsar"),
    claim("fixture-lotus-yard", "pricePerPerson", 85, "fixture:venue:lotus-yard:v1", "Typical food spend: RM85 per person"),
    claim("fixture-lotus-yard", "dietary.no-beef", true, "fixture:venue:lotus-yard:v1", "Non-beef dishes are identified"),
    claim("fixture-lotus-yard", "dietary.vegetarian", true, "fixture:venue:lotus-yard:v1", "Vegetarian dishes are identified"),
    claim("fixture-lotus-yard", "ambience", ["quiet", "intimate"], "fixture:venue:lotus-yard:v1", "Atmosphere: quiet and intimate"),
    claim("fixture-lotus-yard", "occasionAmbience", ["romantic"], "fixture:venue:lotus-yard:v1", "Occasion atmosphere: romantic"),
    claim("fixture-lotus-yard", "style", ["elegant"], "fixture:venue:lotus-yard:v1", "Style: elegant"),
    claim("fixture-lotus-yard", "seating", ["private"], "fixture:venue:lotus-yard:v1", "Seating: private dining alcove"),
    claim("fixture-lotus-yard", "policy.corkage", "RM60 per bottle", "fixture:venue:lotus-yard:v1", "Corkage: RM60 per bottle")
  ]) }),
  Object.freeze({ id: "fixture-ember-room", name: "Ember Room", claims: Object.freeze([
    claim("fixture-ember-room", "cuisine", "italian", "fixture:venue:ember-room:v1", "Cuisine: Italian"),
    claim("fixture-ember-room", "location", "klcc", "fixture:venue:ember-room:v1", "Area: KLCC"),
    claim("fixture-ember-room", "pricePerPerson", 160, "fixture:venue:ember-room:v1", "Typical food spend: RM160 per person"),
    claim("fixture-ember-room", "dietary.no-beef", true, "fixture:venue:ember-room:v1", "Non-beef dishes are identified"),
    claim("fixture-ember-room", "ambience", ["quiet"], "fixture:venue:ember-room:v1", "Atmosphere: quiet"),
    claim("fixture-ember-room", "occasionAmbience", ["romantic"], "fixture:venue:ember-room:v1", "Occasion atmosphere: romantic"),
    claim("fixture-ember-room", "style", ["elegant"], "fixture:venue:ember-room:v1", "Style: elegant"),
    claim("fixture-ember-room", "features", ["view"], "fixture:venue:ember-room:v1", "Features: skyline view"),
    claim("fixture-ember-room", "policy.dressCode", "smart casual", "fixture:venue:ember-room:v1", "Dress code: smart casual")
  ]) }),
  Object.freeze({ id: "fixture-harbor-leaf", name: "Harbor Leaf", claims: Object.freeze([
    claim("fixture-harbor-leaf", "cuisine", "mediterranean", "fixture:venue:harbor-leaf:v1", "Cuisine: Mediterranean"),
    claim("fixture-harbor-leaf", "location", "damansara", "fixture:venue:harbor-leaf:v1", "Area: Damansara"),
    claim("fixture-harbor-leaf", "dietary.vegan", true, "fixture:venue:harbor-leaf:v1", "Vegan dishes are identified"),
    claim("fixture-harbor-leaf", "accessibility.wheelchair-accessible", true, "fixture:venue:harbor-leaf:v1", "Step-free guest route is available"),
    claim("fixture-harbor-leaf", "ambience", ["calm"], "fixture:venue:harbor-leaf:v1", "Atmosphere: calm")
  ]) })
]);

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = clone(value);
}

function queryTerms(query) {
  return new Set(normal(query).split(/[^a-z0-9-]+/).filter(term => term.length > 2));
}

function claimText(item) {
  return normal([item.path, JSON.stringify(item.value), item.evidence.quote].join(" "));
}

export function retrieveKnowledge({ query = "", restaurantIds, paths, limit = 20 } = {}) {
  const ids = restaurantIds ? new Set(restaurantIds) : null;
  const allowedPaths = paths ? new Set(paths) : null;
  const terms = queryTerms(query);
  const matches = [];
  for (const restaurant of RESTAURANTS) {
    if (ids && !ids.has(restaurant.id)) continue;
    for (const item of restaurant.claims) {
      if (allowedPaths && !allowedPaths.has(item.path)) continue;
      const haystack = `${normal(restaurant.name)} ${claimText(item)}`;
      const matchedTerms = [...terms].filter(term => haystack.includes(term));
      if (terms.size && !matchedTerms.length) continue;
      matches.push({ restaurantId: restaurant.id, restaurantName: restaurant.name, claim: clone(item), source: clone(SOURCES[item.evidence.sourceId]), score: matchedTerms.length });
    }
  }
  const highestScore = matches.reduce((highest, item) => Math.max(highest, item.score), 0);
  return matches.filter(item => !terms.size || item.score === highestScore)
    .sort((a, b) => b.score - a.score || a.claim.claimId.localeCompare(b.claim.claimId))
    .slice(0, limit);
}

export function loadGroundedCandidates({ restaurantIds } = {}) {
  const ids = restaurantIds ? new Set(restaurantIds) : null;
  return RESTAURANTS.filter(restaurant => !ids || ids.has(restaurant.id)).map(restaurant => {
    const facts = {};
    for (const item of restaurant.claims) setPath(facts, item.path, item.value);
    return {
      id: restaurant.id,
      name: restaurant.name,
      facts,
      evidence: restaurant.claims.map(item => ({ claimId: item.claimId, path: item.path, ...clone(item.evidence), source: clone(SOURCES[item.evidence.sourceId]) })),
      fixtureBacked: true
    };
  });
}

export function answerKnowledgeQuestion({ restaurantId, topic }) {
  const normalizedTopic = normal(topic);
  const path = ({ corkage: "policy.corkage", "dress code": "policy.dressCode", price: "pricePerPerson", vegan: "dietary.vegan", vegetarian: "dietary.vegetarian", atmosphere: "ambience" })[normalizedTopic];
  if (!path) return { status: "UNSUPPORTED", answer: null, evidence: [], reservationAuthority: "RESERVATION_CORE", bookingConfirmed: false };
  const [match] = retrieveKnowledge({ restaurantIds: [restaurantId], paths: [path], limit: 1 });
  if (!match) return { status: "UNKNOWN", answer: null, evidence: [], reservationAuthority: "RESERVATION_CORE", bookingConfirmed: false };
  return { status: "GROUNDED", answer: clone(match.claim.value), evidence: [{ claimId: match.claim.claimId, path, quote: match.claim.evidence.quote, source: match.source }], reservationAuthority: "RESERVATION_CORE", bookingConfirmed: false };
}
