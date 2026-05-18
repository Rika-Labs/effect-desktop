---
title: ContextMenu (native)
description: Context menu display and command binding.
kind: reference
audience: app-developers
effect_version: 4
---

# `ContextMenu`

Context menu support. The TypeScript service, bridge contracts, and command-binding lifecycle are present today, but the Rust host does not yet route context-menu display, template construction, bind registration, or activation events.

## Methods

| Method              | Payload                    | Success |
| ------------------- | -------------------------- | ------- |
| `show`              | `{ window, template, position }` | `void`  |
| `buildFromTemplate` | `{ template }`             | `void`  |
| `bindCommand`       | `{ itemId, commandId }`    | `void`  |

`ContextMenu.Activated` is the bridge event contract used by the TypeScript command-binding service. Completing native parity requires a Rust host event source for real context-menu item activation.

## Errors

- `ContextMenuError`
- `ContextMenuCommandBindingError`

## Status

The public contracts validate input before transport and tests cover substitutable clients, bridge decoding, listener cleanup, and TypeScript-level command invocation. The real native host path remains missing, so this surface is not complete native parity yet.

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/context-menu.ts`](../../../packages/native/src/context-menu.ts)
