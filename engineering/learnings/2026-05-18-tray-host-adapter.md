# Tray Host Adapter

Issue #1325 made Tray a host-backed native surface.

The main constraint was that tray icons must be created and mutated from the native UI event-loop thread. The implementation routes Tray work through the existing `WindowMethodPort` command queue, so the Rust host keeps a single owner for native window, dock, menu, and tray lifecycle work.

What changed:

- Added Tray host-protocol constants, payloads, resource handles, support payloads, activation events, and serde tests.
- Routed `Tray.create`, `Tray.setIcon`, `Tray.setTooltip`, `Tray.setTitle`, `Tray.setMenu`, `Tray.destroy`, and `Tray.isSupported` through the Rust dispatch registry.
- Added a macOS/Windows `tray-icon` adapter with generation-stamped handles, owner-scope validation, explicit destroy, and activation event forwarding.
- Kept Linux explicitly unsupported because `tray-icon` requires GTK/appindicator system dependencies that this host does not ship yet.
- Added `Tray.setTitle` to the public Effect service. It is supported on macOS and explicitly unsupported on Windows/Linux.
- Updated docs, API snapshots, native parity artifacts, and focused Tray tests.

Architecture-debt sweep: no removable `BridgeRpc`-style wrapper or parallel Effect abstraction was found in the touched Tray TypeScript area. `TraySurface` still uses `NativeSurface` because that helper owns durable permission metadata, bridge-client construction, host runtime wiring, and parity documentation. The Rust changes did not introduce a new DSL; the only new adapter boundary is the direct native tray adapter behind the existing event-loop command queue.
