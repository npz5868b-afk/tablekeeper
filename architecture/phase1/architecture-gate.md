# Tablekeeper Phase 1 Architecture Gate

Baseline: `phase1-architecture-gate/1.0.0`  
Status: **APPROVED ARCHITECTURE BASELINE — NORMATIVE FOR PHASE 1**  
Authority: Systems Architect  
Effective date: 2026-09-29  
Scope: contract semantics and implementation boundaries; no application feature implementation

This is the repository-visible authority for the Phase 1 Architecture Gate. It freezes the meaning and numbering of C01-C12. Candidate schemas and fixtures under `contracts/w0/` implement this baseline only after Contract Steward remediation and conformance. If candidate wording conflicts with this document, this document controls. Changes to a frozen invariant require a recorded Systems Architect decision and a compatible contract release or major version.

## System invariants

1. PostgreSQL 17 is the sole transactional authority for reservations and allocations. Availability, UI state, AI output, RAG output, and replan proposals are advisory.
2. Every occupied table expands to atomic resource rows protected at commit by database constraints. A multi-resource allocation commits all or none.
3. Preparation is a separate expiring resource, never a reservation state and never an allocation guarantee.
4. State-changing commands are tenant-scoped and idempotent. Mutable aggregates use expected-version optimistic concurrency in addition to database allocation constraints.
5. Policy versions and the accepted terms attached to a confirmed reservation are immutable historical facts.
6. FULL_AI, LOCAL_AI, and SURVIVAL invoke the same allowlisted deterministic domain tools. Intelligence mode never changes booking correctness.
7. Retrieval is tenant-, ACL-, and time-filtered and is never transactional truth.
8. Replanning is propose, independently validate, explicitly approve, then atomically apply against an unchanged snapshot.
9. Committed domain facts and their outbox records share a transaction. Rejected and rolled-back attempts use a separate attempt ledger.
10. Trust/evidence claims are allowed only when traceable to a revision, test definition, execution, result, environment, and hashed artifact.

## Authoritative C01-C12 registry

All contracts are frozen at C0 except fields explicitly marked benchmark-dependent. Wire contracts use SemVer. Additive optional fields may be minor only when consumers tolerate unknown optional fields; removal, renaming, narrowing, semantic change, or invariant change is major. An invariant change always requires Architecture review even if wire-compatible.

### C01 — Shared primitives and command/query envelopes

- Purpose: canonical identifiers, instants, local-time input, money, ranges, actors, contract references, command/query identity, correlation, tenant scope, and payload envelopes.
- Producer/owner: Contract Steward owns schemas; each API adapter produces envelopes.
- Consumers: every specialist and runtime boundary.
- Invariants: authoritative/evidence messages carry tenant identity; commands carry command ID, idempotency key, correlation ID, actor, type, and issued time; queries cannot mutate; IDs are opaque; instants are RFC 3339 UTC; local input also carries an IANA zone and explicit offset/fold resolution; occupied ranges are half-open.
- Compatibility: frozen at C0. Primitive meaning or envelope identity changes are major.

### C02 — Errors and lifecycle operation results

- Purpose: stable success/result envelopes and machine-actionable failures across search, prepare, confirm, retrieve, modify, and cancel.
- Producer/owner: Contract Steward owns taxonomy; Reservation Core adapters produce domain results.
- Consumers: Experience, AI & Local Intelligence, Platform & Evidence, generated clients.
- Invariants: stable machine code, correlation ID, explicit retryability, safe public detail, no cross-tenant existence or database leakage; transport status never replaces the domain error code.
- Compatibility: frozen at C0. New codes may be minor only when consumers have an unknown-code fallback; changed meaning/removal is major.

### C03 — Availability and atomic allocation

- Purpose: advisory availability candidates plus authoritative allocation resource/time semantics.
- Producer/owner: Reservation Core.
- Consumers: Experience, AI & Local Intelligence, Replanning.
- Invariants: search is advisory; commit rechecks; groups expand to complete atomic resources in one transaction; any overlap on a constituent resource conflicts; no partial group allocation; database exclusion is authoritative.
- Compatibility: frozen at C0. Interval, buffer, resource expansion, or atomicity changes are major.

### C04 — Reservation preparation, confirmation token, and confirm

