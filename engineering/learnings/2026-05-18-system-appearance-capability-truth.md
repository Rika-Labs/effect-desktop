---
title: SystemAppearance capability truth
date: 2026-05-18
issue: 1334
---

# SystemAppearance capability truth

## Context

#1334 requires host-backed appearance snapshots and appearance change events so
UI adapters can respond without platform guesses. The current TypeScript surface
defines Schema contracts for appearance, accent color, reduced motion, reduced
transparency, support checks, and an appearance-changed event, but the Rust host
has no `SystemAppearance.*` route or event source.

## What changed

- Marked all `SystemAppearance.*` RPC methods unsupported on macOS, Windows, and
  Linux while the Rust host adapter is absent.
- Regenerated the native parity matrix so support metadata matches the missing
  host dispatch methods.
- Corrected SystemAppearance reference docs and React hook docs so they no
  longer describe the old `theme`/`isDark` contract or imply native OS event
  delivery exists.

## Verification

- `bun scripts/generate-native-parity-matrix.ts`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'SystemAppearance|NativeCapabilities|NativeParityMatrix'`
- `git diff --check`

## Architecture-debt sweep

Touched area: SystemAppearance TypeScript surface, event schemas, native
capability metadata, generated parity matrix, React hook references, Rust host
protocol/router search results, and native reference docs.

Debt found: docs and TypeScript had drifted, and the appearance change event does
not yet carry the same full snapshot shape as the initial state methods. The
future implementation should normalize the public event contract and back it
with host-owned platform adapters rather than adding another theme helper.

No wrapper was removed in this patch because the TypeScript surface is the public
contract and the issue remains open for the real host adapter. The corrective
change prevents the missing adapter from being advertised as supported.
