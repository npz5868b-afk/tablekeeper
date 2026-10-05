const CUISINES = ["japanese", "italian", "mediterranean", "malaysian", "thai", "french", "indian", "chinese"];
const LOCATIONS = ["bangsar", "damansara", "chow kit", "klcc", "bukit bintang"];
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const ORDINALS = { first: 0, second: 1, third: 2, fourth: 3 };

const normal = value => String(value ?? "").trim().toLowerCase();
const unique = values => [...new Set(values)];
const clone = value => structuredClone(value);

function slot(value, sourceText, confidence = 1) {
  return { value, sourceText, confidence };
}

function classifyIntent(text) {
  if (/\b(cancel|cancellation)\b/.test(text)) return "CANCEL_RESERVATION";
  if (/\b(change|modify|move|update)\b/.test(text)) return "MODIFY_RESERVATION";
  if (/\b(confirm|book it|reserve it)\b/.test(text)) return "CONFIRM_RESERVATION";
  if (/\b(my reservation|find booking|retrieve)\b/.test(text)) return "RETRIEVE_RESERVATION";
  if (/\b(policy|corkage|dress code|cancellation terms)\b/.test(text)) return "ASK_POLICY";
  if (/\b(find|looking|restaurant|dinner|lunch|eat|somewhere|option|one)\b/.test(text)) return "SEARCH_AVAILABILITY";
  return "UNKNOWN";
}

