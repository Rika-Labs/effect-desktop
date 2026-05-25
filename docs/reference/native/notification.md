---
title: Notification (native)
description: Show and close host-backed system notifications.
kind: reference
audience: app-developers
effect_version: 4
---

# `Notification`

Host-backed system notifications with typed permission, support, click, and action surfaces.

## Import

```ts
import { Notification, NotificationError, NotificationRpcs, Native } from "@orika/native"
import { NotificationRpcs as RendererNotificationRpcs } from "@orika/native/renderer"
```

Runtime and service code import from `@orika/native`. Browser renderer
manifests import the renderer-safe RPC group from `@orika/native/renderer`.

## Platform Status

| Platform | Status                                            | Notes                                                                                                                                                                                               |
| -------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux    | Supported when a notification server is reachable | Uses the desktop notification portal over D-Bus. `isSupported` probes the notification server; `show`, `close`, permission status, click events, and action events are wired through the Rust host. |
| macOS    | Unsupported                                       | Returns `Unsupported` with reason `host-notification-unavailable`.                                                                                                                                  |
| Windows  | Unsupported                                       | Returns `Unsupported` with reason `host-notification-unavailable`.                                                                                                                                  |

## Methods

| Method                | Payload                                   | Success                  |
| --------------------- | ----------------------------------------- | ------------------------ |
| `show`                | `{ title, body, actions?, ownerWindow? }` | `NotificationHandle`     |
| `close`               | `{ notification }`                        | `void`                   |
| `isSupported`         | `void`                                    | `{ supported, reason? }` |
| `requestPermission`   | `void`                                    | `{ state }`              |
| `getPermissionStatus` | `void`                                    | `{ state }`              |

`title`, `body`, action ids, and action labels must be printable non-empty strings. Malformed input is rejected before native transport.

On Linux, `requestPermission` and `getPermissionStatus` do not show an OS prompt. They probe the notification server and return `granted` when the server is reachable; otherwise they fail with `Unsupported`.

On macOS and Windows, `requestPermission` and `getPermissionStatus` return `Unsupported` with reason `host-notification-unavailable` because the host has no notification permission adapter on those platforms.

## Events

| RPC stream                   | Bridge host method    | Payload                                      |
| ---------------------------- | --------------------- | -------------------------------------------- |
| `Notification.events.Click`  | `Notification.Click`  | `{ notification, ownerWindowId? }`           |
| `Notification.events.Action` | `Notification.Action` | `{ notification, actionId, ownerWindowId? }` |

The public Effect RPC contract owns the event streams. The bridge host method
names remain native/web protocol details for host event subscriptions.

## Lifecycle

`show` registers the returned notification handle with the `ResourceRegistry`. Closing the returned owner scope, renderer disconnect, or runtime restart closes the native notification. Explicit `close` disposes the registry entry so scope finalizers do not double-close. Native click, action, and close responses remove terminal host resources so stale handles fail closed.

`show` is Linux-only today because the public contract returns a managed notification handle, not a fire-and-forget toast. A platform is supported only when the host can create the notification, retain its lifecycle handle, and keep close/click/action behavior consistent with that handle.

`close` is Linux-only today because the host stores a close-capable XDG notification handle from `notify-rust`. The macOS and Windows notification backends do not provide a close-capable handle in the current host contract, so `close` returns `Unsupported` with reason `host-notification-unavailable` on those platforms.

## Errors

Expected failures use host protocol tagged errors:

- `InvalidArgument` for malformed text, actions, or stale handles.
- `PermissionDenied` when the declared `Notification` native invocation permission is denied before host work starts.
- `Unsupported` with reason `host-notification-unavailable` on platforms without the full host-backed contract.
- `HostUnavailable` or `Internal` when the native host or desktop notification server fails.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/notification.ts`](../../../packages/native/src/notification.ts)
