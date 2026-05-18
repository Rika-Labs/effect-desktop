# Window Lifecycle Controls

Issue: #1342

## What changed

- Added `Window.show`, `Window.hide`, and `Window.focus` across the bridge client, native RPC surface, host protocol constants, host method router, and Tao-backed host registry.
- Updated native parity, public API snapshots, reference docs, and test harness adapters so consumers see the same callable surface.

## What worked

- Reusing the existing `WindowDestroyPayload` wire shape for `{ windowId }` kept the host protocol small while still validating the boundary per operation.
- The native resource registry remained the source of truth for freshness, generation checks, and scope cleanup; lifecycle commands reuse that same handle validation instead of adding parallel state.
- Focus updates the app event router only after the host call succeeds, so renderer routing state does not lead the native host.

## What changed during verification

- The host method adapter originally accepted an empty `windowId` after JSON deserialization. The focused host test caught it, and the shared window-id decoder now rejects `windowId: ""` before invoking the handler.
- The public test harness had create/close-only fakes. Adding lifecycle methods to `HostWindowClient` forced those adapters to implement `show`, `hide`, and `focus`, which keeps downstream tests aligned with the public contract.
- A draft `Window.events()` surface was removed before commit because the host does not yet emit a close-safe lifecycle event contract.

## Architecture-debt sweep

- No new Effect wrapper or custom DSL was added. The public surface still uses canonical RPC, Schema, Layer, and resource registry contracts.
- Existing debt remains: public `Window.close` still maps to host `Window.destroy`, host-originated lifecycle events are not exposed, and Tao does not expose a portable blur primitive. Issue #1342 stays open for those lifecycle gaps rather than being closed by this partial implementation.
