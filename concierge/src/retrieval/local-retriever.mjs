import { FIXTURE_ACL, FIXTURE_TENANT_ID, materializeFixtureCandidates } from "../knowledge/fixture-catalog.mjs";
import { isVisible, validateRetrievalContext } from "./retrieval-policy.mjs";

const normal = value => String(value ?? "").trim().toLowerCase();
const tokens = value => new Set(normal(value).split(/[^a-z0-9-]+/).filter(item => item.length > 2));

export class DeterministicLocalRetriever {
  constructor({ candidates = materializeFixtureCandidates(), limit = 24, defaultContext = { tenantId: FIXTURE_TENANT_ID, callerAcl: FIXTURE_ACL, asOf: "2026-10-01T00:00:00.000Z" } } = {}) { this.candidates = structuredClone(candidates); this.limit = limit; this.defaultContext = defaultContext; }
  async retrieve(query, intent, rawContext = this.defaultContext) {
    const context = validateRetrievalContext(rawContext);
    const terms = tokens(query);
    return this.candidates.filter(candidate => isVisible(candidate,context)).map(candidate => {
      const searchable = normal([candidate.name, candidate.facts.cuisine, candidate.facts.location, ...(candidate.facts.ambience ?? []), ...(candidate.facts.features ?? []), ...(candidate.facts.occasions ?? [])].join(" "));
      const lexicalScore = [...terms].filter(term => searchable.includes(term)).length;
      return { ...structuredClone(candidate), retrieval: { provider: "LOCAL_DETERMINISTIC", lexicalScore, exactConstraintsDelegated: false, filterAppliedBeforeRanking: true, asOf: context.asOf } };
    }).sort((a,b) => b.retrieval.lexicalScore - a.retrieval.lexicalScore || a.id.localeCompare(b.id)).slice(0,this.limit);
  }
}
