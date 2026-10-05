# OpenAPI and Machine-Readable Representation Strategy

JSON Schema Draft 2020-12 is the canonical structural representation. OpenAPI 3.1 imports, rather than duplicates, those schemas. Transport bindings are secondary: domain semantics remain valid for HTTP, local IPC, CLI, or tests.

## HTTP binding rules

- Queries: `POST /v1/availability/search`, `GET /v1/reservations/{id}`. Search uses POST because its structured criteria may grow; it remains side-effect free.
- Commands: `POST /v1/reservation-preparations`, `POST /v1/reservations:confirm`, `POST /v1/reservations/{id}:modify`, `POST /v1/reservations/{id}:cancel`.
- State-changing requests require `Idempotency-Key`; versioned mutations also require `If-Match` or an equivalent explicit `expectedVersion`, with one canonical binding selected before C0.
- Responses carry correlation ID, contract version, and reservation version/ETag where applicable.
- `409` represents allocation/state conflict, `412` stale expected version, `422` structurally valid but semantically invalid input, `503` unavailable optional capability. Exact status mapping requires Architecture/API review (A-04).
- Confirmation token is an opaque transport string. Only the server decodes/verifies claims; clients must not depend on token encoding.

## Generation

## Frozen Architecture disposition

The checked-in transport is `openapi/tablekeeper.openapi.yaml`. Versioned mutations require both strong
`If-Match` and body `expectedVersion`; they MUST agree. Missing preconditions map to
`PRECONDITION_REQUIRED`/428, stale or disagreeing versions to `STALE_VERSION`/412, allocation/state conflicts
to 409, and semantic validation to 422. Stable domain codes remain authoritative. Frozen generators are
`openapi-typescript@7.13.0` and `datamodel-code-generator==0.52.0` targeting Pydantic v2.

1. Validate canonical schemas and fixtures.
2. Build an OpenAPI 3.1 document from checked-in operation bindings referencing canonical `$defs`.
3. Generate TypeScript and Python artifacts from the same pinned OpenAPI input.
4. Normalize output and embed source schema SHA-256.
5. Regenerate in CI and fail on diff.

No generator is selected in W0. Selection requires a deterministic comparison of Draft 2020-12 support, discriminated union handling, nullable fields, format validation, reproducible output, and runtime footprint. Generated DTOs do not implement domain validation or database correctness.
