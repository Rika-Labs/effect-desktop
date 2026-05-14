---
title: Tray (native)
description: System tray icon and menu.
kind: reference
audience: app-developers
effect_version: 4
---

# `Tray`

System tray icon and menu support.

## Methods

| Method       | Payload                     | Success  |
| ------------ | --------------------------- | -------- |
| `create`     | `{ icon, tooltip?, menu? }` | `{ id }` |
| `destroy`    | `{ id }`                    | `void`   |
| `setBadge`   | `{ id, text }`              | `void`   |
| `setTooltip` | `{ id, tooltip }`           | `void`   |
| `setMenu`    | `{ id, template }`          | `void`   |

## Errors

`TrayError`.

## Related

- Reference: [`Menu`](menu.md)
- Source: [`packages/native/src/tray.ts`](../../../packages/native/src/tray.ts)
