# Issue 841 Review: Bound React Stream Hook Retention

## Locked Decision

Use a retained-item capacity policy in `useDesktopStream`, defaulting to 1024, with `capacity: 0` for callback-only consumption.

## Pressure Test

- Correctness: each emitted item can add at most one bounded state item.
- Compatibility: the old dependency-list argument remains valid.
- Operability: README documents the retention policy and callback-only mode.
- Scope: no bridge/runtime stream semantics change.
- Testability: the pure retention helper proves the hook state transition without adding a DOM harness.

## Tradeoff

The default no longer means "retain everything forever." That is a behavior change, but it is the production-safe default for long-lived framework streams.

Handoff: `/work`
