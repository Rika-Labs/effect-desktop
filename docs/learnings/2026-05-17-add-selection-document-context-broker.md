# Add Selection And Document Context Broker

Issue: #1380

## What Changed

Added a `SelectionContext` native surface with Schema contracts, Layer-first service wiring, bridge helpers, memory and unsupported clients, focus-watch cleanup, public exports, host-protocol payloads, Rust host routing, reference docs, tests, and API snapshots.

## Safety Boundary

The service separates metadata access from content access and audits both modes. Permission checks run before the client or host path can observe the request, host failures are audited, focus watches can be registered with the resource registry for scope cleanup, and the Rust host adapter is fail-closed for native OS selection/document APIs until platform adapters exist.

## Verification

- `bun test packages/native/src/selection-context.test.ts`
- `cargo test -p host selection_context -- --nocapture`

## Architecture-Debt Sweep

Touched area: `packages/native` native surface pattern, host protocol payloads, and Rust host method adapters.

No removable Effect wrapper debt found in the touched area. The new surface uses direct Effect primitives (`Context.Service`, `Layer`, `PubSub`, `Stream`) and owns durable desktop-specific policy: metadata/content separation, permission enforcement, audit emission, resource cleanup, event publication, native/web protocol shape, and typed unsupported host behavior.