- Purpose: create an expiring preparation and safely carry its exact confirmation inputs into one atomic confirm command.
- Producer/owner: Reservation Core.
- Consumers: Experience, AI & Local Intelligence, Platform & Evidence.
- Invariants: preparation is separate from reservation and creates no allocation; token is opaque to clients, authenticated, scoped, expiring, and logically one-use; confirm revalidates policy/preparation/token and availability; success creates reservation, allocations, accepted terms, idempotency result, and outbox atomically.
- Compatibility: frozen at C0. Token claim or validation semantics are major; cryptographic algorithm/key provider may change compatibly if validation behavior does not.

### C05 — Reservation lifecycle, expected version, modify, and cancel

- Purpose: authoritative reservation representation, legal transitions, retrieval, optimistic concurrency, atomic reallocation, and cancellation.
- Producer/owner: Reservation Core.
- Consumers: Experience, AI & Local Intelligence, Replanning, Platform & Evidence.
- Invariants: legal states are `CONFIRMED`, `CANCELLED`, `COMPLETED`, and `NO_SHOW`; creation enters `CONFIRMED`; `CONFIRMED -> CANCELLED|COMPLETED|NO_SHOW`; terminal states do not transition in Phase 1; modify is allowed only while `CONFIRMED` and does not change lifecycle state; stale expected version rejects without mutation; each successful mutation advances version exactly once; modification swaps allocation atomically; cancellation releases it atomically.
- Compatibility: frozen at C0. State/transition/version semantics are major.

### C06 — Immutable policy versions and accepted terms

- Purpose: version venue policies and retain the exact terms accepted at confirmation.
- Producer/owner: Policy administration owns publication; Reservation Core owns confirmation capture.
- Consumers: Reservation Core, Experience, Platform & Evidence.
- Invariants: published policy-version rows are immutable; corrections create a new version; confirmation stores every applicable policy-version ID, canonical content SHA-256, rendered/locale terms artifact reference or snapshot, accepted-at instant, channel, and minimal actor reference; reservation facts never float to latest policy; later policy changes never rewrite accepted terms.
- Compatibility: frozen at C0. Optional evidence is minor; applicability or historical meaning changes are major. Required Phase 1 category is booking/cancellation terms; deposits, privacy notices, and venue rules are recorded when applicable, not invented as universal requirements.

### C07 — Dining intent and deterministic typed tools

- Purpose: structured intent and allowlisted tool definitions/results used by UI and intelligence orchestration.
- Producer/owner: AI orchestration or deterministic UI adapter proposes; Contract Steward owns tool schemas; domain owners implement tools.
- Consumers: AI & Local Intelligence, Reservation Core adapters, Experience.
- Invariants: model output is untrusted proposal; registry declares input/output schema, required capability, authorization, and state effect; runtime authorization binds authenticated actor and tenant; models cannot grant authority; only deterministic tools may mutate through domain services.
- Compatibility: frozen at C0; benchmark-independent. Additive optional slots/tools may be minor; changed state effect or authorization is major.

### C08 — Intelligence modes and capability state

- Purpose: expose effective intelligence mode, capabilities, health reason, and controlled transitions.
- Producer/owner: AI & Local Intelligence runtime; transition policy is owned jointly by AI runtime owner and Systems Architect.
- Consumers: Experience, Platform & Evidence, AI orchestration.
- Invariants: `FULL_AI` means approved remote/full model path healthy; `LOCAL_AI` means approved on-device/local model path healthy without cloud dependency; `SURVIVAL` means no generative model dependency and deterministic forms/search/tools remain; effective capabilities are an explicit set and callers gate on capabilities, not mode name; degradation may be immediate on breaker/open health failure; recovery requires configured consecutive healthy probes/cooldown and must not flap; correctness and tool authorization are identical in all modes.
- Compatibility: mode meanings/order frozen at C0. Exact health thresholds, cooldowns, local model, latency/quality targets, and hardware sizing are benchmark-dependent and configuration-versioned.

### C09 — Retrieval, citation, and provenance

