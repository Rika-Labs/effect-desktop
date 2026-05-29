# Host Dispatch Registry

Issue #1322 replaced the implicit Rust host route list with an explicit dispatch registry.

The important constraint was preserving existing host behavior while making route ownership auditable. The previous `HostMethodRouter` used a large method switch that mixed inventory, dispatch, and unknown-method fallback. The new `HOST_DISPATCH_ROUTES` table owns the implemented method list, maps each method to a typed dispatcher shape, and keeps `MethodNotFound` as the typed fallback for unregistered methods.

What changed:

- Added a Rust host dispatch registry table for all currently routed host methods.
- Routed host requests through the registry while preserving eventful dispatch, window lifecycle cleanup, local runtime tracking, and typed unknown-method failures.
- Updated the native parity generator to read the Rust registry instead of scraping the router dispatch function.
- Added a registry inventory test proving registered methods are unique and unknown methods are absent.
- Updated docs to describe the registry as the docs/doctor parity source.

Architecture-debt sweep: removed the shallow route inventory hidden inside `HostMethodRouter::dispatch_frames_at`. The remaining router helpers still own durable desktop-specific lifecycle policy for event streams, window cleanup, and local runtime tracking, so they were kept. No `BridgeRpc`-style wrapper or parallel Effect abstraction was added; the existing `NativeHostMethodInventory` Effect service now points at a real host-owned registry source.
