# Native Boundary Error Normalization

Issue #1321 was resolved by keeping `HostProtocolError` as the executable native boundary vocabulary and adding a narrow classifier for application code that needs stable operational categories.

The key constraint was not to create a second transport error system. Rust host-protocol and the TypeScript bridge already share a closed Schema/serde error registry, so the durable change is `NativeBoundaryErrors`: it classifies host-protocol failures into `denied`, `unsupported`, `missing-host-method`, `invalid-input`, `invalid-output`, or `host-failed` without string parsing.

What changed:

- Added `NativeBoundaryError`, `NativeBoundaryErrors`, and `normalizeNativeBoundaryEffect` in `@orika/native`.
- Added tests proving success, permission denial, unsupported platform, missing host method, host failure, and Schema decode/encode failure.
- Added a native surface invariant that every native RPC surface advertises the shared `HostProtocolError` Schema at the Effect boundary.
- Reused the existing Screen native host permission test to prove protected host calls deny before handlers run.
- Documented the boundary vocabulary in native services docs.

Architecture-debt sweep: no wrapper over Effect RPC was added. The new service owns durable native-boundary policy: grouping the existing host-protocol tags into operator-facing reasons. I found no `BridgeRpc`-style custom DSL in the touched path. The remaining debt is adapter coverage for later parity issues; unsupported or missing host routes remain typed through `Unsupported` and `MethodNotFound` rather than hidden by compatibility shims.
