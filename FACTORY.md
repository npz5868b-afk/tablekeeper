# Tablekeeper Dark Factory

Implementation does not certify itself. Green tests do not automatically mean acceptance. Independent evidence gates control progression.

## 1. Factory in 30 Seconds

```text
Human mission and stage dispatch
-> Coordinator
-> Systems Architect
-> specialist implementation
-> evidence-bearing handoff
-> independent Platform Evidence and verification
-> ACCEPT / HOLD / FAIL
-> correction and rerun where required
-> Coordinator closure
```

Implementation authority belongs to the specialist responsible for a bounded component. Verification authority is separate and checks the handoff against frozen interfaces and executable evidence. Acceptance authority belongs to the Coordinator at the recorded gates. Human dispatch and review remain part of this process; this repository does not claim unattended delivery.

For a two-minute path through the proof, see the [Factory Evidence Index](FACTORY-EVIDENCE-INDEX.md). The human-observed BAND room record is [BAND-EVIDENCE.md](band-export/BAND-EVIDENCE.md).

## 2. Why This Is a Factory

- **Bounded ownership:** architecture, contracts, Reservation Core, Platform Evidence, Concierge intelligence, RAG, and Experience have distinct scopes and owned paths.
- **Frozen interfaces:** C01-C12, authority boundaries, digests, and the C0.5 integration interface constrain downstream work.
- **Evidence-bearing handoffs:** specialists report scoped outputs, tests, unresolved checks, and immutable artifact references.
- **Separate certification:** an implementer's `done` or green suite is not sufficient for gate release.
- **Explicit dispositions:** retained records use `PASS`, `FAIL`, `HOLD`, `BLOCKED`, and `ACCEPTED` rather than inferred completion.
- **Fail-closed progression:** unresolved integration evidence stops activation or release.
- **Independent verification:** Platform Evidence and independent host verification check controlled-runtime behavior, hashes, isolation, and retained artifacts.
- **Coordinator acceptance:** progression is recorded only after the required evidence exists.

The normative architecture is [architecture/phase1/architecture-gate.md](architecture/phase1/architecture-gate.md). Its handoff boundary is [architecture/phase1/handoff-manifest.json](architecture/phase1/handoff-manifest.json).

## 3. Case File 01 - C0 Failed Before It Passed

**Verdict: GOLD factory evidence. Review materially changed the work.**

The Systems Architect froze the C01-C12 architecture while the W0 contract package remained a candidate. The handoff manifest explicitly recorded `C0 remains FAIL until Contract Steward remediation and rerun`; specialist activation was not authorized by an architecture document alone.

The retained audit identifies twelve concrete harness and evidence defects:

1. cleanup could mask the primary failure;
2. a PowerShell automatic-argument collision dropped Docker arguments;
3. Windows PowerShell 5.1 promoted informational native stderr to `NativeCommandError`;
4. native exit status could be overwritten or never observed;
5. stdout and stderr were not reliably retained;
6. attempts reused a shared raw directory;
7. fixed local image tags could collide across reruns;
8. prior evidence contaminated the Docker build context;
9. post-proof verification failure lacked a separate failure record;
10. generated artifacts lacked required source-digest banners;
11. network evidence did not cover internal PostgreSQL isolation; and
12. the host verifier did not independently verify Docker network arguments.

Those were not cosmetic comments. The recovery harness and evidence process were corrected. Four failed execution attempts remained listed in the retained verification record. The successful execution was then independently checked for deterministic Node and Python generation, cross-runtime parity, PostgreSQL behavior, network controls, hashes, and read-only retention.

Only afterward did the Coordinator record `ACCEPTED`, with:

- 56/56 execution artifacts verified;
- 168/168 W0 package hashes verified;
- nine PostgreSQL assertions verified;
- network isolation verified;
- read-only retention verified; and
- four preserved failure attempts verified.

Direct evidence:

- Initial `FAIL` boundary and next authority: [architecture/phase1/handoff-manifest.json](architecture/phase1/handoff-manifest.json)
- Twelve corrected defects: [contracts/w0/recovery/harness-audit.json](contracts/w0/recovery/harness-audit.json)
- Independent rerun and four retained attempts: [contracts/w0/recovery/post-recovery-verification.json](contracts/w0/recovery/post-recovery-verification.json)
- Contract Steward final rerun: [contracts/w0/c0-checklist.md](contracts/w0/c0-checklist.md)
- Coordinator acceptance: [architecture/phase1/c0-coordinator-acceptance.json](architecture/phase1/c0-coordinator-acceptance.json)

