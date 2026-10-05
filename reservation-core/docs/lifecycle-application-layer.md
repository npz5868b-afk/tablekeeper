# Reservation Core lifecycle application layer

Status: accepted Contract 2.0.0 domain/application authority. The separately documented HTTP boundary delegates to this layer and does not replace or duplicate its authority.

Public module: `src/lifecycle/index.mjs`.

- `ReservationService.searchAvailability(AvailabilitySearchRequest)` returns advisory C03 candidates obtained from PostgreSQL table groups and live allocations.
- `ReservationService.prepare(ReservationPreparationRequest)` rechecks the selected candidate, captures the required immutable policy, persists a non-allocating preparation, and returns an authenticated opaque confirmation token.
- `ReservationService.confirm(ReservationConfirmationRequest)` verifies token scope/expiry and accepted terms, then delegates a serializable PostgreSQL transaction which consumes the preparation and co-commits reservation, allocations, accepted terms, idempotency result, audit, outbox, and command-attempt records.
- `ReservationService.getReservation({tenantId,reservationId})` reads the persisted C05 reservation projection.

The caller supplies a PostgreSQL pool compatible with `pg.Pool`, a process-secret-backed `ConfirmationTokenCodec`, and trusted tenant/authentication context. Every repository transaction sets `reservation_core.tenant_id` transaction-locally before accessing forced-RLS tables. The confirmation secret must contain at least 32 random bytes and must not be exposed to browsers or logs.

The thin browser-callable HTTP adapter is documented in `docs/web-boundary.md`; this application layer remains the sole reservation authority.

Run all executable local regressions from the workspace root:

```powershell
node --test reservation-core/tests/lifecycle/*.test.mjs reservation-core/tests/replanning/*.test.mjs reservation-core/tests/migration/static.test.mjs
```

Run the PostgreSQL 17 migration/RLS proof on a host with Docker:

```powershell
powershell -File reservation-core/tests/migration/run-postgres17.ps1
```
