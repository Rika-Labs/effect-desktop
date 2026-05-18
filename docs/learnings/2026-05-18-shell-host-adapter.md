---
title: Shell host adapter completion
date: 2026-05-18
issue: 1328
---

# Shell Host Adapter Completion

The Shell surface now has a Rust host adapter instead of stopping at the TypeScript bridge. The host protocol owns canonical `Shell.*` constants and payload structs, and the host router dispatches `openExternal`, `openPath`, `showItemInFolder`, and `trashItem` through one narrow module.

Dangerous handoffs are denied twice: the TypeScript bridge rejects malformed URLs and paths before transport, and the Rust host repeats the same checks before spawning any platform tool. External URLs allow `http`, `https`, `mailto`, and `tel` by default; custom schemes require explicit per-call policy; `file:` and `javascript:` stay reserved. Path operations reject empty paths, control bytes, shell metacharacters, option-prefixed paths, and `..` traversal segments across both `/` and `\` separators. Executable-looking paths require `allowExecutable: true`; the Rust host also checks existing Unix executable permission bits.

Permission enforcement remains in the Effect host RPC runtime, where `P.nativeInvoke({ primitive: "Shell", methods: [...] })` is checked before Shell handlers run. The Rust router is the native transport boundary after that permission gate, so it owns payload decoding, policy revalidation, platform command planning, and typed OS error mapping rather than app permission decisions.

## Architecture-Debt Sweep

Touched area inspected: `packages/native/src/shell.ts`, Shell contracts/tests, host protocol payloads, Rust host dispatch, native parity generation, and Shell docs.

No wrappers were removed. The existing TypeScript Shell service is not a shallow Effect wrapper: it owns durable desktop policy at the renderer-to-host boundary and capability metadata for `P.nativeInvoke`. The debt found in the issue comment, policy living only client-side, was paid down by adding matching Rust boundary validation. No follow-up issue is needed from this sweep.

## Verification

- `bun test packages/native/src/index.test.ts -t Shell`
- `bun test packages/native/src/index.test.ts`
- `bun x tsc --noEmit -p packages/native/tsconfig.json`
- `bun x tsc --noEmit -p packages/test/tsconfig.json`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun packages/cli/src/bin.ts check --api --write`
- `cargo fmt --check`
- `cargo check -p host --all-targets`
- `cargo test -p host-protocol shell --lib`
- `cargo test -p host shell`
- `cargo test -p host --test startup_smoke`
