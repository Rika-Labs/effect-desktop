# @effect-desktop/native

> **Status:** Phase 5 started. The Window service definition is available; host-backed live behavior lands in the later native-service issues. See `docs/SPEC.md`.

## Purpose

TypeScript-facing native services backed by the Rust host: `App`, `Window`, `WebView`, `Menu`, `Tray`, `Dialog`, `Clipboard`, `Notification`, `Shell`, `Screen`, `GlobalShortcut`, `Protocol`, `SafeStorage`, `Path`, `Updater`, `CrashReporter`, `PowerMonitor`, `SystemAppearance`, `Dock`.

## Public API

`Window` is exposed as an Effect service. `WindowApi` declares the matching bridge contract and `WindowClient` is the substitutable port used by tests and future host-backed adapters.

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

This package depends on `effect` for services/layers and on `@effect-desktop/bridge` for the shared `Api` contract and host protocol error schemas. These are framework-internal dependencies required by the Phase 5 Window service boundary.

## Platform notes

None until the package implements native-touching primitives.

## Internal architecture

To be documented as the package is built out.
