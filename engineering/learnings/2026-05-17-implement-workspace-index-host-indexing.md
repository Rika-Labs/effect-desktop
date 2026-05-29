---
date: 2026-05-17
type: in-flight-feature
topic: Implement WorkspaceIndex host indexing
issue: https://github.com/Rika-Labs/effect-desktop/issues/1396
pr: https://github.com/Rika-Labs/effect-desktop/pull/1403
---

# Implement WorkspaceIndex host indexing

## Decision

Host-backed capabilities should have one lifecycle event source, and test-only fault injection must be isolated the same way the test harness runs.

## What changed

The planned split held: TypeScript kept Schema validation, permissions, audit ordering, ignore filtering, and the public Effect contract while the Rust host adapter took canonical root checks, grant validation, session state, scans, refresh invalidation, lifecycle events, and cleanup. Background watching did not ship; `watch: true` now fails closed until the host owns watcher lifecycle.

The architecture-debt sweep changed the TypeScript service. It removed the service-local PubSub mirror and exposes the native client event stream directly, leaving the memory client as the deterministic test event source. The final CI pass also changed an unrelated Rust test hook: process-global mutation hooks became thread-local because the updated workflow exposed cross-test interference under parallel `cargo test --workspace`.

## Why it mattered

The invariant was not "events are available to subscribers"; it was "events describe the state owned by the component that changes it." Mirroring host lifecycle events in the service created a second source of truth for native session state. Passing through the client stream keeps ownership obvious and makes the host adapter accountable for lifecycle order.

The CI failure showed the same problem in tests. A global hook looked convenient because each test installed only one callback, but Rust runs tests in parallel. The hook could be consumed at the wrong mutation point, causing a stale-file assertion to report the hash of an empty recreated file instead of the expected changed bytes.

## Example

```rust
thread_local! {
    static BEFORE_REPLACEMENT_CREATE_HOOK: std::cell::RefCell<Option<FileReplacementTestHook>> =
        std::cell::RefCell::new(None);
}
```

## Rule candidate

Fault-injection hooks in parallel test suites must be scoped to the test thread, resource id, or operation id. Why: process-global hooks create nondeterministic failures that look like production regressions but are test harness interference.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
