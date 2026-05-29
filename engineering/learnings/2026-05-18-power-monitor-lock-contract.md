---
title: PowerMonitor lock event contract
date: 2026-05-18
---

# PowerMonitor lock event contract

The PowerMonitor issue requires lock and unlock observability, but the public
TypeScript surface only exposed suspend, resume, shutdown, and power-source
streams. That made the contract internally inconsistent before any native OS
watcher could be added.

This slice adds `onLockScreen` and `onUnlockScreen` to the Schema contract,
public Effect service, bridge event subscriptions, React `usePower` hook, and
host-protocol support-query payload. The Rust host still reports every
PowerMonitor method unsupported until a real native watcher exists.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host-protocol power_monitor --lib`
- `cargo test -p host power_monitor --bin host`
- `cargo test -p host host_dispatch_registry_covers_host_protocol_methods --bin host`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'PowerMonitor|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. The public PowerMonitor Effect
service is the durable stream boundary; the Rust support route is a narrow
host-protocol adapter. Remaining debt is the native watcher itself: OS event
sources, ordering and replay policy, cancellation cleanup, diagnostics
visibility, permission/audit behavior if privileged hooks are required, and
host-backed success/unsupported/failure tests.
