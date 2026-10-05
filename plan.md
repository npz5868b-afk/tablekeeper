# TABLEKEEPER Agentic AI Brain Workstream

> Completion status: independently verified and submission-ready. Current accepted evidence (2026-10-02): Concierge 70/70, focused Gonka 14/14, frontend 20/20, and workspace JavaScript-module syntax 65/65, with zero external inference calls during automated verification. The earlier 44/44 result is retained as a historical pre-Gonka checkpoint in `agentic-ai-completion.md`; it is not the current total. See `final-submission-signoff.md` and `final-integration-evidence.json`.

## Bounded objective

Replace scripted concierge intelligence with a stateful production-style agent service while preserving the frozen V3 Screen 01 experience and the accepted Reservation Core 2.0.0 authority boundary.

## Phase 0 inspection

- Existing intelligence: `concierge/src/index.mjs` and `frontend/src/intelligence-adapter.js` use regex/keyword extraction, merge-like state, reference resolution, deterministic hard filtering, and weighted ranking. The browser also has demo-oriented deterministic state in `frontend/src/concierge.js` and `frontend/src/restaurant-catalog.js`.
- Knowledge: `concierge/src/knowledge.mjs` has three synthetic, source-labelled restaurant profiles with atomic claims. The frontend has eight richer display/demo venues, but those are not an authoritative service catalog.
- Reservation boundary: `frontend/src/reservation-boundary.js` implements accepted Contract 2.0.0 search, prepare, confirm, and get. Reservation Core remains the sole availability and transaction authority and is frozen.
- Runtime: `concierge/` is the existing advisory backend package; `frontend/` is a Node static server plus browser ESM; Reservation Core is a separate Node/PostgreSQL service. The safest new service location is `concierge/`.
- Languages: JavaScript/Node ESM throughout concierge, frontend, platform, and Reservation Core; SQL only inside Reservation Core.
- Dependencies: concierge currently has no runtime dependencies. No Azure OpenAI, Microsoft Foundry, LangChain, LangGraph, or model-provider environment convention was found.
- No Git repository was discoverable from these directories during inspection, so preservation relies on strict file ownership and frozen-directory rules rather than branch isolation.

## Frozen boundaries

- Do not redesign or edit V3 Screen 01 visuals. Frontend visual files remain frozen.
- Do not modify `reservation-core/` or accepted Contract 2.0.0 artifacts.
- The agent service may call Reservation Core only through an HTTP adapter matching `reservation-core/docs/frontend-integration-handoff.md`.
- No LLM output may establish restaurant facts, availability, candidate identity, preparation, confirmation, reservation identity, or persistence.
- Azure/OpenAI credentials remain server-side.

## Frozen service contracts

1. `DiningIntent` is complete conversational state. `IntentUpdate` is a partial patch with explicit/inferred provenance, confidence, contradictions, ambiguities, readiness, and a candidate next question. Merge preserves unrelated fields.
2. `LanguageUnderstandingProvider.understand(turn, state)` returns a locally validated `IntentUpdate`; implementations are explicit deterministic test/dev mode, Azure OpenAI/Foundry structured output, and Gonka/OpenAI-compatible transport. Gonka output is an untrusted semantic proposal: bounded normalization, authoritative local-schema validation, exact current-turn evidence checks, and deterministic reduction occur locally.
3. `RestaurantRetriever.retrieve(query, intent)` returns evidence-bearing candidate references. Exact constraints are never delegated to semantic retrieval.
4. `DecisionEngine.rank(intent, candidates)` performs deterministic hard filtering followed by weighted preference scoring and returns an explainable breakdown.
5. `ReservationTools` exposes search, prepare, confirm, and get and delegates unchanged to the accepted Reservation Core HTTP boundary.
6. `ConciergeTurnResponse` exposes public intent state, graph stage, clarification/recommendation/compare/explanation payloads, safe trace IDs, and reservation tool results without hidden reasoning or secrets.

## Meaningful graph

`UNDERSTAND -> MERGE_INTENT -> CHECK_READINESS -> PLAN_CLARIFICATION -> WAIT_FOR_USER` when blocking data is missing. Otherwise: `RETRIEVE_CANDIDATES -> HARD_FILTER -> RANK -> EXPLAIN_RECOMMENDATION -> WAIT_FOR_DECISION`. Decision routing supports `WHY`, `COMPARE`, `REJECT`, `CHANGE_CONSTRAINT`, `CHANGE_PREFERENCE`, and `ACCEPT`. Only `ACCEPT` can enter Reservation Core tools. Checkpoints persist validated state and graph position per thread.

## Work allocation

- Systems Architect: validate/freeze contracts, file ownership, authority boundaries, and frontend-facing API. Documentation/interface work only.
- AI Local Intel Engineer: own `concierge/src/contracts/`, `providers/`, `graph/`, `persistence/`, `tools/reservation-core*`, `service/`, observability, and multi-turn/provider/reservation tests.
- RAG Engineer: own `concierge/src/knowledge/`, `retrieval/`, `decision/`, 24+ fixtures, evidence contracts, ranking tests, and Azure AI Search adapter interface.
- Platform Evidence Engineer: after integration, run the full concierge suite and configuration/smoke evidence.
- Experience Engineering remains paused. Reservation Core remains frozen.

