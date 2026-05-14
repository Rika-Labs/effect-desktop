---
title: GlobalShortcut (native)
description: OS-level keyboard shortcuts bound to commands.
kind: reference
audience: app-developers
effect_version: 4
---

# `GlobalShortcut`

OS-level keyboard shortcuts. Binds an accelerator (e.g. `"CommandOrControl+Shift+P"`) to a command id from `CommandRegistry`.

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `register` | `{ accelerator, command, window? }` | `void` |
| `unregister` | `{ accelerator }` | `void` |

## Types

`GlobalShortcutWindowHandle` — optional window scoping for the shortcut.

## Errors

- `GlobalShortcutError`
- `GlobalShortcutCommandBindingError`
- `GlobalShortcutAlreadyRegisteredError`

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/global-shortcut.ts`](../../../packages/native/src/global-shortcut.ts)
