---
title: Autostart launch argument guard
date: 2026-05-18
---

# Autostart launch argument guard

Autostart launch arguments are persisted into platform startup mechanisms. A
control character in an argument can corrupt a Linux `.desktop` entry, confuse a
Windows command string, or produce behavior that differs from the renderer's
intent.

This slice tightens `Autostart.enable` validation without changing the wire
shape. Launch arguments now must be non-empty and must not contain Unicode
control characters. The TypeScript bridge client rejects invalid args before
transport, and the Rust host route applies the same guard before failing closed
as typed unsupported.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host autostart --bin host`
- `bun test packages/native/src/index.test.ts -t 'Autostart bridge client rejects invalid launch args before transport|Autostart bridge client sends typed host envelopes'`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'Autostart|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. `Autostart` is the durable
OS login-item/autostart boundary and is not a thin Effect wrapper. Remaining
#1340 debt is still the real native adapter: macOS, Windows, and Linux
persistence implementations, host-owned status/events, permission/audit
behavior around startup writes, and host-backed platform tests.
