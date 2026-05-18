---
title: Mutable macOS traffic lights
date: 2026-05-18
---

# Mutable macOS traffic lights

Window chrome now has one mutable platform-specific command:
`Window.setTrafficLights`. The command accepts a live window handle and a
non-negative traffic-light inset, routes through the existing Window
Schema/RPC/Layer/native-host path, and calls Tao's macOS
`set_traffic_light_inset` operation.

The host returns typed `Unsupported` on non-macOS hosts instead of silently
ignoring the request. This keeps the current slice honest: portable window title,
resizable, and decorations commands remain separate from macOS-only chrome
policy.

Verification:

- `cargo fmt --check`
- `cargo test -p host-protocol window --lib`
- `cargo test -p host window_chrome_methods_route_to_window_handler --bin host`
- `cargo test -p host window_ --bin host`
- `bun x tsc --noEmit -p packages/bridge/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/test/tsconfig.json --pretty false`
- `bun test packages/bridge/src/window.test.ts packages/native/src/window.test.ts packages/native/src/index.test.ts -t Window`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun desktop check --api --write`

Architecture-debt sweep: no wrapper removed. This extends the existing
Window boundary with one platform-owned chrome command and does not add a
parallel `WindowChrome` facade. Remaining #1345 debt is mutable titlebar style,
mutable vibrancy, shadow/transparency controls, and a complete platform support
matrix for chrome behavior.
