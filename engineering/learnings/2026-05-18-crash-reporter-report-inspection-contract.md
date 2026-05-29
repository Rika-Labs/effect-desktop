# Crash Reporter Report Inspection Contract

## Context

#1332 requires local crash artifacts to remain inspectable when submission is disabled. The current CrashReporter surface had `start`, `recordBreadcrumb`, and `flush`, but no public inspection call for local reports.

## Change

Added `CrashReporter.getReports` as a Schema-typed public method and host-protocol route. The memory client returns an empty report list for tests. The Rust host route decodes the void request and fails closed with typed `Unsupported` until a durable native crash artifact store exists.

## Verification

- `cargo fmt --check`
- `cargo test -p host-protocol crash_reporter --lib`
- `cargo test -p host crash_reporter --bin host`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun desktop check --api --write`

## Architecture-Debt Sweep

No wrapper removed. The new method is part of the narrow CrashReporter Effect service boundary, not a parallel abstraction over Effect. Remaining #1332 debt is still the host-owned crash artifact path: native crash capture, durable storage, retention, consent-gated upload, symbol handling, diagnostics integration, and host-backed success/denial/unsupported/failure tests.