- Purpose: tenant-safe retrieval traces and verifiable citations over versioned sources.
- Producer/owner: RAG.
- Consumers: AI & Local Intelligence, Experience, Platform & Evidence.
- Invariants: authorization derives tenant plus caller ACL; tenant/ACL and `[validFrom, validTo)` filters apply before ranking; `asOf` is domain-effective time while publication/ingestion times remain separate metadata; source versions are immutable; supersession closes validity and deletion creates a tombstone/removes searchable material; every answer claim based on retrieval cites source ID, immutable version, locator/span, content digest, and retrieval trace; RAG is never reservation truth; SURVIVAL is lexical-only and applies the same filters/citations.
- Compatibility: isolation, temporal, ACL, and provenance semantics frozen at C0. Embedding, reranker, dense index, fusion weights, and model choices are benchmark-dependent.

### C10 — Replan proposal, validation, approval, and atomic apply

- Purpose: safely convert disruption inputs into a reviewable, validated, approved, atomic set of mutations.
- Producer/owner: Replanning proposes; independent deterministic validator validates; manager approves; Reservation Core applies.
- Consumers: Reservation Core, Experience, Platform & Evidence.
- Invariants: proposal contains complete authoritative input snapshot ID/version and canonical proposal digest; validation binds that proposal digest, validator/rule-set version, snapshot, result, and validation digest; manager approval binds exact proposal digest + validation digest + snapshot/version + approver + expiry; apply rejects missing/expired/mismatched approval, changed snapshot, stale aggregate versions, or failed constraints; apply revalidates and commits all changes/outbox facts in one transaction. Approval of one plan cannot authorize a materially different plan.
- Compatibility: handshake and binding frozen at C0. Objective weights/lexicographic priorities and solver/model choice are benchmark/product-policy dependent; a changed proposal always requires new validation and approval.

### C11 — Audit, transactional outbox, and command-attempt ledger

- Purpose: complete, correlated evidence for committed facts and unsuccessful command attempts without weakening transaction semantics.
- Producer/owner: Reservation Core writes domain/outbox; command boundary writes attempt ledger; Platform & Evidence exports/observes.
- Consumers: Platform & Evidence, Contract Steward, Coordinator.
- Invariants: domain mutation and committed-fact outbox record are in the same PostgreSQL transaction; neither commits alone; one logical command/result emits one logical business event despite retries. The attempt ledger is append-only, tenant/actor/command/correlation/idempotency-digest/build correlated, and records accepted/rejected/rolled-back/unknown-response outcomes without raw secrets. A rejection that performs no domain mutation may be written in its own short transaction; rollback diagnostics may be recorded after rollback. Logs/metrics/traces are observational and may be eventually delivered, but cannot substitute for the outbox or attempt ledger.
- Compatibility: frozen at C0. Identity, atomicity, or secret-handling changes are major; retention/redaction durations are deployment policy.

### C12 — Build-linked evidence manifest

- Purpose: make every competition claim reproducible and traceable to the exact build and artifacts.
- Producer/owner: Platform & Evidence.
- Consumers: Coordinator, Systems Architect, Contract Steward, Trust Center presentation.
- Invariants: each result links source revision, dirty-state indicator, dependency lock/image digests, contract/schema digests, test-definition ID and digest, execution ID, timestamps/environment, result, relevant artifact paths and SHA-256; internet-denial claims link network-control evidence; observed facts are distinguished from interpretations/claims.
- Compatibility: frozen at C0. Minimum tamper evidence is a canonical JSON manifest plus SHA-256 for every referenced artifact and the manifest, produced by CI/evidence runner and retained as a read-only competition artifact. Signing/transparency infrastructure is optional and deferred unless the competition environment supplies a stable trust root.

## Cross-contract frozen semantics

### Reservation and preparation

A preparation has `preparationId`, tenant/venue, requested party/time, proposed resource set or group reference plus resolved snapshot, applicable immutable policy versions, terms digest/artifact, creation/expiry, and status `OPEN|CONSUMED|EXPIRED|REVOKED`. It reserves nothing. `OPEN -> CONSUMED` occurs only with successful confirmation in the same transaction; expiry is time-derived and may be materialized; revoke is an explicit administrative/security action. Confirming an expired/revoked preparation fails. After successful confirmation, an identical idempotent retry replays the original result even though preparation is consumed.

Reservation state is limited to C05 states. “Prepared,” “modified,” and “expired” are not reservation states. Retrieve returns committed state and current version. Phase 1 does not include waitlist, seated, or reinstatement states.

### Idempotency

