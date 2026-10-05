# Factory Evidence Index

Room: `d859dea8-1b27-42a6-91cb-c58f31068f04`

Tablekeeper's governing Factory rule is simple: **implementation does not certify itself**. This index leads directly to the strongest retained proof.

| ID | Rating | Factory event | Seat(s) | Initial state | Finding / gate | Material change | Independent verification | Final verdict | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| F01 | **GOLD** | C0 rejection and recovery | Systems Architect, Contract Steward, independent host verifier, Coordinator | Frozen C01-C12 architecture; W0 remained a candidate | `C0 remains FAIL`; twelve harness/evidence defects; four failed attempts retained | Harness corrected for argument passing, exit status, logging, attempt isolation, cleanup, digests, and network evidence | 56/56 execution artifacts, 168/168 package hashes, nine PostgreSQL assertions, network isolation, read-only retention | Coordinator `ACCEPTED` | [FAIL boundary](architecture/phase1/handoff-manifest.json), [defect audit](contracts/w0/recovery/harness-audit.json), [independent rerun](contracts/w0/recovery/post-recovery-verification.json), [C0 rerun](contracts/w0/c0-checklist.md), [acceptance](architecture/phase1/c0-coordinator-acceptance.json) |
| F02 | **STRONG** | C1A PostgreSQL gate hold and release | Reservation Core, verification/gate authority | Static migration tests and syntax checks passed | PostgreSQL integration `BLOCKED`; `HOLD_PENDING_POSTGRESQL17_INTEGRATION_PASS` | Actual PostgreSQL 17 host validation added | Migration up, privileges, RLS, down migration, and digest validation recorded PASS; execution provenance is operator-reported | C1A `PASS` | [Initial HOLD](reservation-core/tests/migration/c1a-validation-checkpoint.json), [gate PASS](architecture/phase1/c1a-gate-disposition.json) |
| F03 | **STRONG** | Reservation Core implementation did not self-certify | ReservationCore Engineer, Platform Evidence Engineer, Coordinator | 45/45 implementation tests reported green | Warm pooled-loss verification still required; final closure pending | Independent evidence work proceeded after the implementation handoff | Observed Platform PostgreSQL-loss, corrected-harness, and database-backed tasks | Coordinator closed only after the evidence result | [BAND timeline](band-export/BAND-EVIDENCE.md), [pool-safety tests](reservation-core/tests/http/pool-safety.test.mjs), [final evidence](final-integration-evidence.json) |
| F04 | **STRONG ENGINEERING EVIDENCE** | Concurrency/parity falsification and corrected proof | Engineering proof operator; no conclusive BAND-seat binding | Initial parity proof assumed guest-safe projections exposed internal UUIDs | Assumption was invalid | Proof changed to tenant-scoped authoritative database inspection; product behavior unchanged | Corrected 24/24 parity and real 50-client race | One winner, 49 conflicts, zero 5xx, zero overlapping active allocations; retries preserved 1/1 | [Proof narrative](evidence/tablekeeper-concurrency-proof.md), [machine record](evidence/tablekeeper-concurrency-proof.json) |
| F05 | **NORMAL** | RAG evidence-bearing specialist handoff | RAG Engineer -> Coordinator | RAG-owned implementation scope | No rejection recorded | Scoped work handed off with executable results | Syntax 5/5, focused retrieval/decision 8/8, full Concierge 63/63 reported in the room record | Specialist handoff complete; later current totals are recorded separately | [BAND timeline](band-export/BAND-EVIDENCE.md), [retrieval tests](concierge/tests/retrieval-decision.test.mjs), [completion record](agentic-ai-completion.md) |
| F06 | **OPERATIONAL EVIDENCE - NOT BAND REJECTION** | Docker healthcheck recovery | Repository operator/author; no BAND-seat attribution | Reservation Core health probe was unauthenticated | Runtime probe received an authentication response instead of its expected route response | Healthcheck began using the existing disposable-stack bearer token; authentication remained enforced | Subsequent clean-volume Docker runtime validation is documented | PostgreSQL and app healthy; Guest HTTP 200 | [Healthcheck](container/healthcheck.mjs), [verified Docker record](README.md#docker-judge-path) |

## Judge Fast Path

1. Read the [C0 failed-before-passed case](FACTORY.md#3-case-file-01---c0-failed-before-it-passed).
2. Inspect the machine-readable [Coordinator C0 acceptance](architecture/phase1/c0-coordinator-acceptance.json).
3. Compare the [C1A HOLD](reservation-core/tests/migration/c1a-validation-checkpoint.json) with the later [C1A PASS](architecture/phase1/c1a-gate-disposition.json).
4. Inspect the human-observed [BAND Coordinator timeline](band-export/BAND-EVIDENCE.md).
5. Inspect the corrected [concurrency and parity proof](evidence/tablekeeper-concurrency-proof.md).
6. Reproduce the application using the [README Docker judge path](README.md#docker-judge-path).

## Provenance Boundary

The BAND timeline is human-observed and is not a native export. The repository does not claim complete historical Git provenance, specialist Git authorship, a complete public C0 raw run tree, or measured Factory/model cost.
