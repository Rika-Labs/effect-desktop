---
title: Window center-on-display placement
date: 2026-05-18
---

# Window center-on-display placement

Window placement now has one host-owned display-relative operation:
`Window.centerOnDisplay`. It accepts a live window handle and a host
`ScreenDisplay.id`, validates both before native work, and centers the current
window size on the selected display through the Rust host.

This is narrower than a general placement policy. Tao exposes monitor bounds
but not a cross-platform monitor work-area API, so Effect Desktop still reports
`workArea` from monitor bounds and cannot yet clip arbitrary bounds around OS
reserved areas.

Verification:

- `cargo fmt --check`
- `cargo test -p host-protocol window --lib`
- `cargo test -p host window_ --bin host`
- `cargo test -p host host_dispatch_registry_covers_host_protocol_methods --bin host`
- `bun test packages/bridge/src/window.test.ts packages/native/src/window.test.ts packages/native/src/index.test.ts packages/native/src/parity-matrix.test.ts -t 'Window|window client requests Window.getBounds|NativeParityMatrix'`
- `bun test packages/native/src/parity-matrix.test.ts -t 'native parity docs and CLI artifact are generated from current source'`
- `bun x tsc --noEmit -p packages/bridge/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/test/tsconfig.json --pretty false`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. This extends the existing
Schema/RPC/Layer/native-host boundary and keeps placement math in the host path.
Remaining #1343 debt is true platform work-area semantics, arbitrary
display-relative placement and clipping, and move/resize observability.
