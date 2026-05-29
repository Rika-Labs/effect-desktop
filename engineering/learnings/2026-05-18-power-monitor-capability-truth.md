---
title: PowerMonitor capability truth
date: 2026-05-18
issue: 1333
---

# PowerMonitor capability truth

## Context

#1333 requires observable OS suspend, resume, lock, unlock, and power-source
changes through a typed stream backed by the native host. The current TypeScript
surface exposes `isSupported` and bridge event subscriptions for suspend,
resume, shutdown, and power-source changes, but the Rust host has no
`PowerMonitor.*` route or event source.

## What changed

- Marked `PowerMonitor.isSupported` unsupported on macOS, Windows, and Linux
  while the Rust host adapter is absent.
- Regenerated the native parity matrix so support metadata matches the missing
  host dispatch method.
- Corrected the PowerMonitor reference page so it no longer documents lock and
  unlock events that the TypeScript contract does not expose.

## Verification

- `bun scripts/generate-native-parity-matrix.ts`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'PowerMonitor|NativeCapabilities|NativeParityMatrix'`
- `git diff --check`

## Architecture-debt sweep

Touched area: PowerMonitor TypeScript surface, event schemas, native capability
metadata, generated parity matrix, React hook references, Rust host
protocol/router search results, and native reference docs.

Debt found: the TypeScript event stream contract, docs, and issue acceptance do
not currently agree on lock/unlock/shutdown semantics, and no native host source
exists. The future implementation should normalize the public event contract and
back it with host-owned platform watchers rather than adding another parallel
power-event abstraction.

No wrapper was removed in this patch because the TypeScript surface is the public
contract and the issue remains open for the real host adapter. The corrective
change prevents the missing adapter from being advertised as supported.
