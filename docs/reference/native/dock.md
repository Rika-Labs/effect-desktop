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
| `setMenu`          | `{ menu: MenuTemplate \| null }`                                 | `void`                   |
| `setJumpList`      | `{ items: DockJumpListItem[] }`                                  | `void`                   |
| `requestAttention` | `{ critical?: boolean }`                                         | `void`                   |
| `isSupported`      | `{ method: DockMethod }`                                         | `{ supported: boolean }` |

## Errors

`DockError`.

## Platform support

- `requestAttention` is supported.
- `setProgress` is supported as application-scoped Dock/taskbar progress. Values are `0..1`; `null` clears progress.
- `setBadgeCount` and `setBadgeText` are partial: macOS is supported; Linux and Windows are not wired in the current host adapter.
- `setMenu` is currently marked unsupported by the public capability metadata. The Rust host validates and routes the call, but macOS dock menu installation still requires a native delegate bridge.
- `setJumpList` is unsupported. The Rust host validates and routes the call, then fails closed until the Windows taskbar adapter exists.

## Related

- Reference: [`Tray`](tray.md), [`Notification`](notification.md)
- Source: [`packages/native/src/dock.ts`](../../../packages/native/src/dock.ts)
