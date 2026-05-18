---
title: Single-instance permission boundary
date: 2026-05-18
---

# Single-instance permission boundary

`App.requestSingleInstanceLock` is a native process-ownership operation, but
its RPC authority was declared as `none`. That meant the method was public and
routed while not appearing in `Native.Permissions.app`, which would bypass the
permission declaration path once a real host lock exists.

This slice changes `App.requestSingleInstanceLock` to use an explicit
`native.invoke` capability and exports it through `Native.Permissions.app` and
`Native.Permissions.all`. Runtime behavior remains fail-closed and unsupported
until the native single-instance adapter exists.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host-protocol app_payloads --lib`
- `cargo test -p host app_payload_requests --bin host`
- `cargo test -p host host_dispatch_registry_covers_host_protocol_methods --bin host`
- `bun test packages/native/src/index.test.ts packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'single-instance|SecondInstance|App|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. The broad `App` boundary still
contains the single-instance declaration, but this slice makes the existing
method permission-visible before native side effects are implemented. Remaining
#1336 debt is the host adapter: process-wide lock ownership, duplicate-process
detection, argv/cwd/activation reason handoff, primary-process event injection,
release/cancel semantics, and host-backed success/denial/unsupported/failure
tests.
