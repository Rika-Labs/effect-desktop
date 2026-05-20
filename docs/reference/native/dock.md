---
title: Dock (native)
description: Dock and taskbar-facing application state with explicit platform gaps.
kind: reference
audience: app-developers
effect_version: 4
---

# `Dock`

Dock/taskbar-facing application state. The surface is intentionally explicit about platform gaps: badge count/text, progress, and attention are host-routed, while dock menus and jump lists remain unavailable until platform adapters are implemented.

## Methods

| Method             | Payload                                                          | Success                  |
| ------------------ | ---------------------------------------------------------------- | ------------------------ |
| `setBadgeCount`    | `{ count: number }`                                              | `void`                   |
| `setBadgeText`     | `{ text: string \| null }`                                       | `void`                   |
| `setProgress`      | `{ value: number \| null, options?: { state?: ProgressState } }` | `void`                   |
| `requestAttention` | `{ critical?: boolean }`                                         | `void`                   |
| `isSupported`      | `{ method: DockMethod }`                                         | `{ supported: boolean }` |

## Capability facts (non-callable)

`setMenu` and `setJumpList` are not callable RPCs. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason: host adapter does not implement the method on any platform), but no host adapter can be invoked.

| Capability fact | Intended role                                 |
| --------------- | --------------------------------------------- |
| `setMenu`       | Install a Dock context menu (`MenuTemplate`). |
| `setJumpList`   | Install Windows taskbar jump-list items.      |

## Errors

`DockError`.

## Platform support

- `requestAttention` is supported.
- `setProgress` is supported as application-scoped Dock/taskbar progress. Values are `0..1`; `null` clears progress.
- `setBadgeCount` and `setBadgeText` are partial: macOS is supported; Linux and Windows are not wired in the current host adapter.
- `setMenu` and `setJumpList` are non-callable capability facts. macOS dock menu installation still requires a native delegate bridge, and jump lists require a Windows taskbar adapter; until those land the methods cannot be invoked.

## Related

- Reference: [`Tray`](tray.md), [`Notification`](notification.md)
- Source: [`packages/native/src/dock.ts`](../../../packages/native/src/dock.ts)