export function extractIntent(input, { sourceMode = "LOCAL_AI" } = {}) {
  const source = String(input ?? "").trim();
  const text = normal(source);
  const slots = {};
  const party = text.match(/(?:just\s+)?(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight)\s+of\s+us\b|(?:just\s+)?us\s+(\d+|one|two|three|four|five|six|seven|eight)\b|(?:(?:for|party of)\s+)?(\d+|one|two|three|four|five|six|seven|eight)\s+(?:people|guests|persons?)\b|(?:for|party of)\s+(\d+|one|two|three|four|five|six|seven|eight)\b/);
  if (party) {
    const partyValue = party[1] || party[2] || party[3] || party[4];
    slots.partySize = slot(Number(partyValue) || WORD_NUMBERS[partyValue], party[0]);
  }
  const budgetRange = text.match(/(?:around\s*)?rm\s*(\d{2,5})\s*[–-]\s*(\d{2,5})(?:\s*total)?/);
  const budget = text.match(/(?:under|below|up to|max(?:imum)?|around)\s*(?:rm\s*)?(\d{2,5})|rm\s*(\d{2,5})/);
  if (budgetRange) {
    slots.budgetMin = slot(Number(budgetRange[1]), budgetRange[0]);
    slots.budgetMax = slot(Number(budgetRange[2]), budgetRange[0]);
    slots.budgetBasis = slot(/total/.test(budgetRange[0]) ? "TOTAL" : "UNSPECIFIED", budgetRange[0]);
  } else if (budget) slots.budgetMax = slot(Number(budget[1] || budget[2]), budget[0]);
  const cuisine = CUISINES.find(value => text.includes(value));
  if (cuisine) slots.cuisine = slot(cuisine, cuisine);
  const location = LOCATIONS.find(value => text.includes(value));
  if (location) slots.location = slot(location, location);
  const time = text.match(/\b(tonight|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day)(?:\s+(?:at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  const calendarDate = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (calendarDate) slots.dateText = slot(calendarDate[0], calendarDate[0]);
  else if (time) slots.dateText = slot(time[1], time[1]);
  if (time?.[2]) slots.timeText = slot(`${time[2]}:${time[3] || "00"}${time[4] ? ` ${time[4]}` : ""}`, time[0]);
  const standaloneTime = text.match(/(?:make it|at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/) ?? text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!slots.timeText && standaloneTime) slots.timeText = slot(`${standaloneTime[1]}:${standaloneTime[2] || "00"}${standaloneTime[3] ? ` ${standaloneTime[3]}` : ""}`, standaloneTime[0]);
  const occasion = text.match(/\b(anniversary|birthday|date night|business dinner)\b/);
  if (occasion) slots.occasion = slot(occasion[1], occasion[0]);

  const constraints = [];
  const add = (key, value, hardness, sourceText) => constraints.push({ key, value, hardness, sourceText });
  if (slots.cuisine) add("cuisine", slots.cuisine.value, /\b(must|only|need)\b/.test(text) ? "HARD" : "SOFT", slots.cuisine.sourceText);
  if (slots.location) add("location", slots.location.value, /\b(in|must|only|need)\b/.test(text) ? "HARD" : "SOFT", slots.location.sourceText);
  if (slots.budgetMax) {
    const divisor = slots.budgetBasis?.value === "TOTAL" && slots.partySize?.value ? slots.partySize.value : 1;
    add("pricePerPersonMax", slots.budgetMax.value / divisor, /\b(under|below|up to|max(?:imum)?)\b/.test(text) ? "HARD" : "SOFT", slots.budgetMax.sourceText);
  }
  for (const [pattern, key, value] of [
    [/\bvegan\b/, "dietary", "vegan"], [/\bvegetarian\b/, "dietary", "vegetarian"],
    [/\bgluten[- ]free\b/, "dietary", "gluten-free"], [/\bwheelchair|step[- ]free|accessible\b/, "accessibility", "wheelchair-accessible"],
    [/\bdoes(?:n't| not) eat beef|no beef\b/, "dietary", "no-beef"],
    [/\b(?:not too noisy|quiet|intimate|calm)\b/, "ambience", "quiet"], [/\bromantic\b/, "occasionAmbience", "romantic"],
    [/\belegant\b/, "style", "elegant"], [/\bprivate|secluded\b/, "seating", "private"],
    [/\bview|window|skyline|terrace\b/, "feature", "view"]
  ]) {
    const match = text.match(pattern);
    if (match) {
      const nearby = text.slice(Math.max(0, match.index - 18), match.index);
      const explicitlySoft = /\b(prefer|preferably|ideally)\b/.test(nearby);
      const explicitlyHard = /\b(must|need|required|only)\b/.test(nearby);
      add(key, value, !explicitlySoft && (["dietary", "accessibility"].includes(key) || explicitlyHard) ? "HARD" : "SOFT", match[0]);
      if (key === "seating" && /\bmore\s+(?:private|secluded)\b/.test(text)) constraints.at(-1).weight = 2;
    }
  }
  const intentType = classifyIntent(text);
  const missingRequiredSlots = ["PREPARE_RESERVATION", "CONFIRM_RESERVATION"].includes(intentType)
    ? [!slots.partySize && "partySize", !slots.dateText && "dateText", !slots.timeText && "timeText"].filter(Boolean)
    : [];
  return { intentType, confidence: intentType === "UNKNOWN" ? 0.25 : 0.9, sourceMode, slots, constraints, missingRequiredSlots, source };
}

export function createConversationState({ sourceMode = "LOCAL_AI" } = {}) {
  return { version: 1, sourceMode, turn: 0, intent: null, slots: {}, constraints: [], presentedCandidates: [], selectedCandidateId: null, history: [] };
}

function resolveReference(text, presented) {
  const lower = normal(text);
  const ordinal = Object.entries(ORDINALS).find(([word]) => lower.includes(`${word} one`) || lower.includes(`${word} option`));
  if (ordinal) return presented[ordinal[1]]?.id ?? null;
  const number = lower.match(/(?:option|number)\s+(\d+)/);
  if (number) return presented[Number(number[1]) - 1]?.id ?? null;
  if (/\b(it|that one|this one)\b/.test(lower) && presented.length) return presented[0].id;
  return null;
}

export function applyTurn(previous, input) {
  const state = clone(previous);
  const extracted = extractIntent(input, { sourceMode: state.sourceMode });
  const negatedKeys = [];
  const text = normal(input);
  state.slots = { ...(state.slots || {}), ...extracted.slots };
  if (/\b(anywhere|location doesn't matter|any area)\b/.test(text)) negatedKeys.push("location");
  if (/\b(any cuisine|cuisine doesn't matter)\b/.test(text)) negatedKeys.push("cuisine");
  state.constraints = state.constraints.filter(item => !negatedKeys.includes(item.key));
  for (const incoming of extracted.constraints) {
    state.constraints = state.constraints.filter(item => item.key !== incoming.key);
    state.constraints.push(incoming);
  }
  const selected = resolveReference(input, state.presentedCandidates);
  if (selected) state.selectedCandidateId = selected;
  state.turn += 1;
  state.intent = extracted;
  state.history.push({ turn: state.turn, input: extracted.source, intentType: extracted.intentType, selectedCandidateId: selected });
  return state;
}

function fact(candidate, constraint) {
  if (constraint.key === "pricePerPersonMax") return candidate.facts?.pricePerPerson;
  if (constraint.key === "dietary") return candidate.facts?.dietary?.[constraint.value];
  if (constraint.key === "accessibility") return candidate.facts?.accessibility?.[constraint.value];
  if (constraint.key === "ambience") return candidate.facts?.ambience?.includes(constraint.value);
  if (constraint.key === "occasionAmbience") return candidate.facts?.occasionAmbience?.includes(constraint.value);
  if (constraint.key === "style") return candidate.facts?.style?.includes(constraint.value);
  if (constraint.key === "seating") return candidate.facts?.seating?.includes(constraint.value);
  if (constraint.key === "feature") return candidate.facts?.features?.includes(constraint.value);
  return candidate.facts?.[constraint.key];
}

function matches(candidate, constraint) {
  const value = fact(candidate, constraint);
  if (value === undefined || value === null) return { known: false, matches: false };
  if (constraint.key === "pricePerPersonMax") return { known: true, matches: Number(value) <= Number(constraint.value) };
  if (typeof value === "boolean") return { known: true, matches: value };
  return { known: true, matches: normal(value) === normal(constraint.value) };
}

export function rankCandidates(candidates, constraints, { limit = 3 } = {}) {
  const hard = constraints.filter(item => item.hardness === "HARD");
  const soft = constraints.filter(item => item.hardness === "SOFT");
  const evaluated = candidates.map(candidate => {
    const hardResults = hard.map(constraint => ({ constraint, ...matches(candidate, constraint) }));
    const softResults = soft.map(constraint => ({ constraint, ...matches(candidate, constraint) }));
    const eligible = hardResults.every(result => result.known && result.matches);
    const score = softResults.reduce((sum, result) => sum + (result.known && result.matches ? (result.constraint.weight ?? 1) : 0), 0);
    return { candidate, eligible, score, hardResults, softResults };
  });
  return evaluated.filter(item => item.eligible).sort((a, b) => b.score - a.score || String(a.candidate.id).localeCompare(String(b.candidate.id))).slice(0, limit);
}

export function recommend(state, candidates, options) {
  const ranked = rankCandidates(candidates, state.constraints, options);
  const recommendations = ranked.map(item => {
    const reasons = item.softResults.filter(result => result.known && result.matches).map(result => `${result.constraint.key}: ${result.constraint.value}`);
    const hardReasons = item.hardResults.map(result => `${result.constraint.key}: ${result.constraint.value}`);
    return { id: item.candidate.id, name: item.candidate.name, score: item.score, reasons: unique([...hardReasons, ...reasons]).slice(0, 3), advisory: true };
  });
  const next = clone(state);
  next.presentedCandidates = recommendations.map(({ id, name }) => ({ id, name }));
  const summary = recommendations.length
    ? `I found ${recommendations.length} grounded match${recommendations.length === 1 ? "" : "es"}. These are recommendations only; availability, pricing, dietary safety, and booking status must be verified by their authoritative sources.`
    : "I couldn't find a candidate with known facts satisfying every hard constraint. I haven't assumed missing availability, pricing, dietary, accessibility, or booking facts.";
  return { state: next, recommendations, summary, reservationAuthority: "RESERVATION_CORE", bookingConfirmed: false };
}

export function recommendFromKnowledge(state, options) {
  const candidates = loadGroundedCandidates();
  const output = recommend(state, candidates, options);
  const evidencePaths = new Set(state.constraints.map(constraint => {
    if (constraint.key === "pricePerPersonMax") return "pricePerPerson";
    if (constraint.key === "dietary" || constraint.key === "accessibility") return `${constraint.key}.${constraint.value}`;
    if (constraint.key === "ambience") return "ambience";
    if (constraint.key === "occasionAmbience") return "occasionAmbience";
    if (constraint.key === "style") return "style";
    if (constraint.key === "seating") return "seating";
    if (constraint.key === "feature") return "features";
    return constraint.key;
  }));
  output.recommendations = output.recommendations.map(recommendation => {
    const candidate = candidates.find(item => item.id === recommendation.id);
    return { ...recommendation, evidence: candidate.evidence.filter(item => evidencePaths.has(item.path)) };
  });
  return output;
}

export function explainSelectedRecommendation(state, recommendations) {
  const selected = recommendations.find(item => item.id === state.selectedCandidateId);
  if (!selected) return { status: "UNKNOWN_REFERENCE", answer: null, evidence: [] };
  return {
    status: "GROUNDED",
    restaurantId: selected.id,
    answer: selected.reasons.join("; "),
    evidence: clone(selected.evidence || []),
    reservationAuthority: "RESERVATION_CORE",
    bookingConfirmed: false
  };
}

export function createReservationHandoff(state) {
  return {
    status: state.selectedCandidateId ? "HANDOFF_REQUIRED" : "MISSING_RESTAURANT_REFERENCE",
    restaurantId: state.selectedCandidateId,
    requestedSlots: clone(state.slots || {}),
    reservationAuthority: "RESERVATION_CORE",
    bookingConfirmed: false
  };
}

export { answerKnowledgeQuestion, FIXTURE_CORPUS_NOTICE, loadGroundedCandidates, retrieveKnowledge } from "./knowledge.mjs";
import { loadGroundedCandidates } from "./knowledge.mjs";