The public repository retains the audit, verification summary, checklist, and gate disposition. It does not claim that the complete raw C0 recovery run tree is publicly retained.

## 4. Case File 02 - Green Checks Were Not Enough

**Verdict: STRONG gate evidence. Static success did not release C1A.**

The initial C1A checkpoint recorded six static migration tests passing, Node syntax passing, JSON parsing passing, and the PowerShell harness parsing successfully. PostgreSQL 17 integration was still `BLOCKED` because Docker and `psql` were unavailable on that host. The gate recommendation was therefore:

```text
HOLD_PENDING_POSTGRESQL17_INTEGRATION_PASS
```

The later gate disposition records actual PostgreSQL 17 host verification: migration up, privilege checks, RLS checks, down migration, and manifest-to-SQL digest verification all passed. Only then did C1A receive `PASS` and its blocker become resolved.

The PostgreSQL harness result is explicitly recorded as **operator-reported host execution**. It is strong gate evidence, not cryptographic provenance of the host session.

Direct evidence:

- Initial PASS/BLOCKED/HOLD checkpoint: [reservation-core/tests/migration/c1a-validation-checkpoint.json](reservation-core/tests/migration/c1a-validation-checkpoint.json)
- Resolved blocker and C1A PASS: [architecture/phase1/c1a-gate-disposition.json](architecture/phase1/c1a-gate-disposition.json)

**Factory lesson:** a green local or static result was insufficient to release the gate.

## 5. Case File 03 - Implementation Could Not Self-Certify

**Verdict: STRONG separation-of-authority evidence, with limited artifact-level room linkage.**

The human-observed Coordinator room record states that the ReservationCore Engineer handed off final resilience hardening with 45/45 implementation tests passing. The same handoff explicitly said that Platform Evidence still needed to rerun the real PostgreSQL warm pooled-loss scenario.

Completion therefore remained pending. The observed Platform Evidence work included the PostgreSQL-loss HTTP checkpoint, corrected PostgreSQL harness reverification, database-backed acceptance, and evidence capture. At 04:19 pm, the Coordinator still described closure as pending the independent evidence result. At 04:21 pm, the Coordinator recorded independently verified completion and closed the evidence gate.

Direct evidence:

- Human-observed implementation handoff and closure sequence: [band-export/BAND-EVIDENCE.md](band-export/BAND-EVIDENCE.md)
- Retained Reservation Core HTTP and pool-safety tests: [reservation-core/tests/http/pool-safety.test.mjs](reservation-core/tests/http/pool-safety.test.mjs)
- Current bounded final-integration record: [final-integration-evidence.json](final-integration-evidence.json)

The BAND record is not a native export, and the 45/45 room entry is not bound to a commit or artifact digest. The defensible claim is separation between implementation and certification, not complete cryptographic room-to-code traceability.

## 6. Engineering Falsification

**Classification: ENGINEERING FALSIFICATION / RECOVERY - not a BAND verifier rejection.**

The initial Guest/Staff parity proof assumed that a guest-safe reservation projection exposed internal venue and resource UUIDs. That assumption was invalid. The proof method changed to inspect allocations through a tenant-scoped authoritative database read; no product behavior changed.

The corrected proof then recorded:

- canonical Guest/Staff venue parity: 24/24;
- 50 concurrent confirmations against one conflicting allocation;
- one authoritative HTTP 200 winner;
- 49 authoritative conflicts: 46 `CONFLICT_ALLOCATION` and three `CONFLICT_STATE`;
- zero HTTP 5xx responses;
- one confirmed reservation and one active conflicting allocation;
- zero overlapping active allocation pairs;
- exact retries still at one reservation and one allocation; and
- race duration of 1252.8 ms.

Direct evidence: [evidence/tablekeeper-concurrency-proof.md](evidence/tablekeeper-concurrency-proof.md) and [evidence/tablekeeper-concurrency-proof.json](evidence/tablekeeper-concurrency-proof.json).

## 7. Seat Responsibility Matrix

