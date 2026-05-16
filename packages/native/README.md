# @effect-desktop/native

> **Status:** Native service APIs are Layer-first Effect services backed by canonical Effect RPC surfaces. See `engineering/SPEC.md`.

## Purpose

TypeScript-facing native services backed by the Rust host: `App`, `Window`, `WebView`, `Menu`, `Tray`, `Dialog`, `Clipboard`, `Notification`, `Shell`, `Screen`, `GlobalShortcut`, `Protocol`, `SafeStorage`, `Path`, `Updater`, `CrashReporter`, `PowerMonitor`, `SystemAppearance`, `Dock`.

## Public API

Each native module exposes a canonical Effect `RpcGroup`, a generated `*Surface`, an Effect service, a client service, live handlers, support metadata, and deterministic test seams. `Native.capabilities(...)` is the public app-composition API; method selections such as `Native.Clipboard.readText` register the required native surface and grant only that method's authority. `Native.all` selects every built-in native surface and every privileged native method. `Native.available(...)` registers native availability without granting authority. The `*Surface` value remains the internal source for server, client, test-client, schema-doc, contract-law, host-runtime, and default bridge-client artifacts.

Native RPC endpoints are authored through the package-internal `NativeSurface` helper. New native endpoints must declare payload and success schemas, endpoint kind, support status, and authority in one place. Authority is explicit: either a native invoke capability, an explicit no-permission endpoint, or a custom capability for desktop-specific policy. Native service files should not call `Rpc.make(...)` directly.

`NativeCapabilities` builds its manifest from selected native layers, not from a parallel table of RPC groups. Every manifest fact includes the endpoint tag, capability metadata, and support metadata. Duplicate tags, missing capability metadata, and unsupported endpoints without reasons fail as typed manifest errors.

`Window` is exposed as an Effect service. `WindowRpcs` is the full Window method descriptor with support metadata, and `WindowSupportedRpcs` is the generated callable group used by the bridge client layer. The host runtime binds handlers through canonical Effect RPC groups and bridge protocol adapters. `WindowClient` remains the substitutable port used by tests and adapters, but its supported callable surface is `create` and `close`.

`WindowBridgeClientOptions` omits `nextRequestId` because the generated Effect RPC protocol owns request identifiers for `WindowSurface.bridgeClientLayer(...)`. Tests that need deterministic request ids should assert observed requests at the exchange boundary instead of injecting ids through the Window options object.

The generated Window client validates caller input before transport and validates host success payloads before returning app values. Invalid caller input fails as `HostProtocolInvalidArgumentError`; malformed create or close success payloads fail as `HostProtocolInvalidOutputError`.

`AppEventRouter` is the in-process §8.8 routing primitive for App-level events. It tracks open and focused windows with `SubscriptionRef`, routes `firstResponder`, `broadcast`, and `targeted(windowId)` events through per-window/per-event `PubSub` channels, emits typed audit rows from a replaying sliding `PubSub`, and keeps host-created windows in per-window resource scopes.

## Non-goals

See `engineering/SPEC.md` for the package's normative non-goals.

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

This package depends on `effect` for services/layers, streams, `PubSub`, `SubscriptionRef`, and typed failures; on `@effect-desktop/bridge` for `RpcGroup` bridge helpers and host protocol error schemas; and on `@effect-desktop/core` for the runtime resource registry used by the live Window adapter. These are framework-internal dependencies required by the Phase 5 Window service boundary.

## Platform notes

`AppEventRouter` is platform-neutral. Platform-specific focus ambiguity, such as Wayland falling back to broadcast, is modeled by the caller choosing the `broadcast` route before publishing.

## Internal architecture

`NativeSurface` is internal to this package. It is not a public app-authoring API; app code should compose exported native capability selections through `Native.capabilities(...)`, use `Native.available(...)` only for support-only surfaces, and consume Effect services at runtime. Boundary-specific adapters may remain local when they translate native/web protocol semantics, event streams, resource handles, or request normalization. Thin wrappers that only rename Effect RPC construction are architecture debt and should be removed.
