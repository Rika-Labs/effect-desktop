---
title: Dock (native)
description: macOS-oriented dock behavior with Linux fallbacks.
kind: reference
audience: app-developers
effect_version: 4
---

# `Dock`

macOS-oriented dock integration. Linux gets a stub via `makeLinuxDockClient()` so the same interface compiles cross-platform.

## Methods

| Method     | Payload                                   | Success |
| ---------- | ----------------------------------------- | ------- |
| `show`     | —                                         | `void`  |
| `hide`     | —                                         | `void`  |
| `bounce`   | `{ type: "critical" \| "informational" }` | `void`  |
| `setBadge` | `{ text }`                                | `void`  |

## Errors

`DockError`.

## Platform support

- macOS: full support.
- Linux: returns `Unsupported` for non-trivial methods.
- Windows: not supported (use `Tray`).

## Related

- Reference: [`Tray`](tray.md), [`Notification`](notification.md)
- Source: [`packages/native/src/dock.ts`](../../../packages/native/src/dock.ts)
