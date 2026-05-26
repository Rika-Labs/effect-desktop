---
title: Layer-first design
description: Why every public capability ships as a service tag, three layers, and a contract.
kind: explanation
audience: app-developers
effect_version: 4
---

# Layer-first design

ORIKA's public capabilities follow a single shape. Once you have seen it twice, every other capability becomes predictable.

## The shape

A public capability ships **five things in one module**:

1. **A contract** — an `RpcGroup` describing methods, schemas, errors, and capability metadata.
2. **A service tag** — `Context.Service<T, Api>(tag)` — the value handlers depend on.
3. **A service layer** — produces the service against an explicit client or backend.
4. **A client layer** — produces a client wrapper that goes through the bridge.
5. **A test layer** — produces a deterministic in-memory implementation.

Plus a **handler layer** (`<Name>HandlersLive`) that registers the runtime side, and a **surface** (`Desktop.Rpc.surface(...)`) that bundles schema docs and contract-law checks.

Look at `packages/native/src/window.ts` and you see all of them. Look at any other native module — clipboard, dialog, screen, notification — and you see the same shape. That is not coincidence; it is policy.

## Why the discipline

Three properties fall out of this shape:

- **Substitutability.** Anywhere that depends on the service tag will accept any layer that provides it. Real, faked, mock, custom — all interchangeable. Tests don't need new APIs; they need a different `Layer.provide`.
- **Testability without ceremony.** The deterministic in-memory layer is a peer of the production service layer, not a hidden helper. You don't reach into private internals to fake a dialog; you provide `DialogTest` at the service boundary.
- **Boundary discipline.** A client layer goes through the bridge; a service layer runs in the runtime. The two never collapse into "just call this function" because they are typed differently. The compiler enforces which side of the boundary you are on.

This is the **layer-first contract** that governs new public capabilities (see `engineering/architecture/layer-first-contract.md`). Every new public surface should follow it. Every shallow wrapper that doesn't is architecture debt.

## Read a single capability end-to-end

Take `Window` as the worked example.

```ts
// 1. Contract
export const WindowCreate = windowRpc(
  "create",
  WindowCreateInput,
  WindowResource,
  P.nativeInvoke({ primitive: "Window", methods: ["create"] })
)

export const WindowRpcs: RpcGroup.RpcGroup<WindowRpcUnion> = WindowRpcGroup

// 2. Service tag
export class Window extends Context.Service<Window, WindowApi>()("@orika/native/Window") {}

// 3. Native app-composition surface
export const window = Native.surface(WindowSurface)

// 4. Test layer
//    Provide Window directly, or use @orika/test.

// + handler layer for the runtime side
export const WindowHandlersLive = WindowRpcGroup.toLayer({
  /* handlers */
})

// + surface
export const WindowSurface = DesktopRpc.surface("Window", WindowRpcGroup, options)
```

`WindowMethodNames` exists so callers can check the exported method list without running anything. `WindowRpcs` is the descriptor for schema docs, handlers, generated clients, and contract-law checks. The public `WindowApi` is mapped on top where the framework owns durable desktop policy such as optional create defaults and event-resource reconciliation.

## Composing layers in your app

In your runtime entry, you `Layer.merge` and `Layer.provide` to assemble the dependency graph:

```ts
import { Layer } from "effect"
import {
  PermissionRegistry,
  ResourceRegistryLive,
  AuditEventsLive,
  SettingsLive,
  TelemetryLive
} from "@orika/core"
import {
  Window,
  WindowHandlersLive,
  Clipboard,
  ClipboardClient,
  ClipboardHandlersLive
} from "@orika/native"

const PermissionRegistryLive = Layer.effect(PermissionRegistry, PermissionRegistry.make)
const WindowTest = Layer.succeed(Window)(testWindow)
const ClipboardClientLayer = Layer.succeed(ClipboardClient)(testClipboardClient)
const ClipboardLayer = Layer.provide(Clipboard.layer, ClipboardClientLayer)

const RuntimeLive = Layer.mergeAll(
  PermissionRegistryLive,
  ResourceRegistryLive,
  AuditEventsLive,
  SettingsLive,
  TelemetryLive,
  WindowTest,
  WindowHandlersLive,
  ClipboardLayer,
  ClipboardHandlersLive
)
```

`Desktop.make` and `Desktop.layer` give you sensible defaults so you don't usually compose the whole graph by hand. But the graph is always **inspectable** — `Desktop.runtimeGraphSnapshot()` returns it as data, and the devtools layer-graph panel renders it.

## Deep modules, narrow interfaces

The layer-first shape produces **deep modules** in Ousterhout's sense: each capability hides a lot behind a small, obvious surface.

`Window` exposes one service requirement at the runtime boundary. Behind `create`, `destroy`, `events`, and the rest of the service sits permission checks, scope ownership, host-protocol framing, Rust-side window registration, event reconciliation, and audit emission. The user types `window.create.useMutation()` and gets all of it. They cannot accidentally bypass it because there is no "just call the host" alternative.

This is what the user-side rules (`AGENTS.md`'s architecture-debt sweep) protect: every shallow wrapper that doesn't add durable desktop semantics gets removed, because shallow wrappers add surface area without hiding anything. Effect's own primitives — `Layer`, `Schedule`, `Stream`, `Scope` — are deep enough on their own; wrapping them in a same-shape adapter just doubles the surface.

## What the layer-first contract requires

Concretely, every public effectful capability must:

- Expose `Effect.Effect<A, E, R>` shapes — never `async/await` for application logic.
- Use a `Context.Service` tag — never an exported singleton.
- Provide live, client, and test layers — pick the right one in `Layer.provide`.
- Use `Schema.Class` for boundary data — every input and output is decoded.
- Use `Data.TaggedError` for failures — every error is closed.
- Document support per-platform when the capability is platform-limited (Appendix K of the SPEC).
- Have at least one verification row in the verification matrix (Appendix C).

These come straight from the SPEC §6.0+. You can read every one of them as a guard rail against accidentally producing a shallow, untestable, or untyped capability.

## Related

- [Architecture overview](architecture.md) — three process roles
- [RPC surface vs. mapped surface](rpc-surface-vs-mapped.md) — when to use which
- [Effect-first philosophy](effect-first-philosophy.md) — why thin wrappers are debt
- Contributor: [Architecture-debt sweep](../contributing/architecture-debt.md)
