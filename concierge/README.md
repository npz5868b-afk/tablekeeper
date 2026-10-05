# Tablekeeper Concierge

The Concierge is Tablekeeper's server-side dining-intelligence service. It maintains validated conversational intent, retrieves evidence-bearing restaurant candidates, applies exact hard constraints, ranks preferences deterministically, and delegates reservation operations to Reservation Core without claiming transaction authority.

## Grounded fixture catalog

`src/knowledge/fixture-catalog.mjs` is the authoritative local development catalog. It contains 24 meaningfully differentiated synthetic restaurants. Every atomic fact has a stable claim ID, fixture source locator, capture timestamp, supporting excerpt, and explicit synthetic-data notice. The catalog represents restaurant knowledge only; it does not represent live availability or confirmed reservations.

The earlier three-profile compatibility corpus in `src/knowledge.mjs` remains available for legacy tests, but new local retrieval uses the authoritative 24-fixture catalog.

## Semantic language modes

Set `CONCIERGE_LANGUAGE_PROVIDER=deterministic` for the offline, deliberately limited local parser, `azure` for Azure OpenAI strict structured-output understanding, or `gonka` for the OpenAI-compatible GonkaRouter adapter. Cloud providers emit ordered semantic operations (`SET`, `REPLACE`, `REMOVE`, or `KEEP`) with exact user evidence, provenance, and confidence. A deterministic reducer—not the model—applies those operations to canonical `DiningIntent`; uncertain inferred reservation-critical slots do not become authoritative state.

Cloud language failure fails the turn safely and reports degraded language capability. It does not silently relabel deterministic parsing as cloud understanding. GonkaRouter is used as an OpenAI-compatible transport, but the accepted integration does not depend on provider-native `response_format` JSON-schema enforcement. The prompt carries the authoritative local schema; output remains untrusted until bounded normalization, strict `IntentUpdate` validation, and exact current-turn evidence checks all pass. Requested and response-reported model names remain separate in safe diagnostics. Separate reasoning fields and `<think>` wrappers are discarded rather than persisted. There are no automatic inference retries or probes. Retrieval still comes only from the selected retriever, exact filtering/ranking stays deterministic, and Reservation Core remains the only reservation authority.

To configure GonkaRouter, set `CONCIERGE_LANGUAGE_PROVIDER=gonka`, `GONKA_BASE_URL`, `GONKA_MODEL`, and `GONKA_API_KEY`. `deepseek-ai/DeepSeek-V4-Flash-0731` is the model used in the successful human-executed T6 semantic acceptance; availability and continued contract compliance are not assumed. That acceptance proved ordered party-size correction, dining-time normalization, separate time flexibility, and conversation-friendly priority over lively ambience. It did not prove a separate negative party-atmosphere operation, restaurant availability, or reservation behavior. `GONKA_TIMEOUT_MS` defaults to 30000 milliseconds and is clamped to 1000..120000; invalid or blank values use the default. Keep the populated key only in the operator's local secret environment; never commit it. The automated suite uses injected fake transports and does not contact GonkaRouter, Azure OpenAI, or another inference service.

## Run locally

The default composition requires no paid services or credentials. It uses deterministic language understanding, the local 24-fixture retriever, deterministic filtering and ranking, in-memory checkpoints, and the accepted Reservation Core HTTP adapter.

```powershell
npm.cmd start
```

The server listens on `http://127.0.0.1:4310` by default and exposes:

- `GET /healthz` — process health.
- `POST /v1/concierge/turn` — one conversation turn using `threadId`, idempotent `turnId`, and `message`.

Run the smoke probe from a second terminal while the server is running:

```powershell
npm.cmd run smoke
```

Run all checks with `npm.cmd run check`. On shells that invoke npm directly, the equivalent commands are `npm start`, `npm run smoke`, and `npm run check`.

Copy `.env.example` only as a starting point and keep populated environment files out of source control. For Azure OpenAI/Microsoft Foundry structured outputs, Azure AI Search, environment variables, index requirements, and production deployment guidance, see [DEPLOYMENT.md](./DEPLOYMENT.md).
