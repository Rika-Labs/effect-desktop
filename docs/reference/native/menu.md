---
title: Menu (native)
description: App and window menu bars.
kind: reference
audience: app-developers
effect_version: 4
---

# `Menu`

App-level menu bar (macOS, some Windows). Bind menu items to command ids registered with `CommandRegistry`.

## Methods

| Method    | Payload                      | Success |
| --------- | ---------------------------- | ------- |
| `setMenu` | `{ template: MenuTemplate }` | `void`  |
| `popup`   | `{ template, x?, y? }`       | `void`  |

`MenuTemplate` — array of items with `{ label, accelerator?, command?, submenu?, type? }`.

## Errors

- `MenuError` — generic.
- `MenuCommandBindingError` — command id not found in `CommandRegistry`.

## Capability

`menuCapability(options)` builds the matching `PermissionRegistry` declaration.

## Related

- Reference: [`Command`](../services/command.md), [`ContextMenu`](context-menu.md), [`GlobalShortcut`](global-shortcut.md)
- Source: [`packages/native/src/menu.ts`](../../../packages/native/src/menu.ts)
