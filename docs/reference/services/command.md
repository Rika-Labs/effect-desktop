---
title: Command
description: Logical app actions bound to menus, shortcuts, devtools, or app UI.
kind: reference
audience: app-developers
effect_version: 4
---

# `Command`

A `Command` is a logical action — a name, a handler, optional metadata — that menus, global shortcuts, context menus, devtools, or UI can invoke. The `CommandRegistry` keeps the list; it does not duplicate command implementation per binding.

## Import

```ts
import {
  CommandRegistry,
  Command,
  type CommandApi,
  type CommandSnapshot,
  type CommandInvocation,
  type CommandRegistrationError,
  CommandError
} from "@effect-desktop/core"
```

## API

| Method               | Signature                                                       |
| -------------------- | --------------------------------------------------------------- |
| `register`           | `({ id, name, run }) => Effect<void, CommandRegistrationError>` |
| `unregister`         | `(id) => Effect<void>`                                          |
| `invoke`             | `(id, args?) => Effect<unknown, CommandError>`                  |
| `list`               | `() => Effect<CommandSnapshot[]>`                               |
| `observeInvocations` | `() => Stream<CommandInvocation>`                               |

## Errors

- `CommandError.NotFound`, `CommandError.InvalidArgument`, `CommandError.HandlerFailed`.

## Why a registry

So `Menu.setMenu`, `GlobalShortcut.register`, and `ContextMenu` all bind by **command id** instead of duplicating the handler. Updating the command updates every binding.

## Devtools

`CommandsDevtools` and `CommandsDevtoolsLive` (from `@effect-desktop/devtools`) render the registry and observe invocations live.

## Related

- Reference: [`Menu`](../native/menu.md), [`GlobalShortcut`](../native/global-shortcut.md), [`ContextMenu`](../native/context-menu.md)
- Source: [`packages/core/src/runtime/commands.ts`](../../../packages/core/src/runtime/commands.ts)
