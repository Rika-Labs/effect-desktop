---
title: Notification (native)
description: Show and close host-backed system notifications.
kind: reference
audience: app-developers
effect_version: 4
---

# `Notification`

Host-backed system notifications with typed permission, support, click, and action surfaces.

## Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| Linux | Supported when a notification server is reachable | Uses the desktop notification portal over D-Bus. `isSupported` probes the notification server; `show`, `close`, permission status, click events, and action events are wired through the Rust host. |
| macOS | Unsupported | Returns `Unsupported` with reason `host-notification-unavailable`. |
| Windows | Unsupported | Returns `Unsupported` with reason `host-notification-unavailable`. |

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `show` | `{ title, body, actions?, ownerWindow? }` | `NotificationHandle` |
| `close` | `{ notification }` | `void` |
| `isSupported` | `void` | `{ supported, reason? }` |
| `requestPermission` | `void` | `{ state }` |
| `getPermissionStatus` | `void` | `{ state }` |

`title`, `body`, action ids, and action labels must be printable non-empty strings. Malformed input is rejected before native transport.

On Linux, `requestPermission` and `getPermissionStatus` do not show an OS prompt. They probe the notification server and return `granted` when the server is reachable; otherwise they fail with `Unsupported`.

## Events

| Event | Payload |
| --- | --- |
| `Notification.Click` | `{ notification, ownerWindowId? }` |
| `Notification.Action` | `{ notification, actionId, ownerWindowId? }` |

## Lifecycle

`show` registers the returned notification handle with the `ResourceRegistry`. Closing the returned owner scope, renderer disconnect, or runtime restart closes the native notification. Explicit `close` disposes the registry entry so scope finalizers do not double-close. Native click, action, and close responses remove terminal host resources so stale handles fail closed.

## Errors

Expected failures use host protocol tagged errors:

- `InvalidArgument` for malformed text, actions, or stale handles.
- `PermissionDenied` when the declared `Notification` native invocation permission is denied before host work starts.
- `Unsupported` with reason `host-notification-unavailable` on platforms without the full host-backed contract.
- `HostUnavailable` or `Internal` when the native host or desktop notification server fails.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/notification.ts`](../../../packages/native/src/notification.ts)
