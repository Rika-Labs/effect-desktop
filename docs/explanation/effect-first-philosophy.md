---
title: Effect-first philosophy
description: Why Effect primitives are the default architecture and thin wrappers are debt.
kind: explanation
audience: app-developers
effect_version: 4
---

# Effect-first philosophy

ORIKA is built on Effect v4. Not as a dependency, not as an internal helper — as the default architecture. The framework's [`AGENTS.md`](../../AGENTS.md) makes the rule explicit:

> Effect primitives are the default architecture. Custom abstractions must justify themselves by owning durable desktop-specific policy, lifecycle, security, or protocol translation.

## Why this matters

Wrapper layers over a strong primitive library look small at first. They start as a single helper "to make the API friendlier" and grow into a parallel system the team has to maintain in addition to the underlying library. Six months later, half the team learns the wrapper instead of Effect, and the other half pays the cost of the leaky abstraction.

The wrapper rule prevents that drift. If `WrappedThing` only renames, mirrors, narrows, or adapts an Effect API without adding desktop-specific semantics, it does not earn its place in the codebase.

## What "earns its place" looks like

A custom abstraction should own at least one of:

- **Desktop-specific policy.** "Filesystem writes must be inside a declared root and audited" is desktop policy. The plain `effect/platform` `FileSystem` does not enforce that. `@orika/core`'s `Filesystem` does. It earns its place.
- **Lifecycle that crosses a boundary.** `Window` owns a Rust-side resource keyed by a `WindowHandle`. The lifecycle has to coordinate runtime and host scopes. That is a real wrapper.
- **Security at a chokepoint.** `PermissionRegistry`, `ApprovalBroker`, `RedactionFilter` are non-trivial primitives. They earn their place.
- **Protocol translation.** `HostProtocolEnvelope` and `Client` translate Effect RPC into the framed wire format that the Rust host speaks. Without this translation, the bridge does not work.

If a wrapper does none of those, prefer the underlying Effect primitive directly.

## What this means for your app

The same rule applies in app code:

- Use `Effect.gen`, `Layer`, `Schedule`, `Stream`, and `Scope` directly. Don't write helpers that mirror them.
- If you find yourself wrapping `Effect.tryPromise` in a function with a different name, consider whether the function is adding any policy beyond renaming.
- Compose layers explicitly. The graph is data; you can inspect it (`Desktop.runtimeGraphSnapshot()`) and you can test it.
- Prefer `Schema.Class` for boundary data over hand-rolled validation. The schema is the type, the encoder, the decoder, the docs, and the test fixture.

## What this means for the framework

Inside the framework, the rule is enforced through the **architecture-debt sweep** (`AGENTS.md`):

> Every active goal must include an architecture-debt sweep. For each ticket or issue, inspect the area being touched for adapters, thin wrapper layers, custom DSLs, bridge specs, convenience APIs, or parallel abstractions over Effect.

Wrappers without durable semantics are removed in the same change that touches them. If removal is too large for the current ticket, an issue is opened with a concrete before/after that shows the current shape and the desired Effect-native shape.

This is why `BridgeRpc` is explicitly marked as a temporary boundary adapter — it carries protocol semantics Effect RPC doesn't yet own locally, but it will be removed as soon as canonical Effect RPC can express the same contract.

## Why this is a virtue, not a constraint

Two payoffs:

1. **Cohesion.** A small surface area of well-understood Effect primitives, plus a small set of clearly-justified desktop wrappers, is easier to reason about than a sprawl of helpers.
2. **Portability.** Your handlers are ordinary Effect programs. A handler that uses `SqlClient` and `PermissionRegistry` is not coupled to "ORIKA" beyond those two services. The same logic could move into a different runtime if you ever needed to.

## When you really do need a wrapper

Some legitimate wrapper shapes:

- A **service tag** that names a domain concept (`NoteRepository`) backed by `SqlClient`. The tag is the abstraction; the implementation is plain Effect SQL.
- A **layer** that pre-configures a generic primitive for a specific app concern (`makeAppTelemetryLayer({ appId, version })` returns a configured `Telemetry` layer).
- A **schema** that captures a domain shape (`class Note extends Schema.Class<Note>(...)`). Schemas are durable; they own decoding behavior.

Notice the pattern: each adds a name, a configuration, or a domain concept. None of them mirror an Effect API.

## Related

- [Layer-first design](layer-first-design.md) — the structural form of public services
- [Architecture overview](architecture.md) — where Effect shows up in the framework
- Contributor: [Architecture-debt sweep](../contributing/architecture-debt.md)
- [`AGENTS.md`](../../AGENTS.md)
