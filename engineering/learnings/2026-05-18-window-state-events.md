---
title: Window state events
date: 2026-05-18
---

# Window state events

Window state controls now publish typed state snapshots through the existing
`Window.Event` subscription. `Window.Event` is a discriminated union:
`window-registry-event` for opened/focused/closed lifecycle and
`window-state-event` for minimized, maximized, and fullscreen booleans.

The host emits a state snapshot only after a state command succeeds. The command
updates the same host-owned state source that `Window.getState` reads, and the
payload uses the same `WindowState` shape. Renderer code can compare a state
event with a follow-up read without translating between two contracts. This
keeps state observability inside the existing event boundary instead of adding a
parallel stream service.

Verification:

- `cargo fmt --check`
- `cargo test -p host-protocol window --lib`
- `cargo test -p host window_state_events_encode_to_runtime_sender --bin host`
- `bun x tsc --noEmit -p packages/bridge/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun test packages/bridge/src/window.test.ts packages/native/src/index.test.ts -t 'Window.Event|Window.events|Window service delegates'`

Architecture-debt sweep: no wrapper removed. The touched area uses the existing
Schema/RPC/Layer/native-host boundary and widens the existing event contract
instead of adding a new convenience stream or custom event DSL. Remaining #1344
debt is separate macOS simple-fullscreen semantics and deeper platform-specific
truth for OS-originated state changes beyond host-tracked command state.
