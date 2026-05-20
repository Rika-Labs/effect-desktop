# AttachmentIntake Host Adapter

## Context

`AttachmentIntake` had a complete Effect service and Rust routing, but the production host still returned `Unsupported` for every host method. That made memory-client success diverge from the real host path.

## Change

The Rust host now supports the existing payload-provided byte path. It validates policy before staging bytes, stores attachment bytes privately behind an intake handle, returns metadata for `ingest` and `inspect`, rejects expired handles, disposes staged state, emits lifecycle events, and reports `{ supported: true }`.

## Architecture Debt

No wrapper was removed. The touched TypeScript service remains a real boundary for Schema validation, permission checks, audit ordering, lifecycle events, and substitutable clients. The Rust adapter now owns host-side byte staging, handle lifetime, expiry, disposal, and event emission instead of acting as a fail-closed placeholder.

## Verification

- `cargo test -p host attachment_intake --bin host`
- `cargo test -p host-protocol attachment_intake --lib`
- `bun test packages/native/src/attachment-intake.test.ts packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'AttachmentIntake|NativeCapabilities|NativeParityMatrix'`
