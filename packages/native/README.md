# @effect-desktop/native

> **Status:** Phase 0 stub. The package directory exists so the workspace resolves and validation gates run; the public API is populated in Phases 5, 7, 8. See `docs/SPEC.md`.

## Purpose

TypeScript-facing native services backed by the Rust host: `App`, `Window`, `WebView`, `Menu`, `Tray`, `Dialog`, `Clipboard`, `Notification`, `Shell`, `Screen`, `GlobalShortcut`, `Protocol`, `SafeStorage`, `Path`, `Updater`, `CrashReporter`, `PowerMonitor`, `SystemAppearance`, `Dock`.

## Public API

Not yet defined. Phase 0 ships an empty barrel export only.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
// Reserved for Phases 5, 7, 8.
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

None until the package implements native-touching primitives.

## Internal architecture

To be documented as the package is built out.
