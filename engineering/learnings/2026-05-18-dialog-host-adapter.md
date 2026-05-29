# Dialog Host Adapter

Issue #1324 made Dialog a real host-backed native surface.

The important constraint was modeling user cancellation as result data. File and directory open already use an empty `paths` array for cancellation, but save dialogs previously required a non-empty path. The fix makes `DialogSaveResult.path` optional, so save cancellation can cross the bridge as `{}` without being encoded as an error or fake path.

What changed:

- Added Dialog host-protocol constants, payloads, results, and serde tests.
- Routed `Dialog.openFile`, `Dialog.openDirectory`, `Dialog.saveFile`, `Dialog.message`, and `Dialog.confirm` through the Rust dispatch registry.
- Added a narrow Rust Dialog adapter backed by `rfd` on macOS/Windows and direct `zenity` process handling on Linux, so Linux cancellation and host failures stay distinguishable. Linux rejects multi-selection until a lossless portal path is wired.
- Added tests for typed selection data, cancellation data, invalid payload rejection before adapter work, permission denial before handlers run, unavailable-platform failure, and host failure propagation.
- Updated docs, API snapshots, and native parity artifacts.

Architecture-debt sweep: no removable `BridgeRpc`-style wrapper or parallel Effect abstraction was found in the touched Dialog area. `DialogSurface` still uses the shared `NativeSurface` helper because it owns durable permission metadata, bridge-client construction, host runtime wiring, and native parity documentation. The new Rust `DialogAdapter` trait is kept because it owns the OS-dialog boundary and lets tests prove cancellation, selection, and validation behavior without opening real UI.
