# Add Focused Application Context Broker

Issue: #1379

## What Changed

Added a `FocusedApplicationContext` native surface with Schema contracts, Layer-first service wiring, bridge helpers, memory and unsupported clients, watch cleanup, public exports, host-protocol payloads, Rust host routing, reference docs, tests, and API snapshots.

## Safety Boundary

Snapshots expose focused app, window, process, package, and display metadata only. Permission checks run before the client or host path can observe the request, host failures are audited, watches can be registered with the resource registry for scope cleanup, and the Rust host adapter is fail-closed until platform focused-surface adapters exist.

## Verification

- `bun test packages/native/src/focused-application-context.test.ts`
- `cargo test -p host focused_application_context -- --nocapture`

## Architecture-Debt Sweep

Touched area: `packages/native` native surface pattern, host protocol payloads, and Rust host method adapters.

No removable Effect wrapper debt found in the touched area. The new surface uses direct Effect primitives (`Context.Service`, `Layer`, `PubSub`, `Stream`) and owns durable desktop-specific policy: focused metadata shape, permission enforcement, audit emission, resource cleanup, event publication, native/web protocol shape, and typed unsupported host behavior.
