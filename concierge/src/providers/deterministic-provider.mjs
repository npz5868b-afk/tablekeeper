import { extractIntent } from "../index.mjs";
import { validateIntentUpdate } from "../contracts/dining-intent.mjs";

const field = item => ({ value: item.value, provenance: "EXPLICIT", confidence: item.confidence ?? 1, sourceText: item.sourceText });

export class DeterministicLanguageUnderstandingProvider {
  async understand(turn, state = {}) {
    const extracted = extractIntent(turn, { sourceMode: "DETERMINISTIC" });
    const lower = String(turn).toLowerCase();
    let intentType = extracted.intentType;
    if (/\bwhy\b/.test(lower)) intentType = "WHY";
    else if (/\bcompare\b|what about/.test(lower)) intentType = "COMPARE";
    else if (/\b(no|another|reject)\b/.test(lower)) intentType = "REJECT";
    else if (/\b(book|accept|reserve)\b/.test(lower)) intentType = "ACCEPT";
    else if (/\b(make it|change|actually)\b/.test(lower)) intentType = "CHANGE_CONSTRAINT";
    const slots = Object.fromEntries(Object.entries(extracted.slots).filter(([key]) => key !== "cuisine" && key !== "location").map(([key, value]) => [key, field(value)]));
    const constraints = extracted.constraints.map(item => ({ ...item, provenance: "EXPLICIT", confidence: 1 }));
    const removeConstraintKeys = [];
    if (/\b(anywhere|location doesn't matter|any area)\b/.test(lower)) removeConstraintKeys.push("location");
    if (/\b(any cuisine|cuisine doesn't matter)\b/.test(lower)) removeConstraintKeys.push("cuisine");
    return validateIntentUpdate({ intentType, slots, constraints, removeConstraintKeys, ambiguities: [], contradictions: [], candidateNextQuestion: null });
  }
}
