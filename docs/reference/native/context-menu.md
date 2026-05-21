---
title: ContextMenu (native)
description: Context menu display and command binding.
kind: reference
audience: app-developers
effect_version: 4
---

# `ContextMenu`

Context menu support. `ContextMenu.show` is a callable native RPC that displays a menu for an open window using the host menu backend. `ContextMenu.Activated` events are emitted for template items that include a `commandId`; the event payload carries the original `itemId`, `commandId`, and `windowId`. `buildFromTemplate` and `bindCommand` remain TypeScript service helpers, not native host methods.

## Methods

| Method | Description                                                          |
| ------ | -------------------------------------------------------------------- |
| `show` | Display `{ template }` at `{ position }` in the target `{ window }`. |

`ContextMenu.buildFromTemplate` is callable on the TypeScript service as validation/preflight. `ContextMenu.bindCommand` registers a scoped command listener against `ContextMenu.Activated`. Neither helper invokes the native host.

## Capability facts (non-callable)

This surface has no non-callable capability facts. `show` is host-routed and declares the `native.invoke` authority for `ContextMenu.show`.

## Errors

- `ContextMenuError`
- `ContextMenuCommandBindingError`

## Status

The public contracts validate input before transport. Tests cover substitutable clients, bridge decoding, listener cleanup, TypeScript-level command invocation, host payload validation, host routing, and the context-menu activation event payload.

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/context-menu.ts`](../../../packages/native/src/context-menu.ts)
