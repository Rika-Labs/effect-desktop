# ApprovalBroker Core Service

## Planned

Issue #43 required runtime approvals to be mediated by a trusted broker rather
than renderer-owned UI. The broker needed identical request coalescing,
per-actor prompt-fatigue control, denied-for-scope caching, an explicit dev
approve-all path, typed failures, and audit output.

## Shipped

`@orika/core` now exports `ApprovalBroker`, `makeApprovalBroker`,
`ApprovalRequest`, `ApprovalOutcome`, and typed broker errors. `ask(request)`
validates inputs through Effect Schema, emits `approval requested`, coalesces
identical `(operation, actor, resource)` requests, queues distinct requests per
actor up to depth 8, returns `QueueOverflow` as a typed Effect failure, and fans
one host outcome out to all coalesced waiters atomically.

The concrete prompt is behind `ApprovalPromptPort`. That keeps the host-rendered
UI boundary explicit without pretending an `Approval.prompt` host protocol
method exists today. `devApproveAll` bypasses the prompt port, returns an
`approved-once` outcome, and still emits the approval audit path.

## Review

Focused testing exposed a real race in the coalescing implementation: waiters
that arrived while the prompt was visible were stored in broker state, while the
prompt loop still held the original entry. Completion now reloads the current
active entry before fanout, so all waiters attached during the prompt receive
the same atomic outcome.

The review also rejected a detached prompt-loop variant. In this Effect runtime
shape, forking the prompt loop inside `ask` left coalesced callers stuck. The
final implementation keeps prompt ownership explicit in the active caller's
Effect, which is easier to reason about and covered by the concurrency tests.

## Lesson

Coalescing is not only a lookup optimization; it changes the ownership of
waiters over time. Any prompt completion path must read the current waiter set
from the broker state immediately before fanout, not from the entry captured
when the prompt started.

## Candidate Rule

For broker-style coalescing, test at least one waiter that attaches after the
first caller has already entered the external effect. Captured state is not
enough evidence for atomic fanout.
