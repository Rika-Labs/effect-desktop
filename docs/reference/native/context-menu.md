---
title: ContextMenu (native)
description: Context menu display and command binding.
kind: reference
audience: app-developers
effect_version: 4
---

# `ContextMenu`

Context menu support. Methods are reserved for Phase 6+; the contract and types are present today.

## Errors

- `ContextMenuError`
- `ContextMenuCommandBindingError`

## Status

The `ContextMenuRpcs` group is declared and `WindowSupportedRpcs` filters it appropriately. Production methods land in a later phase.

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/context-menu.ts`](../../../packages/native/src/context-menu.ts)
