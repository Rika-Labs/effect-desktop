---
title: Path host adapter completion
date: 2026-05-18
issue: 1329
---

# Path Host Adapter Completion

The Path surface now resolves base directories through the Rust host instead of returning `MethodNotFound`. The host protocol owns canonical `Path.*` constants and the shared `CanonicalPathPayload`, and the host router dispatches `appData`, `cache`, `logs`, `temp`, `home`, and `downloads` through one narrow module.

The public contract remains the six existing base-directory methods. The docs were reconciled with that contract by removing stale `documents` and `desktop` entries rather than adding unimplemented convenience APIs from the issue example. Platform resolution is owned in Rust: macOS uses the standard home-relative Library locations, Windows uses known-folder APIs, and Linux uses XDG base directories plus `user-dirs.dirs` for downloads with documented fallbacks. The platform rules are selected behind one fakeable environment seam, so tests can prove the macOS, Windows, and Linux matrix without depending on the machine running the test.

Permission enforcement remains in the Effect host RPC runtime, where `P.nativeInvoke({ primitive: "Path", methods: [...] })` is checked before Path handlers run. The Rust router is the native transport boundary after that permission gate, so it owns payload rejection, platform base-directory resolution, canonical path encoding, and typed host errors.

## Architecture-Debt Sweep

Touched area inspected: `packages/native/src/path.ts`, Path contracts/tests, host protocol, Rust host dispatch, Path docs, and generated native parity.

No wrappers were removed. The existing TypeScript Path service is the public Effect service and host-port boundary; it hides RPC result wrappers by returning strings to application code while keeping `CanonicalPath` at the bridge contract. The issue comment identified contract drift in docs/examples; that debt was paid down by locking the documented method set to the exported API before adding Rust support. No follow-up issue is needed from this sweep.

## Verification

- `bun test packages/native/src/index.test.ts -t Path`
- `cargo test -p host-protocol canonical_path --lib`
- `cargo test -p host path`
- `cargo test -p host --test startup_smoke`
- `cargo check -p host --all-targets`
- `bun test packages/native/src/index.test.ts`
- `bun x tsc --noEmit -p packages/native/tsconfig.json`
- `bun x tsc --noEmit -p packages/test/tsconfig.json`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun packages/cli/src/bin.ts check --api --write`
