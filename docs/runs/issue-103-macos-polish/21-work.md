# Issue 103 Work

## Changes

- Added typed macOS window polish fields to the Rust and TypeScript host window create payloads:
  - `titleBarStyle`
  - `vibrancy`
  - `trafficLights`
- Added `crates/host/src/macos.rs` as the host-owned macOS platform module.
- Applied Tao macOS title-bar and traffic-light builder hooks for configured window polish.
- Applied macOS vibrancy through the target-scoped `window-vibrancy` crate, which attaches the native `NSVisualEffectView`.
- Added Dock badge count/text host routing through the existing event-loop window command path.
- Added `Dock.requestAttention` host routing through Tao `Window::request_user_attention`.
- Added `Dock.setMenu` host routing and payload validation. The native macOS adapter returns a typed `Unsupported` until the host owns an `NSApplication` delegate bridge for Dock menus.
- Added `Menu.setApplicationMenu` and `Menu.setWindowMenu` host routing, backed by macOS `muda::Menu::init_for_nsapp()`.
- Documented the macOS-only native dependencies in `crates/host/README.md`.
- Kept failures typed as `HostProtocolError`; TypeScript effectful paths continue to return `Effect.Effect<_, HostProtocolError, never>`.

## Deferred Capabilities

- `Dock.setMenu` is routed host-side and no longer returns method-not-found, but native macOS Dock menu installation is not complete. It needs an `NSApplication` delegate bridge rather than the app-menu-only `muda::Menu::init_for_nsapp()` path.
- `Menu.setWindowMenu` validates the window id but currently installs through the macOS application menu path because macOS has a single process menu bar. A later Windows/Linux adapter can provide true per-window menu attachment.

## Handoff

Work slice implemented. Continue to `/verify`.
