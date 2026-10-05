# W0 Ambiguity and Architecture Decision Log

No item below is silently resolved. Proposed dispositions are recommendations for Systems Architect approval.

| ID | Severity | Ambiguity | Proposed decision | Blocks |
|---|---|---|---|---|
| A-01 | Blocking | The authoritative Architecture Gate document defining the exact C01–C12 names/content is absent from the workspace; only the approved semantic summary and Phase 1 plan are present. | Supply the frozen package or approve the proposed mapping in `contract-registry.json` as the canonical numbering. | C0 and all specialist handoffs |
| A-02 | Blocking | Reservation lifecycle/state vocabulary beyond confirmed/cancelled is unspecified (prepared is modeled as a separate preparation, not a reservation state). | Confirm preparation is a separate expiring resource and approve authoritative reservation states/transitions. | Reservation Core, Experience |
| A-03 | Blocking | Idempotency key scope, retention, canonical request hashing, and replay response storage are unspecified. | Scope by tenant + command type + key; compare canonical semantic-payload digest; retain at least through business retry horizon; replay the original logical result. Architect must set algorithm/retention. | Reservation Core, audit proof |
| A-04 | Major | Expected-version transport binding and precise HTTP/error mapping are unspecified. | Make version explicit in the command contract and bind to `If-Match`; reject disagreement if both representations appear. Approve status mapping separately from error codes. | Generated clients, Experience |
| A-05 | Blocking | Confirmation-token cryptographic form, TTL, rotation, one-use semantics, and whether proposed resources are binding are unspecified. | Keep token opaque; server-authenticated; tenant/venue/preparation/policy/terms/time scoped; short-lived. Treat resources as proposals and revalidate at commit. Define key rotation and logical consumption with idempotent replay. | Reservation Core security |
| A-06 | Major | Schema validator, OpenAPI generator, TypeScript generator, and Python generator are not selected. | Run a deterministic tool bake-off after Architecture confirms representations; pin versions/digests. Do not select from convenience alone. | Executable generation/conformance |
| A-07 | Blocking | Atomic resource interval boundary/buffer semantics and table-group membership/version timing are unspecified. | Use half-open occupied intervals including policy-defined buffers; snapshot/expand group at commit inside the transaction. Architect must confirm buffer and group-version behavior. | Exclusion constraints/concurrency proof |
| A-08 | Major | Policy categories, acceptance evidence, signer identity/privacy, and cancellation-policy applicability rules are unspecified. | Store immutable policy-version IDs plus canonical content digest, acceptance instant/channel/actor reference; minimize PII. Approve required policy categories. | Policy fixtures, Experience |
| A-09 | Major | Tenant isolation enforcement mechanism is unspecified (application predicates vs PostgreSQL RLS plus roles). | Require defense in depth with PostgreSQL RLS for tenant-owned data and explicit service roles, subject to database design review. | Reservation/RAG isolation proof |
| A-10 | Major | Intelligence mode transition hysteresis, health thresholds, capability names, and recovery policy are unspecified. | Approve an explicit state machine with circuit-breaker thresholds and cautious recovery; correctness remains identical in every mode. | AI spike only; not booking P0 |
| A-11 | Major | RAG temporal semantics (event time vs publication time), deletion, supersession, and source ACL model are unspecified. | Require tenant + ACL + `[validFrom, validTo)` filtering before ranking, immutable source versions, tombstones, and provenance digests. | RAG spike only |
| A-12 | Blocking for replanning | Base snapshot identity, objective lexicographic priorities, validator rule set, approval digest, and atomic apply command are unspecified. | Hash/version complete authoritative inputs; approval binds exact proposal+validation digest; apply rechecks snapshot and constraints in one transaction. | Replanning spike/apply |
| A-13 | Major | Audit rejection events cannot always be in the same transaction as a rolled-back mutation; definition of exactly-once logical audit is unspecified. | Transactional outbox for committed facts; separate append-only command-attempt ledger for rejected/rolled-back attempts, correlated by command ID. Approve retention/privacy. | Platform/Evidence |
| A-14 | Major | Evidence signing, trusted clock, artifact storage, and Trust Center claim vocabulary are unspecified. | Content-address manifests and artifacts; optionally sign in CI; distinguish observed fact from claim; approve trust root and retention before external claims. | Platform/Evidence |
| A-15 | Major | Local date/time DST ambiguity handling is unspecified. | Require venue IANA zone plus explicit offset/fold resolution; reject nonexistent local instants and require disambiguation for repeated instants. | Availability/UX |
| A-16 | Major | Tool authorization and actor-delegation semantics are unspecified. | Registry declares capability and state effect; runtime authorization is deterministic and binds tenant/actor; models never confer authority. | AI/tools/security |

## Semantic changes requiring Architecture review

## Normative dispositions

The original questions below are retained. The Architecture Gate freezes A-01 ACCEPT; A-02 ACCEPT; A-03 MODIFY;
A-04 ACCEPT; A-05 MODIFY; A-06 MODIFY; A-07 MODIFY; A-08 MODIFY; A-09 ACCEPT; A-10 DEFER TO BENCHMARK;
A-11 MODIFY; A-12 MODIFY; A-13 ACCEPT; A-14 MODIFY; A-15 ACCEPT; A-16 ACCEPT. No consumer may guess, and
benchmark deferrals cannot alter the frozen invariant boundary.

Any change to reservation authority, exclusion/atomicity, interval semantics, table-group expansion, availability authority, prepare/confirm boundary, version/idempotency behavior, immutable policy facts, intelligence degradation order, deterministic-tool exclusivity, RAG truth/isolation, replan validation/approval/apply boundary, or evidence claim integrity is Architecture-significant regardless of wire compatibility.
