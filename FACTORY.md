# BAND engineering factory evidence

This document describes workflow evidence present in this workspace together with the human-verifiable BAND Coordinator room reference recorded in [`band-export/BAND-EVIDENCE.md`](band-export/BAND-EVIDENCE.md). It does not claim unattended or fully autonomous delivery.

## Observed factory shape

1. **Human stage dispatch.** Planning and handoff documents define staged work, acceptance boundaries, and human review points. The evidence does not establish that stages dispatched themselves.
2. **Architecture and decomposition.** `architecture/phase1/architecture-gate.md`, its handoff manifest, checksums, and root planning material decompose the system and freeze authority boundaries before later work.
3. **Specialist implementation.** Component-specific source, tests, and evidence exist under Contracts, Reservation Core, Concierge, Frontend, and Platform areas.
4. **Agent-to-agent handoff.** Handoff and checkpoint artifacts communicate scoped assumptions and acceptance state between specialist work stages. These artifacts support handoff; they do not by themselves prove continuous autonomous coordination.
5. **Independent Platform Evidence verification.** Platform verification scripts and retained evidence project results independently check declared artifacts and controlled-runtime properties.
6. **Evidence-gated completion.** Architecture gates, validation checkpoints, checksums, test results, and the final sign-off demonstrate completion decisions based on recorded evidence rather than implementation assertions alone.

Representative sources include `plan.md`, `experience-task-handoff.md`, `architecture/phase1/`, `platform/evidence/`, `final-integration-evidence.json`, `agentic-ai-completion.md`, and `final-submission-signoff.md`.

## BAND Coordinator room evidence

The installed BAND Desktop UI did not expose a room-export action, so no native BAND room export is claimed. The human-observed Coordinator room reference is:

- Room name: `Coordinator`
- Room ID: `d859dea8-1b27-42a6-91cb-c58f31068f04`

The recorded timeline demonstrates the bounded sequence:

```text
Human -> Architect -> specialist implementation -> agent-to-agent handoff
      -> independent evidence verification -> Coordinator closure -> Human
```

This evidence distinguishes human mission dispatch, architecture and diagnosis, specialist implementation, evidence-bearing agent-to-agent handoff, independent Platform Evidence verification, Coordinator closure, and return to the human owner. It does not establish that every project action was autonomous or that the Markdown record is a BAND-generated export.

See [`band-export/BAND-EVIDENCE.md`](band-export/BAND-EVIDENCE.md) for the human-observed timeline and its limitations.

## Reusable mandates

No reusable seat-mandate artifact was found in the supplied filesystem. Historical material must not be reconstructed from inference.

Any public reusable mandate must remain generic. It must not contain Tablekeeper-specific endpoints, request or response fields, error codes, venue names, credentials, challenge answers, or copied product-specific acceptance data. A reviewed generic mandate can be placed at `band-export/mandates/<generic-role>.md`.

The absence of a reusable mandate remains a human-action submission blocker only if the hackathon requires that separate artifact.

