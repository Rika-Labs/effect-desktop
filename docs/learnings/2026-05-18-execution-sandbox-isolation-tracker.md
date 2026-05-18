# ExecutionSandbox Isolation Tracker

Issue #1399 was resolved by preserving fail-closed production behavior and opening #1406 for true OS-enforced isolation.

The important correction was architectural: a normal child process with cwd, environment, timeout, output caps, and process-group cleanup is not an execution sandbox. It still has ambient same-user filesystem and network authority, so returning `supported: true` would overstate the security boundary.

Verification kept the public and host contracts honest:

- `ExecutionSandbox.create`, `run`, and `destroy` continue to validate payloads, then return typed `Unsupported`.
- `ExecutionSandbox.isSupported` continues to report `host-adapter-unimplemented`.
- The docs now point to #1406 as the explicit production isolation tracker.
- The native test-surface snapshot was updated to include all current `Native.all` surfaces.

Architecture-debt sweep: no Effect wrapper was removed. The touched area contains the `ExecutionSandbox` service, host protocol payloads, and Rust host adapter directly; the remaining debt is not a thin Effect abstraction but the missing OS isolation adapter. Follow-up #1406 records the before/after and the durable semantics that must remain.
