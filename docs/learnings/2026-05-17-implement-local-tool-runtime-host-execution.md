---
date: 2026-05-17
type: in-flight-feature
topic: Implement LocalToolRuntime host execution
issue: https://github.com/Rika-Labs/effect-desktop/issues/1394
pr: none
---

# Implement LocalToolRuntime host execution

## Decision

Host-backed native capabilities must fail closed for any declared policy the host does not actually enforce.

## What changed

`LocalToolRuntime` moved from typed unsupported host methods to real Unix host execution. TypeScript still owns Schema contracts, permission checks, audit rows, and the public Effect service. The Rust host now owns manifest registration, command lookup, cwd canonicalization, absolute executable spawning without a shell, stdout and stderr capture limits, wall-clock timeout, lifecycle events, health checks, active-run stop, and process-tree cleanup.

The final review changed the budget contract. CPU and memory budgets are still in the manifest shape, but the host does not enforce OS CPU or memory limits yet. Constrained values now return typed `Unsupported`; only the explicit unbounded sentinel is accepted until #1404 implements enforcement.

## Why it mattered

The dangerous state was not an unimplemented feature. The dangerous state was accepting a policy field in a production host path while silently ignoring it. That gives callers a false safety contract and makes later enforcement a behavior change instead of a completion of promised behavior.

The fix keeps the service useful for declared local commands while making unsupported policy visible at registration time, before a process can spawn.

## Example

```rust
if value != UNBOUNDED_OS_BUDGET {
    return Err(HostProtocolError::unsupported(reason, operation));
}
```

## Rule candidate

When a manifest contains security, resource, or lifecycle policy, the host must either enforce it or reject it with typed `Unsupported` before side effects. Documentation alone is not enough because callers integrate against behavior, not intent.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
