# Kumo Dining authoritative local demo

This fixture establishes one PostgreSQL-backed Reservation Core venue. It does not create availability or reservation results in the frontend. Search, preparation, policy acceptance, confirmation, and readback continue through HTTP Contract 2.0.0 and the existing lifecycle service.

## Demo identities

- Tenant: `10000000-0000-4000-8000-000000000001`
- Venue (`fixture-kumo-dining`): `10000000-0000-4000-8000-000000000012`
- TABLE resource: `10000000-0000-4000-8000-000000000013`
- Resource group: `10000000-0000-4000-8000-000000000014`
- Published booking policy: `10000000-0000-4000-8000-000000000015`

These are deliberately assigned local-demo fixture identities, not recovered W1 production identities.

## Prerequisite

Install PostgreSQL 17 and ensure `psql` is on `PATH`. Docker Desktop is an alternative, but is not required. The migration bootstrap connection must be able to create roles and the `btree_gist` extension. Give the generated `core_runtime` role a local password outside source control before starting the runtime.

From PowerShell in `C:\Users\npz58\Documents\InvariantLabs`:

```powershell
$env:TK_BOOTSTRAP_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:5432/tablekeeper'
$contractDigest = (Get-FileHash .\contracts\releases\2.0.0\contract-registry.json -Algorithm SHA256).Hash.ToLower()
.\reservation-core\bin\reservation-core.cmd migrate --mode up --database-url-env TK_BOOTSTRAP_DATABASE_URL --migrations (Resolve-Path .\reservation-core\migrations) --expected-contract-graph-sha256 $contractDigest --output (Join-Path $PWD 'migration-result.json')
psql $env:TK_BOOTSTRAP_DATABASE_URL -c "ALTER ROLE core_runtime PASSWORD '<different-local-password>';"
$env:TK_DATABASE_URL = 'postgresql://core_runtime:<different-local-password>@127.0.0.1:5432/tablekeeper'
.\reservation-core\bin\reservation-core.cmd seed --database-url-env TK_DATABASE_URL --descriptor (Resolve-Path .\reservation-core\fixtures\local-demo\kumo-dining.seed-descriptor.json) --mode apply --output (Join-Path $PWD 'seed-result.json')
```

Start Reservation Core (choose local development secrets; do not commit them):

```powershell
$env:RESERVATION_CORE_DATABASE_URL = $env:TK_DATABASE_URL
$env:RESERVATION_CORE_CONFIRMATION_SECRET = '<base64-for-at-least-32-random-bytes>'
$env:RESERVATION_CORE_DEV_BEARER_TOKEN = '<local-bearer-token>'
$env:RESERVATION_CORE_TENANT_ID = '10000000-0000-4000-8000-000000000001'
$env:RESERVATION_CORE_ACTOR_ID = 'local-demo-guest'
$env:RESERVATION_CORE_ACTOR_TYPE = 'GUEST'
Set-Location .\reservation-core
npm run start:web
```

In a second PowerShell window, start the frontend:

```powershell
Set-Location C:\Users\npz58\Documents\InvariantLabs\frontend
$env:RESERVATION_CORE_BASE_URL = 'http://127.0.0.1:4180'
$env:RESERVATION_CORE_DEV_BEARER_TOKEN = '<same-local-bearer-token>'
$env:RESERVATION_CORE_TENANT_ID = '10000000-0000-4000-8000-000000000001'
$env:RESERVATION_CORE_ACTOR_ID = 'local-demo-guest'
$env:RESERVATION_CORE_ACTOR_TYPE = 'GUEST'
$env:RESERVATION_CORE_VENUE_IDS = '{"fixture-kumo-dining":"10000000-0000-4000-8000-000000000012"}'
npm run dev
```

Open Kumo Dining, choose **Check booking support**, search for a party of four or fewer, select the unchanged returned candidate, prepare, accept the returned policy terms, and confirm. The Dining Pass must use the `reservationId` returned by `POST /v1/reservations:confirm`; readback uses the existing `GET /v1/reservations/{reservationId}` boundary.
