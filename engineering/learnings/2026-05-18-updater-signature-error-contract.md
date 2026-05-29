# Updater Signature Error Contract

## Context

#1331 needs signature verification failure to be a typed terminal updater error. The runtime updater host adapter is still fail-closed, but the shared host protocol did not have a dedicated signature-failure variant for the future Rust verifier to return.

## Change

Added `UpdateSignatureInvalid` to the closed host-protocol error registry, Rust enum, TypeScript Schema union, and shared canonical error fixture. The error carries the artifact identifier and key version, which is enough to diagnose the failed trust decision without embedding signatures, keys, or artifact bytes in the error payload.

## Verification

- `cargo fmt --check`
- `cargo test -p host-protocol --lib`
- `cargo test -p native-updater --lib`
- `bun test packages/bridge/src/index.test.ts packages/bridge/src/protocol.rpc.test.ts`

## Architecture-Debt Sweep

No wrapper removed. The touched area is the shared host protocol, which is the correct boundary for a cross-language terminal updater failure. The remaining #1331 debt is still the missing host-owned updater adapter: manifest fetch, signature verification, artifact download/staging, permission/audit enforcement, install/restart handoff, lifecycle events, and host-backed success/failure tests.
