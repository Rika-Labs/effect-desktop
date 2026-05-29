---
title: Commands
description: Logical app actions bound to menus, shortcuts, and devtools.
kind: reference
audience: app-developers
effect_version: 4
---

# Commands

> Full reference: [`reference/services/command.md`](reference/services/command.md).

Commands are Effect `RpcGroup` endpoints, registered with the `CommandRegistry` so menus, shortcut contracts, context menus, devtools, and app UI can invoke them by **id** without duplicating handler implementations.

Current host status: the registry and its TypeScript binding lifecycle are available with substitutable clients. The Rust host currently routes app/window menu installation, but host-backed menu/context-menu activation events and global-shortcut registration/pressed events remain unimplemented.

## Public surface

`@orika/core` exports `CommandRegistry` (the `Context.Service`), `DesktopCommands.layer` for scoped group registration, `CommandSnapshot`, `CommandInvocationRecord`, the `CommandRegistry*Error` tagged errors (plus `PermissionDenied`), and `observeInvocations`.

`@orika/devtools` exports `CommandsDevtools` and `CommandsDevtoolsLive` for listing commands and observing invocations.

## Verify command exports

```ts run
import { CommandRegistry, DesktopCommands } from "../packages/core/src/index.js"
import { CommandsDevtools } from "../packages/devtools/src/index.js"

if (
  CommandRegistry === undefined ||
  DesktopCommands === undefined ||
  CommandsDevtools === undefined
) {
  throw new Error("CommandRegistry, DesktopCommands, or CommandsDevtools is unavailable")
}
```

## Rule

Menus and shortcut bindings invoke command **ids**. They do not duplicate command implementation per binding. Each command id is the RPC tag; the permission interceptor checks the RPC's `RpcCapability` before the handler runs.

## Where to go next

- [`Command` reference](reference/services/command.md)
- [`Menu`](reference/native/menu.md), [`GlobalShortcut`](reference/native/global-shortcut.md), [`ContextMenu`](reference/native/context-menu.md)
