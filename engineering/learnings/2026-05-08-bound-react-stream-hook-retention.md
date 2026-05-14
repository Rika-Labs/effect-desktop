# Bound React Stream Hook Retention

## Planned

Issue #841 required `useDesktopStream` to stop silently retaining every emitted stream item forever. The goal was to preserve a bounded stream contract at the React boundary without changing bridge/runtime backpressure.

## Shipped

`useDesktopStream` now accepts either the old dependency-list argument or an options object with `deps`, `capacity`, and `onItem`. The hook retains at most 1024 items by default, supports `capacity: 0` for callback-only consumption, validates capacity as a non-negative safe integer, and documents the policy in the React README. Tests cover bounded retention, disabled data retention, and invalid capacity rejection.

PR: https://github.com/Rika-Labs/effect-desktop/pull/844

## Review

Code review found no issues. CI passed on Ubuntu, macOS, and Windows before the learning commit.

## Lesson

Renderer convenience hooks are still resource boundaries. If a stream is bounded below the hook, the hook must not convert it back into unbounded state by default.

## AGENTS.md Amendment Candidate

None.
