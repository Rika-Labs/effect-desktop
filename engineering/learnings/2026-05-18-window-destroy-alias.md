---
title: Window destroy lifecycle alias
date: 2026-05-18
---

# Window destroy lifecycle alias

The host protocol already names the destructive lifecycle operation
`Window.destroy`, while the public native service only exposed `Window.close`.
That made the current behavior harder to read: `close` was not an OS close
request or veto-capable close lifecycle, it destroyed the host window and closed
the resource scope.

This slice adds explicit public `Window.destroy` support backed by the existing
host-routed destroy path. `Window.close` remains as a compatibility name and
continues to route to the same behavior.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun test packages/native/src/parity-matrix.test.ts -t 'native parity docs and CLI artifact are generated from current source'`
- `bun test packages/native/src/window.test.ts packages/native/src/index.test.ts packages/native/src/parity-matrix.test.ts -t 'Window'`
- `bun test packages/native/src/desktop-http-api.test.ts packages/native/src/window-persistence.test.ts packages/test/src/index.test.ts`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'NativeCapabilities|NativeParityMatrix'`
- `bun test packages/react/src/index.test.ts -t 'window|Window|DesktopProvider|createUnavailableDesktopClient'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/react/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/test/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. This removes naming ambiguity
without adding a custom lifecycle abstraction: `Window.destroy` is the durable
host operation, and `Window.close` is compatibility. Remaining #1342 debt is
portable blur, show/hide visibility events, and a separate OS close-request
veto/confirm lifecycle distinct from destroy.
