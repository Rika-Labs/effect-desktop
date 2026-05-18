# Updater Host Boundary

Issue #1331 still requires real signed update verification, artifact staging, install, and restart handoff. The safe incremental step was to add the Rust host boundary without changing capability truth.

The host protocol now declares the current `Updater.*` methods and wire payloads, and the Rust host dispatch registry routes those methods. Each routed method decodes and validates the request first, then returns typed `Unsupported` with `host-adapter-unimplemented`. The parity matrix therefore reports Updater as `unsupported` and `routed`, which is more useful than `missing` without pretending update security exists.

The important guardrail is that validation happens before the unsupported response. Malformed versions and unexpected void payloads fail as `InvalidArgument`, while valid requests fail closed as `Unsupported`. That preserves the host contract shape for future implementation and avoids a successful no-op updater.

Architecture-debt sweep: no wrapper removed. The Updater TypeScript surface remains the public Effect boundary, and the new Rust adapter is a small protocol endpoint rather than a custom abstraction over Effect. Remaining debt is the real native updater: signed manifest verification, artifact integrity evidence, install/restart coordination, lifecycle events, and diagnostics evidence for failure analysis.
