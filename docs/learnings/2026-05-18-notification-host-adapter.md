# Notification Host Adapter

Issue: #1326

The Notification surface already had a narrow Effect API, but the host boundary was missing. Completing the issue meant adding the protocol structs, Rust router entries, typed platform support, ResourceRegistry lifecycle cleanup, and focused tests through the same bridge path a renderer uses.

Architecture-debt sweep:

- Inspected the touched Notification service, bridge surface, host protocol, Rust host methods, docs, parity metadata, and tests for adapters, thin wrappers, custom DSLs, and parallel abstractions over Effect.
- Removed no wrapper layers. The `NotificationSurface` shape remains justified because it owns desktop policy: native invocation permission gating, support metadata, typed event streams, and handle lifecycle registration.
- No follow-up issue opened. The Rust notification adapter is a native boundary adapter; unsupported macOS and Windows behavior is explicit and typed rather than hidden behind a synthetic renderer-side implementation.
