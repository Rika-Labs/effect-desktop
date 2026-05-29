# Crash Reporter Host Boundary

Issue #1332 still requires native crash capture, artifact persistence, symbol handling, consent-gated upload, and local report inspection. The safe incremental step was to add the Rust host boundary without changing capability truth.

The host protocol now declares the current `CrashReporter.*` methods and wire payloads, and the Rust host dispatch registry routes those methods. Each route decodes and validates the request first, then returns typed `Unsupported` with `host-adapter-unimplemented`. The parity matrix therefore reports CrashReporter as `unsupported` and `routed`, which proves the bridge shape without pretending native crash reporting exists.

The important guardrail is that breadcrumbs are validated before the unsupported response. Invalid categories and unexpected `flush` payloads fail as `InvalidArgument`; valid requests fail closed as `Unsupported`. That keeps the future host adapter constrained to the current Schema contract and avoids a successful no-op crash reporter.

Architecture-debt sweep: no wrapper removed. The TypeScript CrashReporter service and memory client still own useful contract and test-layer behavior, but they do not capture native crashes. Remaining debt is the real host reporter: crash artifacts, symbol boundaries, upload consent, diagnostics inspection, and end-to-end host coverage.
