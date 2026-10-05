# Submission hardening audit

Audit date: 2026-10-05 (Asia/Kuala_Lumpur)

## Publication safety

- The source workspace contained six credential-bearing local files under `operator/secrets/`: bootstrap and runtime database URLs, confirmation secret, guest and manager bearer tokens, and staff PIN. Values were not copied into this submission package and are not recorded here.
- Source runtime state under `operator/state/`, browser profiles, dependency trees, `.tmp`, logs, backup files, and disposable recovery-run evidence were omitted from the package.
- A value-redacted high-confidence pattern scan of the final package found no private keys, AWS-style keys, GitHub-style tokens, OpenAI-style keys, or JWTs.
- Eight credential-bearing PostgreSQL URL matches remain intentionally: two judge-only URLs in `compose.yaml`, five obvious placeholder examples in Reservation Core documentation, and one deliberately secret-shaped redaction test fixture. None is a retained database credential.
- `.env.example` and public deterministic fixtures remain included.

## Validation actually executed

Host: Windows x64, Node.js v24.14.1, npm 11.11.0. Packages declare Node.js 22; npm emitted engine warnings for dependency installation, but the listed test processes completed as stated.

| Check | Observed result |
|---|---:|
| Concierge `npm test` | 98 passed, 0 failed |
| Concierge `npm run check` | syntax check passed; 98 passed, 0 failed |
| Frontend `npm test` | 83 passed, 0 failed |
| Frontend `npm run check` | syntax checks passed; 83 passed, 0 failed |
| Reservation Core non-destructive suite | 62 passed, 0 failed |
| Windows operator static suite | 5 passed, 0 failed |
| Platform suite | 5 passed, 0 failed |
| Contract lint | PASS |
| Contract fixtures | 48 passed, 0 failed |
| Contract compatibility | PASS |
| Contract generation / generated-file check | Not executed successfully: pinned `python3.12` / `datamodel_code_generator` unavailable |
| PostgreSQL integration | Not rerun: no isolated PostgreSQL 17 test instance provisioned in this pass |
| Docker build/start/health | Not run: Docker command unavailable on this host |

No destructive concurrency proof was rerun. The preserved proof remains the only claim for PostgreSQL 17.11 integration, the 50-client race, 5/5 PostgreSQL integration, and 24/24 venue parity.

## Integrity and scope

SHA-256 comparison confirmed that `TABLEKEEPER.cmd`, `START-TABLEKEEPER.cmd`, `STOP-TABLEKEEPER.cmd`, `RESET-DEMO.cmd`, and `operator/Tablekeeper.Operator.ps1` are byte-for-byte identical to the supplied source workspace. Product implementation files were not intentionally edited. No command read a retained credential value or connected to, queried, reset, seeded, or mutated the retained demo database.

## Licensing

The package adds a standard MIT license for project-authored work. Direct locked npm dependencies inspected during this pass declare MIT; see `THIRD_PARTY_NOTICES.md`. Transitive dependency licenses remain applicable. Publication rights for the retained PNG assets could not be proven from the supplied filesystem and require human confirmation.

## Remaining human actions

- Run the Docker instructions on a host with Docker Compose v2 and verify build, startup, health, frontend load, Reservation Core reachability, deterministic Concierge health, and disposable-volume isolation.
- Run the complete contract generator/check under its pinned Node.js 22 and Python 3.12 toolchain.
- Export and sanitize the required BAND room and generic reusable mandates from BAND Desktop if required by the submission rules.
- Confirm publication rights/provenance for every retained image asset.
- Review the dependency audit status in the pinned Node.js 22 environment; the host install reported one moderate development-dependency advisory but the online audit endpoint was unavailable for confirmation.