| Seat | Authority / responsibility | Owned scope | Typical handoff | Verification | Gate acceptance / release |
|---|---|---|---|---|---|
| Human owner | Mission and stage dispatch; final review | Mission and submission direction | Bounded mission to Coordinator or specialist | Reviews returned evidence | Human submission decision |
| Coordinator | Work allocation, activation, integration disposition, closure | Cross-seat coordination and gate records | Authorized package and frozen inputs | Requires specialist and independent evidence | Records Coordinator acceptance or closure |
| Systems Architect | Architecture and invariant authority | C01-C12, authority boundaries, ownership | Frozen architecture and handoff manifest | Contract and integration conformance | Architecture baseline approval; Coordinator releases work |
| Contract Steward | Contract schemas, fixtures, generation, conformance | W0 and versioned contract packages | Hash-addressed contract release and C0 result | Recovery verifier and Coordinator checks | Coordinator accepts C0 |
| ReservationCore Engineer | Authoritative reservation implementation | Reservation Core service, migrations, lifecycle, PostgreSQL boundary | Implementation, tests, unresolved verification needs | Platform Evidence and gate checks | Coordinator/gate disposition |
| Platform Evidence Engineer | Independent controlled-runtime verification | Readiness, isolation, failure injection, evidence projection | Machine-readable evidence and findings | Independent verifier mechanisms and Coordinator review | Coordinator closes evidence gate |
| AI Local Intel Engineer | Concierge orchestration and provider boundary | Contracts, providers, graph, persistence, service, Core tools | Integrated Concierge behavior and tests | Platform Evidence / final integration verification | Coordinator closure |
| RAG Engineer | Grounded retrieval and deterministic decisioning | Knowledge, retrieval, decision, fixtures | Scoped files plus executable evidence | Full Concierge and integration checks | Coordinator receives handoff |
| Experience Engineer | Guest/staff experience and boundary consumption | Frontend and accepted HTTP integration | Working journeys, checks, screenshots, blockers | Frontend checks and proportional review | Coordinator/human review |

These are evidenced project responsibilities, not generic reusable mandates. No historical reusable seat-mandate artifact is claimed.

## 8. Evidence-Gated Completion

The repository demonstrates a consistent rule: an implementer's declaration of completion is not sufficient evidence.

| Event | Implementation/local state | Gate state | What released the gate |
|---|---|---|---|
| C0 | Candidate contract work existed | `FAIL` | Remediation, independent rerun, hash/PostgreSQL/isolation verification, Coordinator `ACCEPTED` |
| C1A | Static and syntax checks passed | `HOLD`; PostgreSQL integration `BLOCKED` | Actual PostgreSQL 17 integration verification and gate `PASS` |
| Reservation Core resilience | 45/45 implementation tests reported green | Final completion pending | Separate Platform Evidence result followed by Coordinator closure |

## 9. Traceability

The strongest honest trace is:

```text
BAND Coordinator Room d859dea8-1b27-42a6-91cb-c58f31068f04
-> observed human mission dispatch
-> architecture gate
-> ownership and handoff artifacts
-> specialist implementation evidence
-> Platform Evidence
-> machine-readable gate and proof artifacts
-> Coordinator closure
-> human completion report
```

The room record is human-observed, not a native BAND export. Its entries do not carry comprehensive message-ID, commit, and digest linkage. The publication Git history is single-author and largely begins with a consolidated import, so it does not prove specialist authorship or commit-per-handoff execution.

## 10. Measured Evidence

| Measurement | Retained evidence |
|---|---|
| Concurrency race | 1252.8 ms for 50 concurrent confirmations |
| Platform negative-capability suites | Approximately 126-140 ms in retained C2A validation reports |
| Database acceptance window | 2026-09-30 19:29-19:45, human-observed BAND task window |
| Corrected harness reverification | 2026-09-30 19:48-19:56, human-observed BAND task window |
| PostgreSQL-unavailable checkpoint | 2026-09-30 20:21-20:25, human-observed BAND task window |
| Automated final verification | Zero external inference calls in [final-integration-evidence.json](final-integration-evidence.json) |

Zero external inference calls during automated final verification does **not** mean zero Factory or model cost. Token counts, per-seat cost, and total Factory cost are not available and are not claimed.

## 11. Evidence Boundary

| Category | What this repository supports |
|---|---|
| **PROVED BY RETAINED ARTIFACT** | C0 FAIL-to-ACCEPTED chain; twelve harness findings; four listed failed attempts; independent verification summary; C1A HOLD-to-PASS records; deterministic gate/hash evidence; concurrency and parity proof |
| **HUMAN-OBSERVED BAND RECORD** | Coordinator Room ID and timeline; mission dispatch; specialist handoffs; pending independent verification; Coordinator closure |
| **NOT AVAILABLE / NOT CLAIMED** | Native BAND export; complete room transcript; historical reusable mandates; full autonomy or zero human steering; specialist Git authorship; complete historical Git provenance; token/model cost; complete public C0 raw run tree |