- Scope: unique `(tenant_id, command_type, idempotency_key)`; keys are opaque client strings and are stored only in protected form where practical. Aggregate identity is part of the semantic payload, not the uniqueness scope.
- Retention: retain request fingerprint and replay result for at least 30 days and never less than the maximum client retry/offline queue horizon; destructive expiry is a versioned operational policy. Reservation confirm records should normally be retained for the reservation’s operational lifetime. Reuse after expiry is unsupported and must be documented rather than silently treated as safe.
- Fingerprint: SHA-256 over RFC 8785 JSON Canonicalization Scheme bytes of the semantic command body after schema validation, including tenant, command type, target ID, expected version, and token/preparation reference; excluding transport headers, correlation ID, command ID, issued time, tracing, and the idempotency key itself. Unicode and numbers follow RFC 8785; no lossy normalization.
- Replay: persist a stable logical result envelope (success or deterministic domain rejection), resulting aggregate ID/version, and response contract version. Identical retry returns that original logical result; transport correlation may be new and points to the original command/result.
- Mismatch: same scope/key with another fingerprint returns `IDEMPOTENCY_KEY_REUSED`, performs no mutation, and reveals no original payload.
- Concurrency: first writer atomically claims a ledger row. Same-key contenders with the same fingerprint wait/read and replay the terminal result; different fingerprints reject. A recoverable `IN_PROGRESS` lease/owner protocol may resolve crashed workers, but only one domain transaction can finalize. Unknown/transient infrastructure failure is not cached as a deterministic business result.

### Confirmation token

The transport token is opaque. The server authenticates it with an AEAD envelope or signed/MACed reference and supports key ID/rotation; confidentiality is preferred because claims may contain business data. TTL is 15 minutes by default and MUST NOT exceed the preparation expiry; TTL is configuration-versioned. It binds token ID, tenant, venue, preparation ID, party size, requested interval, resolved resource/group snapshot, policy-version IDs, terms digest, issued/expiry instants, and token format version. Proposed resources are not guaranteed: confirmation re-expands/revalidates and database constraints decide. Consumption is atomic with confirm and logically one-use; idempotent replay of the successful command returns the original result. A different command/key using a consumed token returns `TOKEN_CONSUMED`. Expired, tampered, or scope-mismatched tokens fail without existence leakage. If availability became stale, confirm returns `CONFLICT_ALLOCATION`, commits neither reservation nor consumption, and a new preparation is required.

### Occupied intervals, time zones, and DST

All persisted allocation instants are UTC and exclusion ranges are half-open `[occupied_start, occupied_end)`. Occupancy is derived from dining interval plus the immutable policy-version buffers effective for that confirmation: `[start - pre_buffer, end + post_buffer)`. Adjacent ranges do not overlap. Venue-local requests carry IANA time zone and explicit numeric offset; nonexistent spring-forward times reject, repeated fall-back times require explicit offset/fold selection. Converting to UTC occurs before availability and is revalidated at commit. A timezone database update does not rewrite existing instants.

### Table groups and versions

A group is a versioned definition of constituent atomic table IDs. Prepare records the group version and resolved constituent snapshot. Confirm expands the referenced group inside the transaction and locks/validates the group version; if changed, it returns `STALE_RESOURCE_SNAPSHOT` and requires re-prepare. The transaction attempts exclusion-protected allocations for every constituent and commits all or none. Every combination competes on the same atomic-resource rows/ranges, preventing conflicts between a group and any other group or single-table booking. Modify performs acquire-new/validate/version-update/release-old atomically, never exposing a partially released state.

### Expected version

Every mutable aggregate has an integer version initialized to 1. Modify, cancel, policy draft edits, table/group definition edits, and replan apply require an explicit expected version in the command body. HTTP also sends a strong `If-Match` derived from that version; if both are present they must agree. Missing precondition is `PRECONDITION_REQUIRED` (HTTP 428); stale/mismatch is `STALE_VERSION` (HTTP 412); allocation/state conflict is 409; semantic validation is 422. A successful logical mutation increments once; no-op replay returns the prior result/version and does not increment. Bulk apply provides expected versions for every touched aggregate plus the base snapshot.

### Tenant isolation

