@npz5868b

# TABLEKEEPER Agentic AI Brain — Completion Report

Status: **COMPLETE — independently verified; current submission evidence supersedes the historical checkpoint below**

## Current submission evidence — 2026-10-02

The accepted current repository state includes the Gonka language-understanding integration. Local/mock verification observed Concierge **70/70**, focused Gonka **14/14**, frontend **20/20**, and workspace `.mjs` syntax **65/65**, with zero external inference calls. The separately performed human Gonka T6 acceptance reported requested and actual model `deepseek-ai/DeepSeek-V4-Flash-0731` with status `ACCEPTED`. That human observation proves semantic interpretation for the T6 utterance only; it does not prove live restaurant availability, retrieval, reservation, or end-to-end booking behavior. See `final-submission-signoff.md` and `final-integration-evidence.json` for the current judge-facing record.

The 44/44 result later in this document is preserved as the historical pre-Gonka Agentic AI closure checkpoint. It must not be read as the current final test total.

## 1. Architecture before / after

- Before: regex/keyword parsing, browser/demo intelligence, three grounded fixtures, deterministic advisory ranking, and no production model or graph orchestration.
- Current: conversational input → Gonka/OpenAI-compatible semantic proposal, Azure OpenAI/Microsoft Foundry structured output, or explicit deterministic local parsing → local `IntentUpdate` validation and current-turn evidence enforcement → deterministic reducer/readiness → stateful graph/checkpoints → grounded retrieval → hard filters → deterministic weighted ranking → explicit tools → accepted Reservation Core HTTP boundary.
- Authority remains strict: the LLM understands and communicates; the graph orchestrates; retrieval supplies evidence; the decision engine ranks; Reservation Core alone owns availability and reservations.

## 2. Files added / changed

Added under `concierge/`: contracts, Azure and deterministic providers, graph, checkpointer, safe traces, Reservation Core HTTP tools, service/composition/server, 24-fixture catalog, local/Azure Search retrieval adapters, deterministic decision engine, smoke script, environment template, deployment guide, A–N manifest, and focused integration tests.

Key changed files: `package.json`, `README.md`, `src/graph/concierge-graph.mjs`, `src/contracts/dining-intent.mjs`, `src/observability/safe-trace.mjs`, and relevant tests. Frontend and Reservation Core remained frozen.

## 3. DiningIntent contract

Closed-schema `DiningIntent` and `IntentUpdate` cover occasion/context, party, schedule, areas, budgets, cuisine inclusion/exclusion, dietary/allergy/accessibility needs, privacy/noise/romance/business/celebration/formality, indoor/outdoor/view/private room/late service/seating, hard/soft constraints, rejected venues, trade-offs, known/inferred facts, confidence, blocking gaps, and optional information. PATCH/MERGE semantics preserve unrelated facts and correctly support multiple constraints sharing a category.

## 4. Azure provider interface

`LanguageUnderstandingProvider.understand(turn, state)` has deterministic, Azure OpenAI/Foundry, and Gonka implementations. Azure uses server-side credentials and provider-native strict structured output. Gonka does not depend on provider-native `response_format`: it embeds the authoritative exported schema in the prompt, then locally performs bounded normalization, required-property checks, strict shared-contract validation, and exact current-turn evidence validation. Malformed JSON, schema-invalid output, fabricated evidence, and provider unavailability fail closed before state entry.

## 5. LangGraph-style graph

The explicit workflow implements UNDERSTAND, MERGE_INTENT, CHECK_READINESS, clarification/wait, retrieve, hard-filter, rank, explain, decision wait, WHY, COMPARE, REJECT, constraint/preference changes, and ACCEPT routing. Transitions now record only nodes actually entered and failures are categorized by provider, retrieval, decision, checkpoint, reservation, or unexpected source.

## 6. Persistence / checkpoints

Per-thread server-side checkpoints preserve validated intent, graph stage, candidates, selections, rejections, and conversational continuity without reconstructing state from visible text.

## 7. Retrieval architecture

Deterministic local retrieval is the credential-free development implementation. A server-side Azure AI Search adapter defines the production hybrid-search port. Semantic retrieval improves discovery/evidence but never overrides exact hard constraints.

## 8. Restaurant knowledge

The authoritative prototype catalog contains 24 meaningfully differentiated synthetic venues with structured operational attributes plus atomic evidence claims, stable claim IDs, excerpts, source locators, capture timestamps, and fixture notices. The original three-profile corpus remains only for compatibility tests.

## 9. Ranking algorithm

Candidates first pass exact hard filtering; false and unknown hard facts fail closed. Eligible candidates receive deterministic weighted preference scores, stable tie-breaking, and inspectable score breakdowns. WHY and COMPARE responses use the actual ranked evidence.

## 10. Tool contracts

Restaurant tools support search, evidence, ranking, comparison, rejection, and explanation. Reservation tools expose search availability, prepare, confirm, and get reservation.

## 11. Reservation Core delegation

Reservation tools use only the accepted Contract 2.0.0 HTTP routes. No domain logic or success is duplicated. Confirmation remains authoritative only after a successful Core result; failures/conflicts never fabricate reservations.

## 12. Observability

Safe traces cover field changes, provenance, graph nodes, tool calls, filter counts, score breakdowns, selected recommendation, reservation calls, failure categories, and correlation IDs without chain-of-thought. Public responses expose only a safe `traceId`. Direct probes verified redaction for api-key/api_key/api key case variants, token values, and bearer credentials.

## 13. Historical pre-Gonka tests and exact results

- At that historical checkpoint, `npm.cmd run check`: **44 passed, 0 failed, 0 skipped/todo**; syntax validation passed. This result has been superseded for current submission reporting by the 70-test Concierge suite above.
- Packaged smoke: passed.
- Isolated server probes: health, conversation turn, exact response shape, and malformed-request handling passed.
- The authoritative A–N manifest includes all 14 required journey labels and maps each to an executable Node test.

## 14. Local development

Local mode is deterministic and credential-free. Use `npm start`, `npm run smoke`, and `npm run check` from `concierge/`. The service exposes `GET /healthz` and `POST /v1/concierge/turn`.

## 15. Azure production configuration

`concierge/.env.example` and `DEPLOYMENT.md` document server-only Azure OpenAI/Foundry and Gonka configuration, Azure AI Search endpoint/index configuration, index fields, and Reservation Core connectivity. No credentials are committed or returned to browsers. Gonka requested and response-reported model identities remain separately observable without exposing credentials.

## 16. Frontend integration contract

The stable public response includes `threadId`, `turnId`, public intent/stage, public message, exactly one typed `interaction`, capability/degradation state, and safe `traceId`. Internal transitions, checkpoints, history, and trace events do not escape. V3 Screen 01 was not redesigned or modified.

## 17. Remaining limitations

- Production Azure inference, Azure AI Search, and live Reservation Core end-to-end execution require deployed services and real server-side credentials; local verification uses deterministic providers/adapters.
- The checkpoint implementation is currently in-memory and should be replaced by a durable shared store for horizontally scaled production deployment.
- Restaurant fixtures are synthetic prototype data and must be replaced or governed by a production ingestion/source-verification pipeline.
- The workspace has no discoverable Git repository/provenance ledger; frozen-boundary verification used timestamps and direct inspection rather than commit history.

## Historical independent closure evidence

Platform Evidence independently verified 44/44 tests, smoke and isolated server probes, response shape, malformed-provider behavior, all secret variants, documentation, A–N mapping, and unchanged frozen-boundary timestamps at the pre-Gonka checkpoint. No residual defects were found in that bounded review; current submission evidence is recorded above.
