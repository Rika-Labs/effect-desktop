# Add Persistent Scoped Access Grants

Issue: #1382

## What Changed

Added a `ScopedAccessGrant` native surface with Schema contracts, Layer-first service wiring, bridge client helpers, memory and unsupported clients, public exports, host-protocol payloads, Rust host routing, reference docs, tests, and API snapshots.

## Safety Boundary

The Rust host adapter is fail-closed. It decodes and validates scoped access grant payloads, then returns typed `Unsupported` for mutating operations until an OS adapter can revalidate real persistent grants. The TypeScript service rejects `resolve` responses with `revalidated: false` so restart recovery cannot silently become access.

## Verification

- `bun test packages/native/src/scoped-access-grant.test.ts packages/native/src/index.test.ts`
- `bun run typecheck`
- `bun run check`
- `bun packages/cli/src/bin.ts check --api`
- `cargo fmt --check`
- `cargo check -p host-protocol -p host`
- `cargo clippy -p host-protocol -p host --all-targets -- -D warnings`
- `cargo test -p host scoped_access_grant -- --nocapture`
- `git diff --check`

## Architecture-Debt Sweep

Touched area: `packages/native` native surface pattern, host protocol payloads, and Rust host method adapters.

No removable Effect wrapper debt found in the touched area. The new surface follows the existing NativeSurface/RpcGroup boundary pattern and uses direct Effect primitives (`Context.Service`, `Layer`, `Ref`, `PubSub`, `Stream`) rather than adding a custom DSL over Effect. `ScopedAccessGrant` is a durable desktop-specific boundary because it owns native/web protocol shape, permission enforcement, audit emission, and host revalidation policy.