Accept the PostgreSQL RLS plus service-role proposal with bounded complexity. Tenant-owned tables use `tenant_id NOT NULL`, RLS enabled and forced, and policies based on transaction-local tenant context. The application runtime uses a non-owner, non-`BYPASSRLS` role; migrations use a separate owner role unavailable to request handling. Cross-tenant foreign keys include tenant identity where practical. Background jobs set and verify tenant context per transaction. A narrowly scoped maintenance role may bypass RLS only in offline/admin workflows and is audited. Application predicates remain useful but are not the security boundary. PostgreSQL integration tests must prove reads, writes, joins, allocation paths, and pooled-connection context reset cannot cross tenants.

## A-01 through A-16 disposition

| ID | Disposition | Architectural decision and rationale |
|---|---|---|
| A-01 | ACCEPT | The proposed C01-C12 numbering and names are now the canonical mapping in this baseline. Stable IDs avoid breaking handoffs. |
| A-02 | ACCEPT | Preparation is a separate expiring resource. Freeze preparation lifecycle and the four-state reservation lifecycle above to keep allocation truth unambiguous. |
| A-03 | MODIFY | Adopt tenant + command type + key scope, RFC 8785/SHA-256 semantic fingerprint, 30-day minimum retention, original-result replay, mismatch rejection, and atomic same-key arbitration as specified above. |
| A-04 | ACCEPT | Expected version is explicit in commands and mirrored by strong `If-Match`; disagreement rejects. Freeze 428/412/409/422 bindings while domain codes remain authoritative. |
| A-05 | MODIFY | Opaque authenticated token, 15-minute default bounded by preparation expiry, exact binding, transactional logical consumption, key rotation, and mandatory commit-time revalidation. Resources are proposals, not guarantees. |
| A-06 | MODIFY | Pin the practical toolchain below; use thin checked-in wrappers and lockfiles instead of a bake-off or multi-generator framework. |
| A-07 | MODIFY | Use buffered half-open UTC occupied ranges; group snapshot is resolved at prepare and version-checked/re-expanded in the confirm transaction. Any change requires re-prepare. |
| A-08 | MODIFY | Freeze immutable policy IDs + canonical digest + rendered terms reference/snapshot + acceptance facts. Require booking/cancellation terms and record other categories only when applicable. |
| A-09 | ACCEPT | Use PostgreSQL RLS plus separated migration/application roles as a meaningful defense, without enterprise IAM machinery. |
| A-10 | DEFER TO BENCHMARK | Freeze mode meanings, explicit capabilities, transition ownership, breaker behavior, and guarded recovery; defer numerical thresholds, cooldown, local model, and hardware targets. |
| A-11 | MODIFY | Freeze domain-effective `[validFrom, validTo)` plus separate publication/ingestion time, immutable versions, pre-ranking tenant/ACL/time filters, tombstones, and citation digests. |
| A-12 | MODIFY | Approval must bind exact proposal digest, validation digest, and authoritative snapshot/version. Apply rechecks all three plus aggregate versions and constraints atomically. Objectives/solver remain benchmark/policy-dependent. |
| A-13 | ACCEPT | Transactional outbox covers committed facts; a separate attempt ledger covers rejected/rolled-back attempts. Observability is non-authoritative and may be eventual. |
| A-14 | MODIFY | Competition minimum is canonical build-linked manifest plus SHA-256 artifact graph retained read-only. CI signing is optional until a stable trust root exists. |
| A-15 | ACCEPT | Persist UTC instants with venue IANA zone context; reject nonexistent local times and require explicit offset/fold for repeated times. |
| A-16 | ACCEPT | Tool registry declares state effect/capability; deterministic authorization binds authenticated actor and tenant. A model proposal never grants authority. |

No A-01-A-16 item remains architecturally vague. Items marked DEFER TO BENCHMARK have their invariant boundary frozen and do not block contract remediation.

## Contract toolchain freeze (A-06)

Use Node.js 22 LTS and Python 3.12 in pinned competition images. Check in `package-lock.json` and a hash-locked Python requirements file; CI installs with `npm ci` and `pip --require-hashes`. Network access is permitted only during image/dependency assembly, not contract execution.

