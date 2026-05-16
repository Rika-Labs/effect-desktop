---
title: Commands
description: Logical app actions bound to menus, shortcuts, and devtools.
kind: reference
audience: app-developers
effect_version: 4
---

# Commands

> Full reference: [`reference/services/command.md`](reference/services/command.md).

Commands are logical actions that can be bound to menus, global shortcuts, context menus, devtools, or app UI. The `CommandRegistry` keeps the list; bindings reference command **ids**, not implementations.

## Public surface

`@effect-desktop/core` exports `CommandRegistry`, command snapshot types, invocation records, registration errors, and observation streams.

`@effect-desktop/devtools` exports `CommandsDevtools` and `CommandsDevtoolsLive` for listing commands and observing invocations.

## Verify Command Exports

```ts run
import { CommandRegistry } from "../packages/core/src/index.js"
import { CommandsDevtools } from "../packages/devtools/src/index.js"

if (CommandRegistry === undefined || CommandsDevtools === undefined) {
  throw new Error("CommandRegistry or CommandsDevtools is unavailable")
}
```

## Rule

Menus and shortcuts invoke command **ids**. They do not duplicate command implementation per binding.

## Where to go next

- [`Command` reference](reference/services/command.md)
- [`Menu`](reference/native/menu.md), [`GlobalShortcut`](reference/native/global-shortcut.md), [`ContextMenu`](reference/native/context-menu.md)
