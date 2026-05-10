---
date: 2026-05-10
type: in-flight-bug
topic: Protocol asset root validation
issue: https://github.com/Rika-Labs/effect-desktop/issues/810
pr: https://github.com/Rika-Labs/effect-desktop/pull/1137
---

# Protocol asset root validation

## What we set out to do

`Protocol.serveAsset` had to stop accepting non-filesystem roots because those values cross the bridge as opaque strings and become host-dependent behavior.
This PR adds validation in `packages/native/src/protocol.ts` so only absolute local paths without traversal or control characters and without URL shape are sent to the host.

## What actually ended up working

The client now rejects empty strings, relative paths, traversal segments, URL-like roots (for example `file:///tmp/assets`), and control characters in `root` before bridge transport.
A focused test in `packages/native/src/protocol.test.ts` confirms valid `/app/assets` passes and invalid roots fail with `InvalidArgument` while emitting no host request.

Additional work in this PR (stream cancellation/idempotent proxy disposal) was part of a previous cluster and was stabilized with a follow-up fix for disposed-resource idempotence.

## What surfaced in review

`packages/bridge/src/resources.ts` was flagged for setting `disposed` eagerly inside `dispose` factory logic. That made retries impossible if the effect had not actually executed.
The fix deferred the flag update until `exchange.dispose(handle)` succeeds by chaining it with `Effect.tap`.

## First-principles postmortem

Asset roots are an authority boundary. The invariant is: invalid roots must never reach native adapters.
By validating at the Protocol service boundary and testing transport behavior on rejection, the host-facing contract stays explicit and enforceable.

## Game-theory postmortem

The incentive to keep a cheap change was to avoid touching bridge internals, but that creates deferred-cost failure modes in later retries.
The review finding showed why completion should track execution success: callers can build effects without running them, so local success assumptions can be false.

## Non-obvious lesson

In Effect, side-effecting booleans used for idempotence must be updated by the effect pipeline, not during effect construction; otherwise retry semantics and cancellation can silently suppress required operations.

## Reproducible pattern (if any)

Validate authority-bearing inputs at the highest abstraction boundary before serialization.
Keep "once-only" flags in terms of execution completion (`tap`/`finalizer`) rather than function creation.

## AGENTS.md amendment candidate (if any)

None
