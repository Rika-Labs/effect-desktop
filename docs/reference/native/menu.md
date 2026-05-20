---
title: Menu (native)
description: App and window menus with typed command-binding contracts.
kind: reference
audience: app-developers
effect_version: 4
---

# `Menu`

App and window menus. The Rust host routes application/window menu installation, menu clearing, and the capability query. Menu items can bind to command ids registered with `CommandRegistry` through the TypeScript `Menu` service when a substitutable client provides activation events, but `bindCommand` is not a callable native RPC and real native menu activation events are not wired yet.

## Import

```ts
import { Desktop } from "@effect-desktop/core"
import { Menu, MenuError, MenuRpcs, Native } from "@effect-desktop/native"
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

## Capability facts (non-callable)

`bindCommand` is not a callable native RPC. It is advertised in the native capability manifest as a capability fact with `support.status: "unsupported"` and reason `host-adapter-unimplemented`. The `Menu` service still exposes `bindCommand`, but it is orchestrated entirely in TypeScript through `CommandRegistry` and substitutable client activation events — it does not invoke a host route. `Menu.Activated` likewise has no native host adapter yet.

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
