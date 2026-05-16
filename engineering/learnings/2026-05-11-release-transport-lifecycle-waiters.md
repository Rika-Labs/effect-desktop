---
date: 2026-05-11
topic: Transport lifecycle waiters
issues: [681, 695]
---

# Transport lifecycle waiters

Two transport bugs had the same root cause: close was treated as local cleanup
rather than a state transition every caller can observe. The in-memory transport
could accept `send()` after its endpoint closed, and framed transport `recv()`
could stay blocked forever when close happened while an input iterator `next()`
was pending.

The fix makes close an explicit terminal signal in both implementations. The
in-memory endpoint records a closed bit and rejects stale sends through the
typed `TransportClosed` channel. The framed transport owns a close signal that
`recv()` races against iterator reads, so a pending receive returns `null` as
soon as close wins instead of depending on arbitrary iterator cancellation
behavior.

The durable rule is that adapter cleanup is not enough. A transport boundary
must wake every waiter and reject every stale side effect after close, because
callers interpret successful send and blocked receive as real lifecycle state.
