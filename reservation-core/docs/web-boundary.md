# Reservation Core local web boundary

The boundary binds to `http://127.0.0.1:4180` and permits browser requests only from `RESERVATION_CORE_FRONTEND_ORIGIN` (default `http://localhost:4173`). It delegates all operations unchanged to the accepted lifecycle application layer.

Required environment:

- `RESERVATION_CORE_DATABASE_URL`: `core_runtime` PostgreSQL connection URL.
- `RESERVATION_CORE_CONFIRMATION_SECRET`: base64 encoding of at least 32 random bytes.
- `RESERVATION_CORE_DEV_BEARER_TOKEN`: local browser authentication token.
- `RESERVATION_CORE_TENANT_ID`: trusted tenant bound to that token.
- `RESERVATION_CORE_ACTOR_ID`: trusted actor bound to that token.
- `RESERVATION_CORE_ACTOR_TYPE`: `GUEST`, `STAFF`, `MANAGER`, or `SYSTEM`; defaults to `GUEST`.
- `RESERVATION_CORE_FRONTEND_ORIGIN`: optional exact allowed origin.

Start from `reservation-core`:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run start:web
```

Browser requests send `Authorization: Bearer <local token>`. Commands additionally send `Idempotency-Key`, exactly matching the value inside the Contract 2.0.0 command envelope. Envelope `tenantId` and `actor` must match the server-side context bound to the bearer token.

Operations are exactly:

- `POST /v1/availability/search`
- `POST /v1/reservation-preparations`
- `POST /v1/reservations:confirm`
- `GET /v1/reservations/{id}`

Success bodies are returned directly from `ReservationService`. Failures use the frozen C02 error shape and fail closed. The server has no fixture or synthetic-success path.
