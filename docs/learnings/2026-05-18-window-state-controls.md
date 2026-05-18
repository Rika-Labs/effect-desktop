---
date: 2026-05-18
topic: window-state-controls
issue: 1344
---

# Window State Controls

Window state controls belong on the existing `Window` surface until the system has a host-backed continuous state stream. A separate state service would add a second contract for the same resource handle without hiding durable policy.

The useful boundary is the host protocol payload, not another TypeScript wrapper. `minimize`, `maximize`, `restore`, `setFullscreen`, and `getState` now use Schema-typed RPC inputs and a Rust payload that decodes back through the same bridge contract.

The remaining gap is event truth. Tao can apply and read minimized, maximized, and fullscreen state, but this change does not yet expose host-backed state change events or macOS simple fullscreen. Keeping #1344 open is more honest than pretending command success is an event stream.

Architecture-debt sweep: no wrapper was removed. The touched area still depends on the small bridge adapter as the native/web boundary, and no new abstraction was introduced over Effect RPC, Schema, Layer, or Stream.
