# @effect-desktop/native

> **Status:** Phase 5 started. The Window service definition is available; host-backed live behavior lands in the later native-service issues. See `docs/SPEC.md`.

## Purpose

TypeScript-facing native services backed by the Rust host: `App`, `Window`, `WebView`, `Menu`, `Tray`, `Dialog`, `Clipboard`, `Notification`, `Shell`, `Screen`, `GlobalShortcut`, `Protocol`, `SafeStorage`, `Path`, `Updater`, `CrashReporter`, `PowerMonitor`, `SystemAppearance`, `Dock`.

## Public API

`Window` is exposed as an Effect service. `WindowApi` declares the matching bridge contract, `registerWindowApi()` registers it during bootstrap before the bridge registry is frozen, `makeHostWindowApiLayer()` binds the runtime handler side to the existing host window envelopes, and `makeWindowBridgeClientLayer()` supplies the service through the typed bridge client. `WindowClient` remains the substitutable port used by tests and adapters.

`AppEventRouter` is the in-process §8.8 routing primitive for App-level events. It tracks open and focused windows, routes `firstResponder`, `broadcast`, and `targeted(windowId)` events, emits typed audit rows for buffer eviction and closed targets, and keeps host-created windows in per-window resource scopes.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect } from "effect"
import { Window } from "@effect-desktop/native"

const program = Effect.gen(function* () {
  const window = yield* Window
  return yield* window.create({ title: "Effect Desktop" })
})
```

## Testing

```bash
bun test
bun run typecheck
```

## Dependency notes

This package depends on `effect` for services/layers, streams, queues, refs, and typed failures; on `@effect-desktop/bridge` for the shared `Api` contract and host protocol error schemas; and on `@effect-desktop/core` for the runtime resource registry used by the live Window adapter. These are framework-internal dependencies required by the Phase 5 Window service boundary.

## Platform notes

`AppEventRouter` is platform-neutral. Platform-specific focus ambiguity, such as Wayland falling back to broadcast, is modeled by the caller choosing the `broadcast` route before publishing.

## Internal architecture

To be documented as the package is built out.
