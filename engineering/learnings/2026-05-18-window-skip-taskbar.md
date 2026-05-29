---
title: Window skip-taskbar control
date: 2026-05-18
---

# Window skip-taskbar control

`Window.setSkipTaskbar` is now a host-backed window command. The public API uses
the existing Window Schema/RPC/Layer path, the bridge carries a typed
`Window.setSkipTaskbar` payload, and the Rust host routes the command to Tao's
platform extension where Tao exposes it.

The command is platform-partial by design: Windows and Linux are supported, and
macOS returns typed `Unsupported`. The API does not hide this behind a portable
success no-op.

Verification:

- `bun x tsc --noEmit -p packages/bridge/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/test/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/core/tsconfig.json --pretty false`
- `bun test packages/bridge/src/window.test.ts packages/native/src/window.test.ts packages/native/src/index.test.ts -t Window`
- `cargo test -p host-protocol window --lib`
- `cargo test -p host window_attention_methods_route_to_window_handler --bin host`
- `cargo test -p host window_ --bin host`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun desktop check --api --write`
- `bun desktop check --api`
- `cargo fmt --check`
- `git diff --check`

Architecture-debt sweep: no wrapper removed. This extends the existing Window
boundary with one platform-owned command and does not add a `WindowAttention`,
`WindowChrome`, or custom z-order DSL. Remaining #1346 debt is window-scoped
badge, flash, attention lifecycle events, and any future macOS-specific
skip-taskbar semantics if a real host primitive is chosen.
