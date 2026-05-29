---
date: 2026-05-16
type: in-flight-feature
topic: Add local tool runtime
issue: https://github.com/Rika-Labs/effect-desktop/issues/1385
pr: none (direct main flow)
---

# Add local tool runtime

## Decision

Local tool execution should be modeled as a manifest-bound policy envelope over stable command IDs, not as a friendlier process-spawn wrapper.

## What changed

The issue asked for a product-neutral local tool runtime with typed manifests, permissions, health, lifecycle events, host wiring, and tests. The shipped shape keeps `ExecutionSandbox` as the lower process-policy primitive and adds `LocalToolRuntime` above it as a desktop contract for tool identity, command IDs, cwd/env/filesystem/network/budget/stdio/cleanup policy, permission gates, audit rows, and deterministic test execution. Platform review changed the final code by forcing command-level timeout preservation through normalization and by making Rust serialize empty filesystem/network policy objects so TypeScript receives the explicit policy shape it requires.

## Why it mattered

The invariant is that authority must attach to the manifest command ID and its declared policy before any host side effect occurs. A local incentive pushed toward copying existing process-runner shapes, but that would have hidden the runtime's real contract: the manifest is the source of truth, and the host boundary must echo the same policy data the public Schema decodes.

## Example

```ts
new LocalToolRuntimeCommand({
  commandId: "node-version",
  executable: "/usr/bin/node",
  cwd: "/tmp/app",
  timeoutMillis: 1_000
})
```

Normalization may fill defaults such as args, cwd, or environment, but it must not erase the declared command budget. Host payloads likewise keep empty policy objects explicit, so the bridge cannot silently reinterpret omitted policy as absent policy.

## Rule candidate

When adding a manifest-owned native primitive, add a regression that proves normalization preserves every optional policy field and that Rust canonical serialization decodes through the TypeScript Schema.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -- `/learn` never auto-edits AGENTS.md.
