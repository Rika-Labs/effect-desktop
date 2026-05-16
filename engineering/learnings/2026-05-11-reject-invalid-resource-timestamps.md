---
date: 2026-05-11
topic: Resource registry creation timestamps
issues: [644]
---

# Resource registry creation timestamps

`ResourceRegistry.register` owned resource IDs, generations, cleanup groups, and live snapshots, but
it accepted whatever the injected clock returned as `createdAt`. A non-finite timestamp could become
shared lifecycle state before any consumer had a chance to classify the failure.

The fix validates `now()` before registration mutates the live map or cleanup-group state. Invalid
clock output now fails at the registry boundary as `ResourceInvalidArgumentError`; service APIs that
use the registry keep their existing public error contracts.

The durable rule: lifecycle metadata is part of the registry invariant. If a field is used for
ordering, leak detection, or cleanup, validate it before publishing it as shared state.