AI and RAG may proceed in parallel only against these frozen contracts. AI owns integration points; RAG must not edit AI-owned files.

## Validated boundary freeze

Architecture review status: **FROZEN**. This section is normative for the Agentic AI workstream.

### File ownership

- AI Local Intel owns `concierge/src/contracts/`, `concierge/src/providers/`, `concierge/src/graph/`, `concierge/src/persistence/`, `concierge/src/service/`, `concierge/src/observability/`, and `concierge/src/tools/reservation-core*`, plus tests that exercise those modules.
- RAG owns `concierge/src/knowledge/`, `concierge/src/retrieval/`, `concierge/src/decision/`, and RAG fixtures/tests. AI may import RAG public interfaces but must not duplicate or bypass their evidence and deterministic-ranking rules.
- `concierge/src/index.mjs` is the public package composition surface. Changes there require coordination between AI and RAG owners; neither workstream may silently replace the other's exports.
- `frontend/` is outside this implementation phase. In particular, no visual file (`frontend/src/screen01.css`, `frontend/src/styles.css`, `frontend/src/v3.css`, `frontend/src/v3-experience.js`, or rendered assets) may be edited. Later non-visual wiring consumes the stable API only after explicit handoff.
- `reservation-core/` and `contracts/releases/2.0.0/` are read-only inputs. No agent-workstream implementation may edit them.

### Authority and trust

- Restaurant facts and evidence originate only from the RAG catalog/retrieval boundary; model text is never a fact source.
- Exact hard-constraint eligibility and ranking are deterministic decision-layer outputs, not language-model judgments.
- Availability, preparation, confirmation, reservation identity, accepted terms, and persistence originate only from Reservation Core 2.0.0.
- The reservation adapter is a pass-through HTTP client for the accepted four-route boundary. It may translate transport failures into safe tool errors, but may not synthesize success, availability, candidates, tokens, or reservation records.
- The existing browser `frontend/src/reservation-boundary.js` and `/runtime-config.js` expose a development-era bearer-token path. They are not an approved production credential boundary and must not be copied into the agent service. All Reservation Core and model credentials remain server-side.

### Stable frontend-facing interface

- The service exposes one conversation-turn operation accepting a caller-generated `threadId`, a caller-generated idempotent `turnId`, and the user's `message`, with optional locale/time-zone context and an explicit prior candidate selection reference.
- The response contains `threadId`, `turnId`, public `intent`, `stage`, exactly one public interaction payload (`clarification`, `recommendations`, `comparison`, `explanation`, or `reservation`), capability/degradation state, and a safe `traceId`.
- Recommendation items contain stable candidate IDs, display facts, deterministic score/breakdown, and evidence references. They never imply live availability or booking success.
- Reservation results preserve authoritative Core status/error semantics and correlation identity. Confirmation UI is permitted only after a successful Core confirm result.
- Hidden prompts, provider payloads, chain-of-thought, credentials, raw checkpoint state, and internal traces are never returned.
- Compatibility rule: additive optional response fields are allowed; removing, renaming, narrowing, or changing authority semantics requires a new interface version and Systems Architect review.

## Delivery and acceptance

1. Implement schemas, providers, graph state, checkpoints, tools, API, catalog, retrieval, ranking, and safe traces.
2. Add required A-N journeys plus malformed/unavailable-provider and no-fabricated-success tests.
3. Same intent plus catalog must reproduce the same eligible set, scores, and ranking.
4. Later turns patch only changed facts; complete requests avoid redundant questions; missing blocking facts get one concise question.
5. Every recommendation, WHY, and COMPARE answer must trace to facts/evidence.
6. Model, retrieval, and Core failures fail safely; local tests require no paid inference.
7. Publish the stable frontend contract before any later non-visual wiring work.

## Championship vertical slice: recommendation to recovery

Status: implemented and verified without modifying frozen Gonka semantics, canonical intent/readiness, retrieval/ranking authority, Contract 2.0.0, or Reservation Core transaction code.

1. Explain: expose the existing deterministic primary explanation as an additive `recommendationExplanation`; it is composed only from matched rank checks and copied retrieval evidence.
2. Fallback: expose additive `smartFallback` state. Preserve every canonical HARD constraint. A rejected primary may yield another ranked restaurant, but its availability is explicitly `NOT_CHECKED` until Reservation Core is queried. Exact-range Core search does not support invented nearby-time results; waitlist and scheduled booking remain unsupported.
3. Guard: expose additive `reservationGuardian`. Only a Core confirm result with `status=CONFIRMED` and a reservation ID becomes confirmed. Retryable lost confirm responses become `UNCERTAIN` and prescribe retrying the identical command with the same idempotency key. Conflicts prescribe authoritative availability recheck with constraints preserved.
4. Experience: retain the accepted panels and styling; show concise grounded reasons, explicit availability provenance, and guest-visible recovery inside the existing reservation journey.
5. Verification: use local deterministic suites only; no external model/inference calls.

