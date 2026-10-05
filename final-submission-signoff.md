# Tablekeeper Final Submission Sign-off

Status: **ACCEPT — ready for final human review and submission**  
Evidence date: 2026-10-02 (Asia/Kuala_Lumpur)

## Current accepted evidence

| Verification | Result | Evidence class |
|---|---:|---|
| Concierge full suite | 70 passed, 0 failed | Local automated tests with mocked/in-process dependencies |
| Gonka focused suite | 14 passed, 0 failed | Local automated tests with injected fake transports |
| Frontend regression suite | 20 passed, 0 failed | Local automated tests |
| Workspace `.mjs` syntax | 65 passed, 0 failed | Local `node --check` verification |
| External inference calls during automated verification | 0 | Tests use fake transports; no live provider request was made |

The focused Gonka tests are a subset of the 70-test Concierge suite and must not be added to 70 as if they were separate tests.

## Evidence provenance

The earlier 44/44 Agentic AI result is a valid historical pre-Gonka closure checkpoint. It is preserved and labelled as historical in `agentic-ai-completion.md`; it is not the current final Concierge total. The current accepted total is 70/70.

This workspace is not a discoverable Git worktree. This package therefore makes no commit, branch, clean-tree, or source-revision claim. Current-state provenance consists of direct file inspection and the local verification results above.

The separately completed human Gonka T6 semantic acceptance reported:

- requested model: `deepseek-ai/DeepSeek-V4-Flash-0731`
- actual model: `deepseek-ai/DeepSeek-V4-Flash-0731`
- status: `ACCEPTED`

That human observation proves only semantic interpretation of the tested T6 utterance: ordered party-size correction from 6 to 5, `next Friday`, 19:45 normalization, separate post-19:00 flexibility, and conversation-friendly preference weighted above lively ambience. It is not evidence of live restaurant availability, retrieval quality, reservation behavior, or an end-to-end booking.

## Frozen architecture and authority

The accepted request path is:

conversational user input → Gonka/DeepSeek semantic proposal → bounded local normalization → required-property and authoritative `IntentUpdate` validation → exact current-turn evidence validation → deterministic canonical-intent reducer and readiness → evidence-bearing retrieval → deterministic hard filtering and ranking → Reservation Core authoritative reservation operations → frontend experience.

The model output is untrusted until every local validation gate succeeds. The model cannot establish restaurant facts, readiness, availability, ranking, reservation identity, or confirmation.

- Ordered operations make the extracted correction `6 → 5` deterministic at reduction time.
- Deterministic readiness asks for missing party size, date, or time and honors ambiguities/contradictions.
- `candidateNextQuestion` is advisory; it cannot make a ready intent unready or block retrieval.
- Retrieval supplies evidence-bearing candidates. Exact hard constraints and weighted ranking remain deterministic.
- Reservation Core remains the sole authority for availability, preparation, confirmation, reservation identity, accepted terms, and persistence.
- Gonka configuration, network, HTTP, timeout, malformed-output, schema, or evidence failure fails closed, preserves prior canonical state, and reports language capability as `DEGRADED`; no silent local substitution occurs.
- The Gonka adapter performs at most one inference request per turn and contains no retry or health-probe inference path.

## Scope and limitations

- Automated provider verification is mocked and does not establish current external-provider availability.
- The human T6 run is one semantic acceptance, not a provider SLA or broad model certification.
- Production Azure inference, Azure AI Search, and live Reservation Core end-to-end operation require deployed services and separately controlled credentials.
- Concierge checkpoints are in-memory and are not suitable for horizontally scaled production without a durable shared store.
- The local restaurant catalog is synthetic prototype data and requires a governed production ingestion/source-verification pipeline.
- The absence of discoverable Git metadata prevents commit-level provenance claims.

No implementation defect was found, no frozen implementation was reopened, and no further engineering agent is required for submission assembly. Final human review should confirm packaging and presentation only.
