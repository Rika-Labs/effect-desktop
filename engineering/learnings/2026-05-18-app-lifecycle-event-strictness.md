---
title: App lifecycle event strictness
date: 2026-05-18
---

# App lifecycle event strictness

The Rust host-protocol App lifecycle event payloads reject unknown fields, but
the TypeScript bridge event decoder was not using strict parse options. That
let renderer-side decoding accept and strip extra event fields, weakening the
boundary compared with the host contract.

This slice makes all App lifecycle event subscriptions decode with strict
excess-property rejection and adds regressions for `onOpenFile`, `onOpenUrl`,
`onBeforeQuit`, and `onSecondInstance`.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host-protocol app_payloads --lib`
- `cargo test -p host app_lifecycle --bin host`
- `cargo test -p host app_payload_requests --bin host`
- `bun test packages/native/src/index.test.ts packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'App lifecycle|App bridge client|AppRpcs|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. The App service remains the
current public lifecycle boundary, and this change aligns its bridge event
decoder with the strict host protocol. Remaining #1335 debt is the real native
adapter: quit/relaunch/focus side effects, platform idempotency rules,
permission/audit enforcement, lifecycle event sources, and host-backed
success/denial/unsupported/failure tests.
