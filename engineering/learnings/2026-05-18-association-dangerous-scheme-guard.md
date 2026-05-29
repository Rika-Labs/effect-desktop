---
title: Association dangerous scheme guard
date: 2026-05-18
---

# Association dangerous scheme guard

Protocol registration and OS association inputs are handler boundaries. A
scheme that is dangerous as a navigable URL should not be accepted as a custom
handler scheme, because that creates inconsistent policy between open-intent
validation and registration validation.

This slice adds `vbscript` to the shared TypeScript custom-scheme deny-list and
to the Rust `Protocol` and `Association` host validators. The public wire shape
does not change; invalid schemes now fail before transport in TypeScript and
before host work in Rust.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host association --bin host`
- `cargo test -p host protocol_methods_reject_reserved_schemes_and_unsafe_paths --bin host`
- `bun test packages/native/src/index.test.ts -t 'Protocol bridge client validates custom schemes and path boundaries|Association bridge client rejects invalid schemes and file extensions before transport'`
- `bun test packages/native/src/index.test.ts packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts -t 'Protocol|Association|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. `Protocol` owns in-app WebView
custom protocol serving policy; `Association` owns the OS association boundary.
The touched abstractions carry durable desktop policy and are not thin Effect
wrappers. Remaining #1338 debt is still the real native association adapter:
macOS, Windows, and Linux state queries/mutations, host-originated events,
permissions/audit around OS state changes, and host-backed platform tests.
