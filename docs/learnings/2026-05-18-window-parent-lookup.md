# Window parent lookup

Issue: #1347

The ownership slice now exposes `Window.getParent(window)` as a query over the host-owned parent map. The bridge requests `Window.getParent` with `{ windowId }`, the Rust host validates that the child is still open, and the native adapter maps the optional `parentWindowId` back to a fresh `WindowHandle` or `undefined`.

This kept the ownership contract narrow. I did not add a `WindowOwnership` service, runtime `setParent`, modal flag, or child enumeration because those require new lifecycle policy and host event semantics. The current method only reveals state the host already owns after `Window.create({ parent })`.

Verification:

- `bun x tsc --noEmit -p packages/bridge/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/test/tsconfig.json --pretty false`
- `bun test packages/bridge/src/window.test.ts packages/native/src/index.test.ts packages/test/src/index.test.ts packages/test/src/native.test.ts -t Window`
- `cargo test -p host-protocol window --lib`
- `cargo test -p host window_lookup_methods --bin host`
- `bun desktop check --api`
- `bun x ultracite check packages/bridge/src/protocol.ts packages/bridge/src/window.ts packages/bridge/src/window.test.ts packages/native/src/window.ts packages/native/src/contracts/window.ts packages/native/src/index.test.ts packages/native/src/desktop-http-api.test.ts packages/native/src/window-persistence.test.ts packages/test/src/index.ts packages/test/src/native.ts docs/reference/native/window.md`
- `cargo fmt --check`
- `git diff --check`

Architecture-debt sweep: no wrapper removed. The touched area still has bridge/native adapters because they translate between renderer RPC, host protocol envelopes, and Rust event-loop commands. No new custom DSL or Effect-parallel abstraction was added. Remaining #1347 work is modal enable/disable, runtime parent mutation, owner lookup, child query, and ownership events.
