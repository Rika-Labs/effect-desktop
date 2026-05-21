---
title: Architecture-debt sweep
description: The Effect-first wrapper rule, what it costs, and how to apply it.
kind: contributing
audience: contributors
effect_version: 4
---

# Architecture-debt sweep

Every active contribution includes an architecture-debt sweep. The rule comes from [`AGENTS.md`](../../AGENTS.md):

> Every active goal must include an architecture-debt sweep. For each ticket or issue, inspect the area being touched for adapters, thin wrapper layers, custom DSLs, bridge specs, convenience APIs, or parallel abstractions over Effect. If a wrapper is not adding durable desktop-specific semantics, remove it as part of the current work.

This page is the practical companion to that rule. The "why" lives in [Effect-first philosophy](../explanation/effect-first-philosophy.md).

## What "thin wrapper" means

A thin wrapper is code that:

- Renames an Effect API without adding semantics (`runEffect` that just calls `Effect.runPromise`).
- Mirrors a primitive's surface in a custom shape (`MyLayer` that wraps `Layer` with the same methods).
- Narrows a primitive's flexibility for no reason (`spawnProcess(cmd)` that hard-codes choices the underlying primitive made configurable).
- Provides a partial reimplementation of an Effect API that the team has to maintain in addition to Effect.

A wrapper is **not thin** if it:

- Owns desktop-specific policy (permission checks, scope binding, audit emission).
- Crosses a boundary (runtime/host, runtime/renderer, native/typescript).
- Translates a protocol Effect doesn't speak (host protocol envelope, app-protocol routing).
- Anchors a domain concept the framework owns (`PermissionRegistry`, `ApprovalBroker`, `RedactionFilter`).

## Doing the sweep

For every ticket, before closing:

1. **Look at the area being touched.** Not just the lines you changed — the file, and adjacent files in the same capability.
2. **Identify candidates.** Adapters, thin layers, custom DSLs, bridge specs, convenience APIs that sit over Effect without adding durable semantics.
3. **Apply the rule.**
   - If the wrapper has no durable purpose, remove it as part of the current work. Update call sites to use Effect directly.
   - If removal is larger than the current ticket, open a follow-up GitHub issue with a concrete before/after that shows the current shape and the desired Effect-native shape. The issue must explain why the wrapper is debt, what durable semantics must remain, and how the code should rely on Effect directly.
4. **Record the outcome.** Note in the PR description: "wrappers removed: …", "follow-up issues opened: …", or "no debt found in the touched area." The note is the closing condition.

## Worked example: removing a thin layer

Before:

```ts
// helpers/run-with-timeout.ts — adds nothing Effect doesn't already do
export const runWithTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  ms: number
): Effect.Effect<Option.Option<A>, E, R> => effect.pipe(Effect.timeoutOption(Duration.millis(ms)))

// caller
const result = yield * runWithTimeout(fetchData, 5000)
```

After (the sweep removes the helper):

```ts
// caller — direct Effect API
const result = yield * fetchData.pipe(Effect.timeoutOption(Duration.millis(5000)))
```

The wrapper added a name and removed a `pipe` call. It did not add durable semantics. Removed.

## Worked example: keeping a wrapper that earns its place

```ts
// packages/core/src/runtime/secrets.ts — keeps its place
export class Secrets extends Context.Service<Secrets, SecretsApi>()("@orika/core/Secrets") {}
```

`Secrets` wraps `SafeStorage` (the native primitive). It earns its place because it:

- Validates namespace and key segments before touching the platform.
- Checks `secrets.read` / `secrets.write` permissions explicitly.
- Returns `Redacted<Uint8Array>` so secret bytes can't accidentally hit logs.
- Emits `secret/accessed` audit events with namespace and outcome.
- Provides `wipeSecretBytes(...)` so callers can clean up returned bytes.

Five durable desktop concerns. The wrapper stays.

## When a follow-up issue is the right call

If the sweep finds a wrapper that should go but the removal would explode the diff (touches 30 call sites, intersects with another active workstream, blocks a release branch), file the follow-up. Issue body should look like:

```md
## Architecture debt: <wrapper name>

### Current shape

[current code, briefly]

### Desired shape

[Effect-native shape]

### Why this is debt

[no durable semantics added; mirrors X; renames Y]

### Why removal is deferred

[size, blocker, scheduling]

### Migration plan

[ordered steps; how call sites move; how tests follow]
```

The issue should not stay open indefinitely. Either it makes the next milestone or someone re-evaluates whether the wrapper is actually debt.

## Related

- [Effect-first philosophy](../explanation/effect-first-philosophy.md) — the "why"
- [`AGENTS.md`](../../AGENTS.md) — the repo-wide rule
- [Layer-first design](../explanation/layer-first-design.md) — the structural shape that earns its place
