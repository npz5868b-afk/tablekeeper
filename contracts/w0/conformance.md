# Contract Conformance and Generated Artifact Strategy

## Test layers

1. **Meta-validation:** registry uniqueness/completeness; every C01–C12 entry has producer, consumers, invariants, versioning, and representation; all `$ref` values resolve.
2. **Structural validation:** every valid fixture passes its named schema; structurally invalid cases fail. Formats (`uuid`, `date-time`) are asserted, not treated as annotations.
3. **Semantic validation:** time start precedes end; token issue precedes expiry; citation tenant and validity interval match trace; command tenant matches token/aggregate; accepted-term digest and policy reference are immutable; state transition rules hold.
4. **Compatibility:** old valid fixtures remain accepted by minor/patch revisions; unsupported majors fail explicitly; schema-diff classification is checked against declared bump.
5. **Generated-client parity:** TypeScript and Python round-trip canonical fixtures without field loss; unknown optional fields are tolerated for supported majors; enum-forward compatibility follows declared policy.
6. **Transactional proofs:** PostgreSQL-backed tests prove atomic group allocation, exclusion under races, idempotency, expected-version rejection, atomic modify/cancel, audit/outbox atomicity, and tenant isolation. These cannot be replaced by schema tests or mocks.
7. **Degradation/isolation:** the lifecycle remains correct with internet denied and AI/RAG unavailable; RAG tenant/temporal adversarial cases; replans cannot apply when invalid, unapproved, or stale.
8. **Evidence verification:** manifests reproduce artifact digests and link every Trust Center claim to build ID, test ID, environment, and result.

## Required deterministic commands (tool selection pending A-06)

The repository must expose stable wrappers with these responsibilities:

- `contracts:lint` — registry and schema meta-validation.
- `contracts:test-fixtures` — positive/negative structural and semantic fixtures.
- `contracts:compat` — compare against last released contract package.
- `contracts:generate` — produce TypeScript/Python/OpenAPI outputs from a pinned toolchain.
- `contracts:check-generated` — regenerate cleanly and fail on diff.

Command names may map to the chosen build system, but their behavior and CI gates are normative.

## TypeScript strategy

- Generate transport DTO types and operation clients from OpenAPI 3.1.
- Generate or retain runtime JSON Schema validation at trust boundaries; static types are insufficient.
- Wrap opaque identifiers (`TenantId`, `ReservationId`, `PolicyVersionId`) to reduce accidental interchange.
- Model responses as discriminated success/error unions; never throw away stable error codes.
- Keep deterministic domain interfaces handwritten behind generated adapters; generated code never contains booking rules.

## Python strategy

- Generate typed transport models/clients with strict unknown-required-field and format handling.
- Preserve integer monetary units, UTC instants, and opaque ID wrappers.
- Validate at ingress/egress and provide stable serialization for canonical payload hashing.
- CP-SAT and retrieval code consume generated DTOs through adapters and cannot import persistence mutation primitives.

## Canonicalization and idempotency

The idempotency ledger compares a canonical request digest scoped by tenant, command type, and key. Canonical serialization algorithm and treatment of transport-only fields require Architecture approval (A-03). Until selected, fixtures assert behavior rather than a wire digest.

## Exit readiness

## Architecture-approved execution boundary

Idempotency scope is `(tenant_id, command_type, idempotency_key)`. The fingerprint is SHA-256 over RFC 8785
bytes of the validated semantic body; results/fingerprints are retained at least 30 days and never less than the
retry horizon. Schema/reference/lint, fixtures, compatibility, deterministic generation/diff, cross-runtime
round trips, and manifest hashing are executable contract proof. PostgreSQL allocation contention, same-key
arbitration, outbox atomicity, RLS reads/writes/joins/allocation paths, and pooled-context reset are
implementation-dependent proofs and MUST NOT be replaced by mocks. Benchmark deferrals cannot alter frozen
correctness, isolation, provenance, approval, transactional, or evidence rules.

Structural schemas and fixture intent are ready for review. Automated execution is not ready until a validator/generator toolchain is selected and the authoritative C01–C12 mapping is confirmed.
