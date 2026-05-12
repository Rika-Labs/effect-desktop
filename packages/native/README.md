# @effect-desktop/native

> **Status:** Phase 5 started. The Window service definition is available; host-backed live behavior lands in the later native-service issues. See `docs/SPEC.md`.

## Purpose

TypeScript-facing native services backed by the Rust host: `App`, `Window`, `WebView`, `Menu`, `Tray`, `Dialog`, `Clipboard`, `Notification`, `Shell`, `Screen`, `GlobalShortcut`, `Protocol`, `SafeStorage`, `Path`, `Updater`, `CrashReporter`, `PowerMonitor`, `SystemAppearance`, `Dock`.

## Public API

`Screen` is the current generated Layer-first native proof. `ScreenRpcs` is the canonical Effect `RpcGroup`; `ScreenSurface` derives the server, client, test-client, schema-doc, and contract-law artifacts; and `makeScreenBridgeClientLayer()` adapts the existing bridge exchange into the generated Effect RPC protocol. `ScreenClient` remains the substitutable port used by tests and adapters.

`Window` is exposed as an Effect service. `WindowRpcs` is the full Window method descriptor with support metadata, and `WindowSupportedRpcs` is the generated callable group used by the bridge client layer. `makeHostWindowBridgeRpcLayer()` still binds the runtime handler side to the existing host window envelopes. `WindowClient` remains the substitutable port used by tests and adapters, but its supported callable surface is `create` and `close`.

`WindowBridgeClientOptions` omits `nextRequestId` because the generated Effect RPC protocol owns request identifiers for `makeWindowBridgeClientLayer()`. Tests that need deterministic request ids should assert observed requests at the exchange boundary instead of injecting ids through the Window options object.

The generated Window client validates caller input before transport and validates host success payloads before returning app values. Invalid caller input fails as `HostProtocolInvalidArgumentError`; malformed create or close success payloads fail as `HostProtocolInvalidOutputError`.

`AppEventRouter` is the in-process §8.8 routing primitive for App-level events. It tracks open and focused windows, routes `firstResponder`, `broadcast`, and `targeted(windowId)` events, emits typed audit rows for buffer eviction and closed targets, and keeps host-created windows in per-window resource scopes.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect } from "effect"
import { Screen, Window } from "@effect-desktop/native"

const program = Effect.gen(function* () {
  const screen = yield* Screen
  const window = yield* Window
  const pointer = yield* screen.getPointerPoint()
  const created = yield* window.create({ title: "Effect Desktop" })
  return { created, pointer }
})
```

## Testing

```bash
bun test
bun run typecheck
```

## Dependency notes

This package depends on `effect` for services/layers, streams, queues, refs, and typed failures; on `@effect-desktop/bridge` for `RpcGroup` bridge helpers and host protocol error schemas; and on `@effect-desktop/core` for the runtime resource registry used by the live Window adapter. These are framework-internal dependencies required by the Phase 5 Window service boundary.

## Platform notes

`AppEventRouter` is platform-neutral. Platform-specific focus ambiguity, such as Wayland falling back to broadcast, is modeled by the caller choosing the `broadcast` route before publishing.

## Internal architecture

To be documented as the package is built out.
