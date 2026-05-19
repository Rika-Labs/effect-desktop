---
title: Window children lookup
date: 2026-05-18
issue: 1347
---

# Window Children Lookup

## What Changed

`Window.getChildren(parent)` now routes through the same Effect-native window RPC surface as the other host-backed lookup methods. The bridge sends `Window.getChildren` with `{ windowId }`; the Rust host reads its parent-to-child registry and returns the same canonical `{ windows: [{ windowId }] }` shape used by `Window.list`; the native runtime resolves those ids back to fresh `WindowHandle` resources before returning them to callers.

## Why

The ownership feature already had creation-time parent tracking and deterministic parent destroy behavior, but callers could only ask a child for its parent. A parent-to-children read closes that observability gap without introducing a new ownership service or a custom bridge DSL.

## Verification

The slice must prove three boundaries:

- Bridge client emits `Window.getChildren` and decodes the child list response.
- Native runtime rejects stale/unknown parent handles before host transport and returns only live registered child handles.
- Rust host returns sorted tracked children and clears child mappings as parent trees are removed.

## Architecture-Debt Sweep

Touched area: Window RPC contracts, bridge host client, native host runtime, Rust host window registry, and window reference docs.

No thin wrapper was added. The new method reuses canonical Effect RPC, Effect Schema, Layer-provided clients, and the existing host protocol envelope. The host wire payload intentionally reuses `WindowListResponse`; that keeps the protocol data shape single-sourced for “list of window ids” instead of adding a parallel `WindowChildrenResponse` struct that would only rename the same contract.

Remaining #1347 work: modal enable/disable, runtime parent mutation, owner lookup, and ownership-specific event semantics.
