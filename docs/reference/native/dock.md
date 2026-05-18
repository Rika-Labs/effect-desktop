---
title: Dock (native)
description: Dock and taskbar-facing application state with explicit platform gaps.
kind: reference
audience: app-developers
effect_version: 4
---

# `Dock`

Dock/taskbar-facing application state. The surface is intentionally explicit about platform gaps: badge count/text and attention are host-routed, while progress, dock menus, and jump lists remain unavailable until platform adapters are implemented.

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
- `setBadgeCount` and `setBadgeText` are partial: macOS is supported; Linux and Windows are not wired in the current host adapter.
- `setProgress` is unsupported: macOS has no taskbar-progress equivalent, and Linux/Windows progress adapters are not wired yet.
- `setMenu` is currently marked unsupported by the public capability metadata. The Rust host validates and routes the call, but macOS dock menu installation still requires a native delegate bridge.
- `setJumpList` is unsupported and has no Rust host route yet.

## Related

- Reference: [`Tray`](tray.md), [`Notification`](notification.md)
- Source: [`packages/native/src/dock.ts`](../../../packages/native/src/dock.ts)