## Architecture

```arch
{
  "kind": "layered",
  "title": "Tablekeeper Agentic AI Brain",
  "layers": [
    {"id":"experience","title":"Frozen Experience","items":[{"id":"screen01","label":"V3 Screen 01","detail":"Visual implementation frozen; consumes stable concierge API only"}]},
    {"id":"agent_service","title":"Concierge Agent Service","items":[
      {"id":"agent_api","label":"Frontend-facing API","detail":"Server-side conversation endpoint; no model secrets in browser"},
      {"id":"language_provider","label":"Language Provider","detail":"Gonka / DeepSeek semantic proposals, Azure structured output, or explicit deterministic local mode"},
      {"id":"dining_intent","label":"Local Intent Trust Boundary","detail":"Bounded normalization, authoritative schema validation, exact turn evidence checks, deterministic merge and readiness"},
      {"id":"langgraph","label":"LangGraph Orchestrator","detail":"Explicit state nodes, decisions, interrupts and checkpoints"},
      {"id":"checkpoints","label":"Conversation Checkpoints","detail":"Server-side per-thread graph and intent state"},
      {"id":"safe_traces","label":"Safe Structured Traces","detail":"Transitions, field changes, tools, filtering, scores and failures; no chain-of-thought"}]},
    {"id":"decision","title":"Grounded Restaurant Decisioning","items":[
      {"id":"restaurant_catalog","label":"Restaurant Catalog","detail":"24+ differentiated structured fixtures and grounded evidence"},
      {"id":"retrieval","label":"Retrieval Port","detail":"Deterministic local retrieval; Azure AI Search production adapter"},
      {"id":"hard_filter","label":"Hard Constraint Filter","detail":"Exact operational truth; unknown never passes a hard constraint"},
      {"id":"ranking","label":"Deterministic Ranking","detail":"Reproducible weighted scoring and explainable breakdown"},
      {"id":"explainable_recommendation","label":"Explainable Recommendation","detail":"Concise guest reason projected only from ranked checks and retrieval evidence"},
      {"id":"smart_fallback","label":"Smart Fallback","detail":"Preserves canonical hard constraints; labels alternative restaurant availability unchecked; unsupported options remain explicit"},
      {"id":"restaurant_tools","label":"Restaurant Tools","detail":"Search, evidence, rank and compare"}]},
    {"id":"authority","title":"Frozen Transaction Authority","items":[
      {"id":"reservation_tools","label":"Reservation Tool Adapter","detail":"Search, prepare, confirm and readback through accepted HTTP contract"},
      {"id":"reservation_guardian","label":"Reservation Guardian","detail":"Classifies authoritative outcome vs uncertainty; retries reuse the same confirm idempotency key"},
      {"id":"reservation_core","label":"Reservation Core 2.0.0","detail":"Sole authority for availability and reservations; implementation frozen"}]}
  ],
  "flows": [
    {"from":"screen01","to":"agent_api","label":"Conversation turn / structured response"},
    {"from":"agent_api","to":"langgraph","label":"Thread + user turn"},
    {"from":"langgraph","to":"language_provider","label":"Conversational turn + current canonical intent"},
    {"from":"language_provider","to":"dining_intent","label":"Untrusted semantic proposal"},
    {"from":"dining_intent","to":"langgraph","label":"Validated deterministic canonical intent + readiness"},
    {"from":"langgraph","to":"checkpoints","label":"Persist state and interrupts"},
    {"from":"langgraph","to":"retrieval","label":"RETRIEVE_CANDIDATES"},
    {"from":"retrieval","to":"restaurant_catalog","label":"Hybrid evidence lookup"},
    {"from":"retrieval","to":"hard_filter","label":"Candidate set"},
    {"from":"hard_filter","to":"ranking","label":"Eligible candidates"},
    {"from":"ranking","to":"explainable_recommendation","label":"Matched checks + evidence only"},
    {"from":"ranking","to":"smart_fallback","label":"Grounded alternatives; constraints preserved"},
    {"from":"ranking","to":"restaurant_tools","label":"Scores and evidence"},
    {"from":"langgraph","to":"restaurant_tools","label":"Tool calls"},
    {"from":"langgraph","to":"reservation_tools","label":"ACCEPT only"},
    {"from":"reservation_tools","to":"reservation_core","label":"Accepted Contract 2.0.0 HTTP"},
    {"from":"reservation_tools","to":"reservation_guardian","label":"Result, conflict, or transport uncertainty"},
    {"from":"reservation_guardian","to":"screen01","label":"Authoritative status or safe recovery"},
    {"from":"langgraph","to":"safe_traces","label":"Redacted operational events"},
    {"from":"langgraph","to":"agent_api","label":"Grounded response + UI state"}
  ]
}
```
