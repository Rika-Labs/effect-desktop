# Add Attachment Intake Service

Issue: #1381

## What Changed

Added an `AttachmentIntake` native surface with Schema contracts, Layer-first service wiring, bridge helpers, memory and unsupported clients, public exports, host-protocol payloads, Rust host routing, reference docs, tests, and API snapshots.

## Safety Boundary

The memory client supports deterministic intake of caller-provided bytes and enforces MIME, item count, per-item size, total size, and lifetime limits before returning metadata. The Rust host adapter is fail-closed for native OS intake sources; it decodes and validates payloads, then returns typed `Unsupported` until drag/drop, paste, picker, clipboard-file, screenshot, and MIME host adapters exist.

## Verification

- `bun test packages/native/src/attachment-intake.test.ts`
- `bun run typecheck`
- `cargo fmt --check`
- `cargo test -p host attachment_intake -- --nocapture`

## Architecture-Debt Sweep

Touched area: `packages/native` native surface pattern, host protocol payloads, and Rust host method adapters.

No removable Effect wrapper debt found in the touched area. The new surface uses direct Effect primitives (`Context.Service`, `Layer`, `Ref`, `PubSub`, `Stream`) and owns durable desktop-specific policy: intake validation, native/web protocol shape, permission enforcement, audit emission, and typed unsupported host behavior.
