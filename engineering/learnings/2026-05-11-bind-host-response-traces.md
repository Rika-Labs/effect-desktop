---
date: 2026-05-11
topic: Host response trace binding
issues: [694]
---

# Host response trace binding

The host protocol exchange already rejected response id mismatches, but it
accepted explicit trace id mismatches. That left a request and response joined
by id while telemetry and audit rows pointed at a different trace.

The fix binds response trace identity after envelope decode. Explicit
`traceId` values must match the originating request. Missing trace ids still go
through the existing audited auto-mint path, and that path is marked separately
so compatibility repair does not look like a host-provided mismatch.

The lesson is that correlation fields are part of the boundary contract, not
decorative metadata. If a transport accepts the right id with the wrong trace,
debugging and audit tooling can reconstruct a story that never happened.
