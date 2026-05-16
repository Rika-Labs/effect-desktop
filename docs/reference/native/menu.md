---
title: Menu (native)
description: App and window menus.
kind: reference
audience: app-developers
effect_version: 4
---

# `Menu`

App and window menus. Menu items can bind to command ids registered with `CommandRegistry`.

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
| `clear`              | `{ scope?, window? }`   | `void`                   |
| `bindCommand`        | `{ itemId, commandId }` | `void`                   |
| `capability`         | `{ name, platform? }`   | `{ supported: boolean }` |

`MenuTemplate` — array of items with `{ label, accelerator?, command?, submenu?, type? }`.

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
