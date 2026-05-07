# Issue 103 Work

## Changes

- Added typed macOS window polish fields to the Rust and TypeScript host window create payloads:
  - `titleBarStyle`
  - `vibrancy`
  - `trafficLights`
- Added `crates/host/src/macos.rs` as the host-owned macOS platform module.
- Applied Tao macOS title-bar and traffic-light builder hooks for configured window polish.
- Added Dock badge count/text host routing through the existing event-loop window command path.
- Added `Dock.requestAttention` host routing through Tao `Window::request_user_attention`.
- Kept failures typed as `HostProtocolError`; TypeScript effectful paths continue to return `Effect.Effect<_, HostProtocolError, never>`.

## Known Remaining Gaps

- `NSVisualEffectView` attachment for real vibrancy is validated but not yet attached.
- `Menu.setApplicationMenu` and `Menu.setWindowMenu` are not yet routed through the Rust host.
- `Dock.setMenu` is not yet implemented host-side.

These gaps mean #103 is not merge-ready until addressed or explicitly split into follow-up issues.

## Handoff

Work slice implemented. Continue to `/verify`.
