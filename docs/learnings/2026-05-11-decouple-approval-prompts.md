# Decouple Approval Prompts

## Planned

Close #672 by ensuring the first approval caller does not own shared prompt progress for coalesced waiters.

## Shipped

The broker now starts active prompt processing in a broker-owned fiber and leaves callers waiting on their deferreds. Interrupting the starter fiber no longer interrupts the prompt loop, so later coalesced waiters receive the shared outcome when the host prompt resolves.

## Review

The regression interrupts the first `ask` fiber while the prompt is pending, submits a coalesced second request, releases the prompt, and verifies the second waiter receives an approval instead of timing out.

## Lesson

Coalescing creates shared work. Shared work needs an owner that is not one of the waiters, or one caller's cancellation becomes a liveness bug for everyone else.
