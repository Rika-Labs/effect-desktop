---
title: Tray (native)
description: System tray icon and menu.
kind: reference
audience: app-developers
effect_version: 4
---

# `Tray`

System tray icon and menu support. The host adapter currently supports macOS and Windows. Linux returns
`{ supported: false, reason: "host-tray-unavailable" }` until the project ships and probes the required
tray stack.

The local `tray-icon` backend can target Linux, but it relies on a GTK event loop plus AppIndicator and
libxdo system support. The current host does not include the Linux `tray-icon` dependency, does not ship
or verify `libayatana-appindicator3`/`libappindicator3`, and does not have a fail-closed probe before
tray creation. `Tray.create` therefore remains partial rather than claiming support that may crash or
silently fail on Linux desktops without that stack.

`Tray.destroy` is tied to the same adapter boundary. Linux cannot own a generation-stamped tray handle
until `Tray.create` can allocate one through the host tray registry, so destroy remains unsupported there
instead of accepting synthetic handles.

`Tray.setIcon` is also tied to the Linux tray backend. Updating a Linux tray icon requires an owned
AppIndicator-backed handle and the backend's temporary PNG icon path management, so the host keeps the
method partial until that backend is shipped and probed.

`Tray.setMenu` has the same Linux dependency. The local backend maps menu templates into GTK menu objects
owned by the AppIndicator tray item; without that adapter and runtime probe, Linux menu mutation remains
unsupported.

`Tray.setTitle` is currently macOS-only. The local tray backend documents Windows title support as
unsupported and its Windows implementation does not mutate a native title; Linux title support depends on
the same AppIndicator-backed tray adapter that is not shipped yet.

`Tray.setTooltip` is supported on macOS and Windows. The local tray backend documents Linux tooltips as
unsupported, and its Linux implementation does not mutate tooltip text, so the parity row uses the
method-specific `linux-tray-tooltip-unavailable` reason.

## Methods

| Method        | Payload                             | Success                  |
| ------------- | ----------------------------------- | ------------------------ |
| `create`      | `{ icon, tooltip?, title?, menu? }` | `TrayHandle`             |
| `destroy`     | `{ tray }`                          | `void`                   |
| `setIcon`     | `{ tray, icon }`                    | `void`                   |
| `setTooltip`  | `{ tray, tooltip }`                 | `void`                   |
| `setTitle`    | `{ tray, title }`                   | `void`                   |
| `setMenu`     | `{ tray, menu }`                    | `void`                   |
| `isSupported` | `void`                              | `{ supported, reason? }` |

`TrayHandle` is a generation-stamped resource handle:

```ts
{
  kind: "tray",
  id: ResourceId,
  generation: number,
  ownerScope: string,
  state: "open"
}
```

The host rejects stale generation, wrong owner scope, and non-open handles before mutating native
state. Destroying a tray drops the native icon exactly once and unregisters it from activation event
routing.

## Icons

The first host adapter accepts explicit solid-color icons in `solid:#RRGGBBAA` format. File and app
asset resolution are intentionally not part of this adapter yet; callers should use the explicit
format until an Effect-native asset resolver is added.

## Events

`Tray.onActivated()` streams `Tray.events.Activated` for click and double-click activation. Bridge
clients keep host wire compatibility by subscribing to `Tray.Activated`:

```ts
{
  tray: TrayHandle,
  ownerWindowId?: string
}
```

Events are emitted only for currently registered tray handles. Closing the runtime or destroying the
tray stops routing events for that handle.

Architecture-debt sweep outcome for #1860: removed `TrayRpcEvents`, the local `subscribeTrayEvent`
helper, and the `TrayLive` alias. `Tray` and `makeTrayServiceLayer` remain because they own durable
ResourceRegistry-backed tray lifecycle policy and deterministic resource-layer construction.

## Platform Notes

| Platform | Status      | Notes                                      |
| -------- | ----------- | ------------------------------------------ |
| macOS    | supported   | Supports icon, tooltip, title, menu, event |
| Windows  | partial     | Title is unsupported                       |
| Linux    | unsupported | GTK/appindicator dependency is not shipped |

## Errors

`TrayError`, including `InvalidArgument`, `NotFound`, `Unsupported`, `HostUnavailable`, and
`Internal`.

## Related

- Reference: [`Menu`](menu.md)
- Source: [`packages/native/src/tray.ts`](../../../packages/native/src/tray.ts)
