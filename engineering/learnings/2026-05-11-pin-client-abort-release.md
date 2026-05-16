---
date: 2026-05-11
topic: Bridge client abort release
issues: [691]
---

# Bridge client abort release

The issue described a stale failure mode where a renderer abort sent a cancel
envelope but the caller still waited for `exchange.request` to return. Current
main already separates the two responsibilities: `runRequestWithCancellation`
sends the protocol cancel and races the request against a local typed
`Cancelled` failure.

The missing piece was evidence. A focused regression now backs the request with
`Effect.never`, aborts the signal, and proves the caller receives a typed
renderer cancellation before a short timeout while exactly one cancel envelope
is recorded.

The lesson is that cancellation has two contracts. The host cancel envelope is
best-effort cleanup; the local caller release is mandatory progress. Tests need
to pin both, because observing the cancel envelope alone does not prove the UI
fiber was released.
