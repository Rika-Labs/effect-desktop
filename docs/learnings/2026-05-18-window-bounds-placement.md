# Window Bounds Placement

Issue: #1343

## What changed

- Added `Window.getBounds`, `Window.setBounds`, and `Window.center` through the public Window service, RPC surface, bridge client, host protocol constants, Rust router, and Tao-backed host registry.
- Added `WindowBounds` / `WindowBoundsInput` schemas and host protocol payloads for readback and move/resize operations.
- Updated the native parity matrix, API snapshots, reference docs, and test harness adapters.

## What worked

- Keeping bounds on the existing `Window` service avoided a new shallow `WindowBounds` wrapper while still making placement host-owned.
- The host uses logical coordinates at the public boundary and converts Tao physical position/size through the current display scale factor for readback and centering.
- The existing resource registry freshness check was reused for every bounds operation, so stale and cross-generation handles fail before host dispatch.

## Verification notes

- The bridge client rejects invalid bounds before transport.
- The Rust host router decodes get/set/center payloads and routes them through `WindowMethodHandler`.
- Centering currently uses the current monitor bounds exposed by Tao. The current host display adapter still reports work area equal to monitor bounds, so platform-specific work-area clipping remains incomplete.

## Architecture-debt sweep

- No Effect wrapper/custom DSL was added; the implementation extends the existing Schema/RPC/Layer/resource-registry path.
- No wrapper was removed in this touched area.
- Remaining debt: true OS work-area handling and a richer display-relative placement policy are still incomplete. Issue #1343 stays open until those semantics are implemented and verified across platforms.