| Need | Frozen tool |
|---|---|
| JSON Schema Draft 2020-12 + formats | `ajv@8.17.1`, `ajv-formats@3.0.1` with strict mode and explicit format assertions |
| `$ref` resolution/bundling | `@apidevtools/json-schema-ref-parser@16.0.3`; remote references disabled |
| OpenAPI 3.1 lint/validation | `@redocly/cli@2.53.3`, configured offline with a checked-in ruleset and telemetry/update checks disabled |
| Fixture execution | checked-in Node test runner using `node:test`, AJV, semantic assertions, and PostgreSQL integration tests; fixtures are data, not prose mutations |
| TypeScript generation | `openapi-typescript@7.13.0` for deterministic runtime-free transport types; handwritten thin HTTP adapter if needed |
| Python generation | `datamodel-code-generator==0.52.0` targeting Pydantic v2 models; handwritten thin transport adapter if needed |
| Compatibility | `oasdiff@1.11.7` pinned release binary/container plus replay of prior valid fixtures; Architecture review remains required for semantic invariants |

OpenAPI 3.1 is a checked-in transport document referencing/bundling the canonical JSON Schemas. Generated DTOs are not domain logic and are never hand-edited. Each generated tree embeds the source digest. The required deterministic wrappers remain `contracts:lint`, `contracts:test-fixtures`, `contracts:compat`, `contracts:generate`, and `contracts:check-generated`.

## Required Contract Steward remediation

1. Change the registry from proposed `0.1.0-c0-candidate` to an implementation release that cites this baseline and exactly matches the C01-C12 definitions, owners, consumers, frozen/benchmark status, and version rules.
2. Expand the schema. It currently lacks authoritative structures for preparation lifecycle, operation result envelopes, explicit expected-version commands, idempotency ledger/replay, policy-version content/artifact, table-group version/snapshot, ACL/publication/tombstone provenance, exact replan digests/approval binding, command-attempt ledger, and full evidence execution/test/artifact links.
3. Tighten existing definitions: reservation state enum/transitions; opaque-token transport versus internal claims; time-zone/DST inputs; occupied/buffered ranges; capability representation; RAG pre-filter/provenance fields; event attempt/outbox separation. Use `additionalProperties: false` consistently at trust boundaries or document forward-compatible extension points.
4. Replace prose-only invalid fixture mutations with executable input plus expected schema/domain/error assertion. Add at least one valid and dangerous invalid executable case per contract and every frozen semantic above, including concurrent same-key behavior, consumed token replay, stale group snapshot, pooled RLS context, exact approval binding, and manifest hash verification.
5. Create the OpenAPI 3.1 document and pin lockfiles/tool configs/wrappers for the frozen toolchain. Resolve all references offline, validate formats, generate TS/Python artifacts twice, and fail on diff.
6. Update OpenAPI strategy: `If-Match` is mandatory and must equal body `expectedVersion`; add 428/412/409/422 mapping; define stable success/result envelopes and opaque token field.
7. Update conformance to name RFC 8785/SHA-256 canonicalization, 30-day minimum retention, database/RLS/contention proofs, benchmark deferrals, and exact approval/evidence digest checks.
8. Update README and ambiguity log to cite this artifact. Record A-01-A-16 as the dispositions above; do not erase the original questions.
9. Recompute a package content digest, attach generated-artifact digests, run every deterministic command, and update the C0 checklist with evidence. The Contract Steward—not Architecture—issues the rerun verdict; Coordinator accepts/rejects the gate.

## Benchmark-dependent decisions

- C08: local model identity, quantization, context size, target hardware, numerical latency/quality limits, breaker thresholds/cooldowns.
- C09: embedding model/dimension, dense index parameters, RRF weights, reranker/model, quality/latency thresholds.
- C10: solver choice beyond the approved proposal boundary, objective weights/lexicographic priorities, performance limits.
- C11: deployment-specific audit/attempt retention duration beyond applicable competition needs.
- C12: optional signing service/trust root and long-term external retention.

These deferrals cannot change frozen isolation, correctness, provenance, approval, transactional, or evidence-linkage semantics.

## Explicit non-goals

No application features, database migrations, domain services, UI, model selection, embedding/reranker selection, solver implementation, enterprise PKI, cross-region design, or specialist activation is authorized by this artifact. It removes architectural blockers only.

## Architecture readiness disposition

Architecture considers this package ready for Contract Steward remediation. C0 remains failed until the Steward updates the W0 artifacts, installs/pins the toolchain, executes conformance and generation checks, publishes digests, and reruns the C0 checklist. Architecture does not declare C0 PASS here.
