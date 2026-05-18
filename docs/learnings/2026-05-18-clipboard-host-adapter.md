# Clipboard Host Adapter

Issue #1323 made the Clipboard native surface honest at the host boundary.

The important constraint was not pretending that OS clipboard access exists before a real backend is wired. The TypeScript service already exposed Clipboard APIs, but the Rust host did not route those methods. The fix adds Schema-typed text, HTML, image, clear, and support contracts through Effect RPC and the host protocol, then routes every method to a Rust adapter that validates payloads and returns typed `Unsupported` for real clipboard operations.

What changed:

- Added HTML and explicit `clear` / `selection` Clipboard capabilities to the public contract.
- Routed all Clipboard host methods through the Rust dispatch registry.
- Added Rust protocol payloads and host tests for canonical serialization, unknown fields, validation, typed unsupported failures, and support reporting.
- Updated the test package Clipboard layer so text and HTML round trip through the same public service shape as production.
- Regenerated the native parity matrix and API snapshots, and documented the current unsupported host backend.

Architecture-debt sweep: no removable `BridgeRpc`-style wrapper or parallel Effect abstraction was found in the touched Clipboard area. `ClipboardSurface` still uses the shared `NativeSurface` helper because that module owns durable permission metadata, bridge-client construction, host runtime wiring, and native parity docs. The new Rust clipboard adapter is intentionally a host boundary adapter; it does not mirror Effect APIs or add a custom DSL.
