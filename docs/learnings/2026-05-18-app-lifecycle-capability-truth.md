---
title: App lifecycle capability truth
date: 2026-05-18
issue: 1335
---

# App lifecycle capability truth

## Context

#1335 requires host-backed quit, exit, relaunch, activate, and focus behavior
with platform-specific guarantees. The current TypeScript App surface declares
Schema contracts for lifecycle calls, metadata, open-at-login, protocol
registration, single-instance coordination, and app events, but the Rust host
has no `App.*` routes or event source.

## What changed

- Marked all `App.*` RPC methods unsupported on macOS, Windows, and Linux while
  the Rust host adapter is absent.
- Regenerated the native parity matrix so support metadata matches the missing
  host dispatch methods.
- Corrected the App reference page so it documents the current TypeScript
  contract without claiming runtime host support.

## Verification

- `bun scripts/generate-native-parity-matrix.ts`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'App|NativeCapabilities|NativeParityMatrix'`
- `git diff --check`

## Architecture-debt sweep

Touched area: App TypeScript surface, App contracts, native capability metadata,
generated parity matrix, Rust host protocol/router search results, and native
reference docs.

Debt found: App lifecycle is mixed into the broad `App` service while the host
has no lifecycle owner. The future implementation should settle one host-backed
contract for lifecycle control and events rather than adding a parallel
`AppLifecycle` surface or leaving protocol registration split across unrelated
APIs.

No wrapper was removed in this patch because the TypeScript surface is the public
contract and the issue remains open for the real host adapter. The corrective
change prevents the missing adapter from being advertised as supported.
