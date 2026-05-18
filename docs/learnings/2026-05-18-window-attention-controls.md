# Window Attention Controls

Issue: #1346

The smallest correct implementation was the Tao-backed subset: always-on-top, progress, request attention, and cancel attention. Skip-taskbar and badge/flash semantics were left out because they are either platform-extension APIs or already app/Dock-scoped, so exposing them as portable window methods would overstate the host contract.

The useful invariant is that the public Window surface only claims methods backed by routed host operations. The bridge and native schemas validate progress as an integer from 0 through 100 before crossing the host boundary, and the Rust adapter repeats the progress bound check at the wire edge.

Architecture-debt sweep: the touched area still has the intended bridge adapter boundary between native RPC and host protocol, and no new wrapper over Effect primitives was added. No adapter was removed. No follow-up architecture-debt issue was opened for this slice because the remaining gaps are platform capability gaps, not wrapper debt in the touched implementation.

Verification:

- `bun test packages/bridge/src/window.test.ts packages/native/src/window.test.ts packages/native/src/index.test.ts`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/test/src/index.test.ts packages/test/src/native.test.ts`
- `cargo test -p host-protocol window --lib`
- `cargo test -p host window_ --bin host`
- `cargo test -p host host_dispatch_registry_covers_host_protocol_methods --bin host`
