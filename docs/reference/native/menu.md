---
title: Menu (native)
description: App and window menus with typed command-binding contracts.
kind: reference
audience: app-developers
effect_version: 4
---

# `Menu`

App and window menus. Menu items can bind to command ids registered with `CommandRegistry` through the TypeScript service when a substitutable client provides activation events, but the Rust host currently routes only application/window menu installation. Real native menu activation events, `clear`, `capability`, and host-backed `bindCommand` are not wired yet.

## Import

```ts
import { Desktop } from "@effect-desktop/core"
import { Menu, MenuError, MenuRpcs, Native } from "@effect-desktop/native"
```

## Methods

| Method               | Payload                 | Success                  |
| -------------------- | ----------------------- | ------------------------ |
| `setApplicationMenu` | `{ template }`          | `void`                   |
| `setWindowMenu`      | `{ window, template }`  | `void`                   |
| `clear`              | `{ window? }`           | `void`                   |
| `bindCommand`        | `{ itemId, commandId }` | `void`                   |
| `capability`         | `{ name, platform? }`   | `{ supported: boolean }` |

`MenuTemplate` is `{ items }`. Items use `{ type: "item", id, label, commandId?, accelerator? }`; submenus use `{ type: "submenu", id, label, items }`; separators use `{ type: "separator" }`.

`setApplicationMenu` and `setWindowMenu` are routed by the Rust host and report supported capability metadata. `clear`, `bindCommand`, `capability`, and `Menu.Activated` are TypeScript/bridge contracts today and report `host-adapter-unimplemented` in capability metadata until native host routes and activation events exist.

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
`menuCapability(...)` is a platform support helper; it does not grant permission.

## Related

- Reference: [`Command`](../services/command.md), [`ContextMenu`](context-menu.md), [`GlobalShortcut`](global-shortcut.md)
- Source: [`packages/native/src/menu.ts`](../../../packages/native/src/menu.ts)
