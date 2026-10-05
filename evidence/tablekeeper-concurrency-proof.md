# Tablekeeper Reservation Concurrency Proof

Status: **PASS**  
Observed at: 2026-10-04T17:05:58.482Z  
Revision: unavailable — this workspace is not a Git repository.

## Observed evidence

- Environment: Windows x64, Node.js v24.14.1, PostgreSQL 17.11.
- Database: disposable PostgreSQL cluster at loopback port 55433; migrated and seeded specifically for this proof.
- Production path exercised: HTTP C03 SEARCH → C04 PREPARE → C04 CONFIRM → `PostgresReservationRepository` → PostgreSQL.
- Scenario: 50 prepared clients concurrently confirmed the same party-eight candidate, resource, and overlapping 90-minute interval.
- Initial persisted state: 0 confirmed reservations and 0 active conflicting allocations.
- Race outcome: 1 HTTP 200 confirmation; 49 HTTP 409 conflicts.
- Conflict classification: 46 `CONFLICT_ALLOCATION`; 3 `CONFLICT_STATE`.
- HTTP 5xx/internal failures: 0.
- Race duration: 1252.8 ms.
- Post-race persisted state: 1 confirmed reservation and 1 active conflicting allocation.
- Exact retry of all 50 commands: 1 idempotent HTTP 200 replay and 49 HTTP 409 conflicts; 0 HTTP 5xx.
- Post-retry persisted state: still 1 confirmed reservation and 1 active conflicting allocation.
- Final overlap proof: 0 pairs of overlapping active allocations.

The final database query counted confirmed reservations and unreleased allocations for the exact tenant, venue, and overlapping time range. A separate self-join over active allocation ranges found zero overlap pairs.

## Inference

Because the persisted counts remained 1/1 after the race and exact retries, and the allocation-overlap query returned zero, at most one authoritative conflicting allocation survived. Retrying did not create an additional reservation.

## Secondary proof

- Reservation Core non-destructive suite: 62 passed, 0 failed.
- PostgreSQL integration suite on a second fresh disposable database: 5 passed, 0 failed.
- Canonical venue Guest/Staff parity: 24/24 passed.

The initial parity run revealed a stale integration-test assumption: it expected internal venue/resource UUIDs from a guest-safe reservation projection that deliberately no longer returns them. The proof was corrected to inspect allocations through a tenant-scoped authoritative database read. No production behavior was changed.

## Reproduce

Run only against a new disposable PostgreSQL 17 cluster/database:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\initdb.exe' -D '<isolated-data-dir>' -U postgres --auth=trust --encoding=UTF8 --no-locale
& 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' -D '<isolated-data-dir>' -l '<isolated-log>' -o '"-p 55433 -h 127.0.0.1"' start
$env:Path='C:\Program Files\PostgreSQL\17\bin;'+$env:Path
$env:TK_PROOF_BOOTSTRAP_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
$digest=(Get-FileHash '.\contracts\releases\2.0.0\contract-registry.json' -Algorithm SHA256).Hash.ToLower()
& '.\reservation-core\bin\reservation-core.cmd' migrate --mode up --database-url-env TK_PROOF_BOOTSTRAP_DATABASE_URL --migrations (Resolve-Path '.\reservation-core\migrations') --expected-contract-graph-sha256 $digest --output (Join-Path $PWD 'proof-migration-result.json')
$env:TK_PROOF_DATABASE_URL='postgresql://core_runtime@127.0.0.1:55433/postgres'
& '.\reservation-core\bin\reservation-core.cmd' seed --database-url-env TK_PROOF_DATABASE_URL --descriptor (Resolve-Path '.\reservation-core\fixtures\local-demo\tablekeeper-platform.seed-descriptor.json') --mode apply --output (Join-Path $PWD 'proof-seed-result.json')
$env:TK_PROOF_ALLOW_DISPOSABLE='YES'
node .\reservation-core\tests\integration\concurrency-50-proof.mjs .\evidence\tablekeeper-concurrency-proof.json
npm.cmd test --prefix reservation-core
```

For the 24-venue PostgreSQL parity run, create a second fresh database in that isolated cluster, migrate and seed it identically, then run:

```powershell
$env:TK_INTEGRATION_DATABASE_URL='postgresql://core_runtime@127.0.0.1:55433/<fresh-parity-database>'
npm.cmd run test:postgres --prefix reservation-core
```

The retained Tablekeeper demo database was not addressed, reset, seeded, queried, or mutated during this proof.
