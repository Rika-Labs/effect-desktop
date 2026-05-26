---
title: Menu (native)
description: App and window menus with typed command-binding contracts.
kind: reference
audience: app-developers
effect_version: 4
---

# `Menu`

App and window menus. The Rust host routes application/window menu installation, menu clearing, the capability query, and macOS menu activation events for items with `commandId`. `Menu.events.Activated` is a callable RPC stream for template items that include a `commandId`; bridge clients keep host wire compatibility by subscribing to `Menu.Activated`. Menu items bind to command ids registered with `CommandRegistry` through the TypeScript `Menu` service, but `bindCommand` is not a callable native RPC.

## Import

```ts
import { Desktop } from "@orika/core"
import { Menu, MenuError, MenuRpcs, Native } from "@orika/native"
```

## Methods

The callable RPCs on this surface are:

| Method               | Payload                | Success                  |
| -------------------- | ---------------------- | ------------------------ |
| `setApplicationMenu` | `{ template }`         | `void`                   |
| `setWindowMenu`      | `{ window, template }` | `void`                   |
| `clear`              | `{ window? }`          | `void`                   |
| `capability`         | `{ name, platform? }`  | `{ supported: boolean }` |

`MenuTemplate` is `{ items }`. Items use `{ type: "item", id, label, commandId?, accelerator? }`; submenus use `{ type: "submenu", id, label, items }`; separators use `{ type: "separator" }`.

`setApplicationMenu`, `setWindowMenu`, and `capability` are routed by the Rust host and report supported capability metadata; `clear` is supported on macOS and reports `partial` (`macos-menu-clear-only`).

## Events

`Menu.events.Activated` emits `{ itemId, commandId, windowId? }` when a command-bound menu item activates. The stream reports `partial` support (`macos-menu-activation-only`): macOS is supported; Windows and Linux remain `unsupported` until their host menu adapters emit equivalent activation events.

## Command Binding

`bindCommand` is a TypeScript service helper, not a host method. It validates the binding, listens for `Menu.events.Activated`, and invokes the matching `CommandRegistry` command in a scoped resource. The native capability manifest does not include `Menu.bindCommand`; use `Menu.capability("command binding")` to ask whether the current host can emit activation events for command-bound menu items.

Native command binding is currently supported by the macOS menu adapter. Windows and Linux report the capability as unsupported until their menu adapters emit equivalent activation events.

Architecture-debt sweep outcome for #1861 and #1927: removed `MenuRpcEvents`, the local `subscribeMenuEvent` helper, the empty `MenuCapabilityFacts` export, the `MenuLive` alias, and the static `menuCapability(...)` helper. The `Menu` service remains because it owns durable command-binding policy over scoped activation listeners.

## Errors

- `MenuError` — generic.
- `MenuCommandBindingError` — command id not found in `CommandRegistry`.

## App composition

```ts
Desktop.make({
  id: "com.acme.menu",
  windows: Desktop.window("main", { title: "Menu" }),
  native: Desktop.native(Native.Menu),
  permissions: Desktop.permissions(...Native.Permissions.menu.all.map(Desktop.permission))
})
```

`Native.Menu` registers the menu surface. `Native.Permissions.menu.all` grants menu authority.
Use `Menu.capability(...)` when runtime code needs host capability truth; it does not grant permission.

## Related

- Reference: [`Command`](../services/command.md), [`ContextMenu`](context-menu.md), [`GlobalShortcut`](global-shortcut.md)
- Source: [`packages/native/src/menu.ts`](../../../packages/native/src/menu.ts)
