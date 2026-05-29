---
date: 2026-05-16
type: in-flight-feature
topic: Add isolated execution sandbox
issue: https://github.com/Rika-Labs/effect-desktop/issues/1388
pr: none
---

# Add isolated execution sandbox

## Decision

Capability metadata is not enforcement unless the registry checks every security-relevant field.

## What changed

The issue asked for a product-neutral execution sandbox with Schema contracts, a Layer-backed Effect service, typed failures, deterministic test seams, bridge wiring, Rust host payloads, fail-closed unsupported behavior, docs, and API snapshots. The shipped service normalizes filesystem and network policy to default-deny, checks permissions before client or host calls, publishes lifecycle events, and keeps the current Rust host adapter unsupported on macOS, Windows, and Linux after payload validation.

The platform review changed the permission layer. `process.spawn` already carried `cwd`, `environment`, `shell`, and `audit` metadata, but registry coverage only checked commands. The final change makes the registry enforce the full process capability and makes sandbox command validation reject shell-shaped argv0 values before bridge transport or host unsupported handling.

## Why it mattered

The invariant is that sandbox policy must be enforced as data before any process side effect. The hidden assumption was that because the capability object contained cwd and environment fields, permission checks already covered them. That was false. The mechanism that improved the result was a platform-fit review that compared the new surface against the existing `Process.spawn` contract rather than only checking the new tests.

## Example

```ts
P.processSpawn({
  commands: [command],
  cwd: [policy.cwd],
  environment: policy.environment.length === 0 ? "none" : "allowlist"
})
```

## Rule candidate

When a capability type adds policy fields, add or update registry coverage tests for each field in the same change. Why: metadata that is not checked creates a false security boundary.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
