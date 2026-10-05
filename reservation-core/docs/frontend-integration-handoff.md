@npz5868b/experience-engineer HTTP boundary pause is released. The Contract 2.0.0 browser-callable Reservation Core boundary is formally ACCEPTED for frontend integration. Do not reopen or modify the accepted Reservation Core implementation unless integration exposes a genuine contract failure.

Authoritative local boundary

- Base URL: `http://127.0.0.1:4180`
- Allowed browser origin: exact `RESERVATION_CORE_FRONTEND_ORIGIN`, default `http://localhost:4173`
- All responses are JSON with `Cache-Control: no-store`; success bodies are passed through unchanged from ReservationService.

Authentication and tenant binding

- Send `Authorization: Bearer <RESERVATION_CORE_DEV_BEARER_TOKEN>` on every request.
- The server binds the bearer token to `RESERVATION_CORE_TENANT_ID`, `RESERVATION_CORE_ACTOR_ID`, and `RESERVATION_CORE_ACTOR_TYPE` (`GUEST` by default).
- Every request envelope's `tenantId` and `actor` must exactly match that trusted server-side binding. Missing/invalid auth is `401 AUTH_REQUIRED`; disagreement is `403 TENANT_SCOPE_VIOLATION`.
- Browser requests are accepted only from the configured exact origin; other origins fail `403 AUTH_FORBIDDEN`.

Endpoints and shapes

1. `POST /v1/availability/search`
   - Headers: `Authorization`, `Content-Type: application/json`.
   - Body: C03 `2.0.0` query envelope: `contract`, `tenantId`, `queryId`, `correlationId`, `issuedAt`, `actor`, `queryType: "SEARCH_AVAILABILITY"`, and `parameters: { venueId, partySize, requestedRange: { start, end } }`.
   - Result: `{ tenantId, venueId, candidates, authoritativeAtCommitOnly: true }`. Each candidate carries stable `candidateId`, TABLE resources, half-open UTC `timeRange`, `advisory: true`, and `observedAt`.

2. `POST /v1/reservation-preparations`
   - Headers additionally require `Idempotency-Key`; it must exactly equal body `idempotencyKey` (16-128 characters).
   - Body: C04 `2.0.0` command envelope with `commandType: "PREPARE_RESERVATION"` and `payload: { venueId, partySize, requestedRange, selection: { candidateId, resourceIds } }` using an unchanged returned candidate.
   - Result: authoritative preparation containing `preparationId`, resolved resource snapshot, policy IDs, terms digest/artifact, expiry, `status: "OPEN"`, and opaque `confirmationToken`. Never decode or synthesize the token.

3. `POST /v1/reservations:confirm`
   - Headers again require a matching `Idempotency-Key`; use a distinct stable key for this logical confirmation.
   - Body: C04 `2.0.0` command envelope with `commandType: "CONFIRM_RESERVATION"` and `payload: { confirmationToken, acceptedTerms }`. Each accepted term supplies the returned `policyVersionId` and `termsDigest`, `acceptedAt`, `acceptedBy`, and `acceptanceChannel: "WEB"`.
   - Enter the confirmed UI/Dining Pass only when the response is `ok: true` and `result.status === "CONFIRMED"`. Use the returned `result.reservationId`; never fabricate a reference. Identical retries replay the logical result; changed bodies under the same key fail closed.

4. `GET /v1/reservations/{reservationId}`
   - Header: `Authorization` (and browser `Origin`).
   - Result: tenant-scoped authoritative Reservation with status, version, party/time ranges, resources, accepted terms, and timestamps. Unknown and cross-tenant IDs both return `404 NOT_FOUND`.

Lifecycle semantics

- Availability is advisory; authority is established only at commit.
- Preserve candidate identity/resource IDs unchanged through review and prepare.
- Prepare revalidates availability, binds current policy terms, and issues an expiring one-use token.
- Confirm requires exact policy acceptance and commits reservation, allocation, idempotency, audit/outbox effects atomically.
- Conflicts, stale snapshots, expired/forged/scoped/consumed tokens, and dependency failures never fabricate success. Confirmation is idempotent for the same key plus body; concurrency has one winner.

Failure behavior

- Error JSON is `{ code, message, retryable, correlationId }` using C02 semantics.
- Key mappings: validation/contract/terms/policy/token-invalid `422`; auth `401`; origin/tenant/token-scope `403`; not found `404`; allocation/state/stale/idempotency/token-expired-or-consumed `409`; dependency unavailable `503`; unexpected internal failure `500`.
- Treat `503 DEPENDENCY_UNAVAILABLE` with `retryable: true` as unavailable, preserve the user's review state, and offer an honest retry. Never show confirmation without a successful authoritative confirm response.

Accepted evidence

- Recovered Reservation Core suite: 45/45 PASS, including exact four-route passthrough, CORS, auth/tenant mismatch, idempotency-header binding, C02 mappings, malformed JSON, lifecycle, transaction, migration, and pool-safety coverage.
- Real PostgreSQL 17 warm pooled-loss regression: PASS. A successful authenticated request warmed the pool; shutdown emitted only sanitized code `57P01`; the HTTP process survived; the next authenticated request returned HTTP 503 `DEPENDENCY_UNAVAILABLE`, `retryable: true`; the process remained alive; no URL, credentials, or bearer token leaked; container/listener/log cleanup passed.
- Accepted implementation references: `reservation-core/src/http/app.mjs`, `reservation-core/src/http/server.mjs`, `reservation-core/src/http/pool-safety.mjs`, and frozen Contract 2.0.0 types in `contracts/releases/2.0.0/generated/tablekeeper.ts`.

Resume the pending cohesive experience integration and functional/visual validation from this accepted boundary. Preserve the existing no-synthetic-confirmation and fail-closed gates.
