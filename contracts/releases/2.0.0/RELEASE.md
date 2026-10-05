# Tablekeeper Contract 2.0.0

This deliberately breaking successor to frozen 1.0.0 adds required endpoint-specific request bodies for availability search, reservation preparation, and explicit confirmation. It also requires `confirmationToken` on the preparation response because confirmation depends on the server-issued opaque token.

Architecture approved the exact C03/C04 semantics and trusted-context rule in Jam message `b995c239-4365-4ebb-bbcf-5e38c06a1c7d`.

## Security boundary

- Request envelopes retain C01 identity, correlation, and query/command identity fields.
- Authentication, authorization, tenant scope, and provenance come exclusively from trusted transport context.
- A body `tenantId` or `actor` mismatch is rejected and never silently rewritten.
- When `Idempotency-Key` appears in both header and body, mismatch is rejected.
- Search results and selected candidate/resource IDs remain advisory.
- Prepare re-resolves resources and server-owned policy/terms facts and allocates nothing.
- Confirm validates all bindings and performs reservation, allocation, token consumption, audit/outbox, and idempotency recording atomically.

## Compatibility and evidence

Adding required bodies narrows requests accepted by 1.0.0, so Tablekeeper SemVer classifies this as breaking. `compat/1.0.0-to-2.0.0.breaking.json` contains the pinned oasdiff structural result and policy classification. Artifact digests are in `SHA256SUMS`; the schema digest is in `generated/SOURCE_SHA256`.
