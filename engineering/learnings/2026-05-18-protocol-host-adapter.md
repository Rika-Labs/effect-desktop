---
title: Protocol host adapter completion
date: 2026-05-18
issue: 1330
---

# Protocol Host Adapter Completion

The Protocol surface now crosses the host boundary instead of stopping at `MethodNotFound`. The host protocol owns `Protocol.registerAppProtocol`, `Protocol.serveAsset`, `Protocol.serveRoute`, and `Protocol.deny` constants plus strict serde payloads, and the Rust host router dispatches all four methods through a narrow protocol policy module.

The adapter records scheme, asset-root, route, and deny policy in the native host, and the WebView builder registers those custom schemes for WebViews created after policy registration. Custom protocol requests are resolved by the host against that registry, with deny rules checked before asset reads. It deliberately does not merge this public custom-protocol policy with the fixed internal `app://localhost/` WebView asset protocol; that internal protocol owns packaged app asset serving, CSP nonce rewriting, and trace headers. Keeping it separate avoids exposing arbitrary filesystem paths by default while still making public Protocol calls observable at the host boundary.

The TypeScript bridge keeps rejecting malformed schemes, local roots, URL paths, traversal segments, and control characters before transport. Rust repeats those checks after decode so the native boundary stays correct if a renderer or test bypasses the public client.

## Architecture-Debt Sweep

Touched area inspected: `packages/native/src/protocol.ts`, Protocol contracts/tests, host protocol, Rust host dispatch, fixed `crates/host/src/scheme.rs`, Protocol docs, and generated native parity.

No wrappers were removed. The existing Protocol service is a public Effect service over the host RPC surface, not a shallow wrapper. The fixed `app://localhost/` scheme remains because it owns durable native/web protocol semantics: packaged asset lookup, CSP rewrite policy, and host trace headers. The stale docs were corrected to describe the actual public four-method surface instead of the older deep-link shape.

No follow-up issue is needed from this sweep.

## Verification

- `bun test packages/native/src/index.test.ts -t Protocol`
- `bun test packages/native/src/index.test.ts`
- `bun x tsc --noEmit -p packages/native/tsconfig.json`
- `bun x tsc --noEmit -p packages/test/tsconfig.json`
- `cargo test -p host-protocol protocol_payloads --lib`
- `cargo test -p host protocol`
- `cargo test -p host custom_scheme`
- `cargo test -p host --test startup_smoke`
- `cargo check -p host --all-targets`
- `cargo fmt --check`
- `bun x ultracite fix packages/native/src/protocol.ts packages/native/src/index.test.ts docs/reference/native/protocol.md`
- `bun scripts/generate-native-parity-matrix.ts`
- `bun packages/cli/src/bin.ts check --api --write`
