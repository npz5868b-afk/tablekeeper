# Tablekeeper

Demo Video: https://youtu.be/baLmkZOIcbU

**AI recommends. Reservation Core decides.**

Tablekeeper is an AI-powered dining platform for conversational restaurant discovery, authoritative reservations, and venue-scoped staff operations. Guests explore a canonical 24-venue catalog through the AI Concierge, then use the real reservation boundary to check availability, prepare, confirm, read, or cancel a booking. Confirmed experiences can include a Dining Pass and authoritative Dining Placement. Staff use a PIN-gated, venue-scoped Operations experience.

## Built with BAND

Tablekeeper was produced through a BAND-based agentic software factory with distinct architecture, implementation, coordination, and independent verification responsibilities. Specialist agents hand work off with evidence, and implementation is separated from certification. Human stage dispatch and review remain part of the observed process; this repository does not claim full autonomy.

See [FACTORY.md](FACTORY.md) for the verified factory evidence, limitations, and BAND evidence status.

### BAND Agentic Factory

The documented flow is Human -> Architect -> specialist implementation -> agent-to-agent handoff -> independent evidence verification -> Coordinator closure -> Human. Read [FACTORY.md](FACTORY.md) for the bounded factory account and [BAND-EVIDENCE.md](band-export/BAND-EVIDENCE.md) for the human-verifiable Coordinator room reference. The latter is not a native BAND room export.

## System boundary

```text
Browser -> Frontend proxy -> Concierge (deterministic/local)
                          -> Reservation Core HTTP -> PostgreSQL 17
```

The Concierge interprets conversation and ranks grounded catalog candidates. In the reproducible path it uses deterministic language understanding and local retrieval, so it requires no external AI credentials or outbound inference calls.

Concierge output is advisory. Reservation Core is the sole authority for availability, preparation, confirmation, cancellation, reservation identity, and accepted terms. Reservation Core persists through PostgreSQL 17, using transactions, row-level security, idempotency records, and exclusion-backed allocations as the authoritative concurrency boundary.

## Docker judge path

Requirements: Docker Engine with Docker Compose v2 and host port `4173` available.

```sh
docker compose up --build --wait
```

Guest:

<http://localhost:4173>

Staff:

<http://localhost:4173/staff-access>

Judge-only disposable-stack PIN:

```text
2468
```

The Compose project creates a dedicated `tablekeeper_judge` database in a Docker volume. Its fixed credentials and tokens are intentionally non-secret and valid only inside this disposable local stack. It does not read the Windows operator configuration and cannot address the retained `tablekeeper` demo database. Concierge is forced to deterministic and local providers.

The Docker path has been statically prepared but runtime Docker validation has NOT yet been executed because Docker was unavailable on the preparation host.

Stop the stack while retaining its disposable database:

```sh
docker compose down
```

Destroy the disposable judge database and return to a clean run:

```sh
docker compose down --volumes
```

**Destructive warning:** `docker compose down --volumes` permanently deletes the disposable judge database. It does not target the retained Windows demo database.

## Windows local operator

The retained-demo path is Windows-only. PostgreSQL 17 is currently discovered at `C:\Program Files\PostgreSQL\17\bin`.

Double-click `TABLEKEEPER.cmd`, or use:

- `START-TABLEKEEPER.cmd`
- `STOP-TABLEKEEPER.cmd`
- `RESET-DEMO.cmd`

The implementation is `operator/Tablekeeper.Operator.ps1`; see `operator/README.md`.

Normal Start does not migrate, seed, or delete data. **Reset Demo is destructive.** It requires an explicit `RESET` confirmation and rebuilds the configured retained database. Local URLs, tokens, PINs, launcher state, PIDs, and logs belong under ignored `operator/secrets/` and `operator/state/` paths.

## Tests

Use Node.js 22 and install each package's locked dependencies before running its suite.

```sh
npm test --prefix concierge
npm test --prefix frontend
npm test --prefix reservation-core
npm run contracts:all --prefix contracts/releases/2.0.0
node --test operator/operator-static.test.mjs
node --test platform/tests/platform.test.mjs
```

The PostgreSQL integration suite requires a newly created, migrated, and seeded disposable PostgreSQL 17 database in `TK_INTEGRATION_DATABASE_URL`:

```sh
npm run test:postgres --prefix reservation-core
```

Never point integration or concurrency proof commands at the retained demo database.

## Engineering Proof

The preserved observed evidence is recorded in `evidence/tablekeeper-concurrency-proof.md` and `evidence/tablekeeper-concurrency-proof.json`:

- isolated PostgreSQL 17.11
- authoritative HTTP -> Reservation Core -> PostgreSQL path
- 50 concurrent confirmations
- 1 HTTP 200 authoritative winner
- 49 authoritative conflicts
- 46 `CONFLICT_ALLOCATION`
- 3 `CONFLICT_STATE`
- 0 HTTP 5xx
- 1 confirmed reservation
- 1 active conflicting allocation
- 0 overlapping active allocation pairs
- retries remained at 1 reservation / 1 allocation
- 1252.8 ms
- Reservation Core 62/62
- PostgreSQL integration 5/5
- canonical Guest/Staff venue parity 24/24
- retained demo database untouched

## Repository map

- `frontend/` - guest and staff web experience plus server-side proxies
- `concierge/` - conversational orchestration, deterministic/local providers, and reservation tools
- `reservation-core/` - authoritative HTTP service, lifecycle logic, migrations, seed, and tests
- `contracts/` - accepted API contracts and validation tooling
- `platform/` - platform verification and controlled-runtime evidence
- `operator/` and root `.cmd` files - retained Windows local operator
- `container/`, `Dockerfile`, and `compose.yaml` - clean disposable judge path
- `evidence/` - preserved Engineering Proof
- `architecture/` - accepted architecture-gate evidence
- `FACTORY.md` - verified BAND engineering-factory account and export status

## Security

Do not commit `.env` files, `operator/secrets/`, `operator/state/`, database data, browser profiles, logs, PIDs, or private/generated evidence. Keep `.env.example` files and public reproduction fixtures tracked. Run a secret scanner before publication and review every finding; pattern matches in source, contracts, tests, and documentation are not automatically credentials.

The Docker judge credentials are deliberately public, local, and scoped to the disposable Compose stack. They must not be reused elsewhere.

## Licensing

Project-authored code is offered under the root MIT license. Third-party packages, tools, container images, and assets retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A human submitter must confirm publication rights for all retained image assets before making the repository public.

For the verified BAND workflow and remaining human export instructions, see [FACTORY.md](FACTORY.md).
