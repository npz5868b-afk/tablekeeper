# Tablekeeper W0 Contract Foundation

Status: **C0 candidate — Architecture review required**  
Scope: contracts only; no application feature implementation.

This package translates the approved Architecture Gate semantics into machine-readable contract surfaces. PostgreSQL 17 remains the sole transactional reservation authority. Availability is advisory. All state changes use deterministic domain tools, idempotency, expected-version checks where applicable, and commit-time database enforcement.

## Package index

- `contract-registry.json` — canonical proposed C01–C12 registry, ownership, consumers, invariants, representations, and compatibility behavior.
- `schemas/tablekeeper-contracts.schema.json` — implementation-neutral JSON Schema 2020-12 bundle.
- `openapi-strategy.md` — OpenAPI and transport binding strategy.
- `fixtures/valid.json` — representative happy-path and boundary fixtures.
- `fixtures/invalid.json` — dangerous invalid fixtures with expected stable error codes.
- `conformance.md` — validation, semantic test, and generated-client strategy.
- `ambiguities.md` — unresolved decisions and proposed Architecture dispositions.
- `c0-checklist.md` — exact C0 gate criteria and current verdict.

## Normative language

MUST, MUST NOT, SHOULD, and MAY are normative. JSON Schema establishes structural validity; semantic and transactional invariants are enforced by conformance tests and, for allocations, authoritative PostgreSQL constraints. A schema-valid message is not proof that a command may commit.

## Versioning rules

1. Each envelope carries `contractId` and `contractVersion` (SemVer).
2. Patch changes clarify documentation or tighten no accepted instance.
3. Minor changes may add optional fields or new enum values only where consumers are required to tolerate unknown values.
4. Major changes include removing/renaming fields, changing meaning, narrowing accepted values, changing idempotency/version semantics, or altering an invariant.
5. Invariant-affecting changes require a Systems Architect decision even if wire-compatible.
6. Producers emit one declared version. Consumers reject unsupported majors with `CONTRACT_VERSION_UNSUPPORTED` and ignore unknown optional fields within a supported major.
7. Stored facts (policy versions, accepted terms, audit/evidence) retain the contract version used when created and are never rewritten merely to upgrade a schema.
8. Generated artifacts include the registry/schema digest; hand-edited generated types are forbidden.

## Shared primitives

Identifiers are opaque UUID strings unless Architecture approves another form. Timestamps are RFC 3339 UTC instants. Local dining time is represented separately with IANA time zone. Monetary amounts use integer minor units plus ISO 4217 currency. Time ranges are half-open `[start, end)`. Tenant identity is explicit on every authoritative or evidence-bearing envelope. Sensitive confirmation-token material is never logged; only a one-way digest/reference may appear in audit evidence.

## Stable error taxonomy

Errors are stable machine codes grouped as: `VALIDATION_*`, `AUTH_*`, `TENANT_*`, `NOT_FOUND`, `CONFLICT_*`, `STALE_VERSION`, `IDEMPOTENCY_KEY_REUSED`, `TOKEN_*`, `POLICY_*`, `CAPABILITY_*`, `DEPENDENCY_*`, `PLAN_*`, and `INTERNAL`. Error responses include retryability and correlation ID but never leak cross-tenant existence or database internals.

## Contract authority boundary

## Architecture-approved W0 1.0.0 remediation

The authority is `phase1-architecture-gate/1.0.0`. The implementation registry is `contract-registry.json`;
the transport is `openapi/tablekeeper.openapi.yaml`. Pinned controls are `package-lock.json`,
`requirements.lock`, and `oasdiff.sha256`. In Node.js 22 LTS and Python 3.12 run `npm ci --ignore-scripts`,
`python3.12 -m pip install --require-hashes -r requirements.lock`, `scripts/install-oasdiff.ps1`,
`npm run contracts:all`, and `npm run contracts:hash`. Network is disabled during execution. The formal
disposition is `contract-freeze-manifest.json`.

RAG output, model output, availability responses, UI state, and CP-SAT proposals are non-authoritative. Only validated deterministic domain commands applied by PostgreSQL transactions may mutate reservation truth. A replan requires independent validation, manager approval, stale-plan rejection, and atomic database application.
