# Multi-venue authoritative local demo

The versioned local-demo bundle maps the 24 stable Concierge fixture IDs to 24 Reservation Core venues. It adds venue-local service hours, varied table inventories, and one booking policy per venue. Kumo keeps its existing venue, resource, group, and policy UUIDs; its two resource labels advance additively to `Table 01` and `Table 02`. The seed never deletes reservations or allocations.

## Apply safely from Windows PowerShell

Run from the repository root against the existing database; do not reset it.

```powershell
$env:TK_BOOTSTRAP_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:5432/tablekeeper'
$contractDigest = (Get-FileHash .\contracts\releases\2.0.0\contract-registry.json -Algorithm SHA256).Hash.ToLower()
.\reservation-core\bin\reservation-core.cmd migrate --mode up --database-url-env TK_BOOTSTRAP_DATABASE_URL --migrations (Resolve-Path .\reservation-core\migrations) --expected-contract-graph-sha256 $contractDigest --output (Join-Path $PWD 'migration-result.json')

$env:TK_DATABASE_URL = 'postgresql://core_runtime:<runtime-password>@127.0.0.1:5432/tablekeeper'
.\reservation-core\bin\reservation-core.cmd seed --database-url-env TK_DATABASE_URL --descriptor (Resolve-Path .\reservation-core\fixtures\local-demo\tablekeeper-platform.seed-descriptor.json) --mode apply --output (Join-Path $PWD 'seed-result.json')
```

Both commands are repeatable. Migration digests and persisted-state verification fail closed on conflicts. The seed uses one serializable transaction and contains no truncate, delete, or reset operation.

For a disposable migrated-and-seeded integration database, run the real PostgreSQL lifecycle proof:

```powershell
$env:TK_INTEGRATION_DATABASE_URL = 'postgresql://core_runtime:<runtime-password>@127.0.0.1:5432/tablekeeper_integration'
Set-Location .\reservation-core
npm.cmd run test:postgres
Set-Location ..
```

This test intentionally creates confirmed reservations at Lotus Yard and Aegean Blue. Do not point it at the Operator's retained demo database.

## Read-only verification

```powershell
psql $env:TK_DATABASE_URL -X -f .\reservation-core\docs\verify-local-demo.sql
```

Expected invariants: `authoritative_venue_count = 24`; every venue has at least one active resource, one booking policy, and active service-hour rows. Record the Kumo reservation count before and after applying the seed; it must be unchanged.

The frontend loads its catalog-to-venue map from `platform/restaurant-authority.json`; an absent mapping disables live booking for that catalog identity. Venue UUIDs and table resource UUIDs are not rendered in the guest booking journey.
