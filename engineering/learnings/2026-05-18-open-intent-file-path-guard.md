---
title: Open intent file path guard
date: 2026-05-18
---

# Open intent file path guard

Open-file intents are OS entry points. A renderer-facing file intent that
accepts relative paths or dot segments makes routing depend on the current
working directory and can hide traversal-like payloads in what should be a host
absolute path.

This slice tightens `AppOpenFileEvent.path` while preserving the wire shape as a
string. Open-file events now require an absolute platform path, reject control
bytes through `PrintableNonEmptyString`, and reject `.` / `..` path segments
before app code receives the event.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host-protocol app_event_payloads --lib`
- `bun test packages/native/src/index.test.ts -t 'App bridge client accepts safe absolute onOpenFile paths|App bridge client rejects unsafe onOpenFile paths|App bridge client sends typed host envelopes|AppEventRouter'`
- `bun test packages/native/src/index.test.ts packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'App|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. `AppEventRouter` owns durable
routing, buffering, audit, and subscription policy, so it is not shallow wrapper
debt. Remaining #1337 debt is the real native source: cold-start intent capture,
warm-start OS handoff, second-instance forwarding into the same event model,
host event injection, and host-backed success/denial/unsupported/failure tests.
