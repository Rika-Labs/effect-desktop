---
title: Screen (native)
description: Display information and pointer position.
kind: reference
audience: app-developers
effect_version: 4
---

# `Screen`

Display information, display-change events, and pointer position.

## Import

```ts
import { Screen, ScreenRpcs, Native } from "@orika/native"
import { ScreenRpcs as RendererScreenRpcs } from "@orika/native/renderer"
```

Runtime and service code import from `@orika/native`. Browser renderer
manifests import the renderer-safe RPC group from `@orika/native/renderer`.

## Methods

| Method              | Payload      | Success                         |
| ------------------- | ------------ | ------------------------------- |
| `getDisplays`       | —            | `{ displays: ScreenDisplay[] }` |
| `getPrimaryDisplay` | —            | `ScreenDisplay`                 |
| `getPointerPoint`   | —            | `ScreenPoint`                   |
| `isSupported`       | `{ method }` | `{ supported: boolean }`        |

`getDisplays`, `getPrimaryDisplay`, and `getPointerPoint` require the declared
`native.invoke` permission for the Screen primitive. `isSupported` is
permission-free so callers can probe before enabling Screen-dependent features.

## Events

| Event                    | Payload                         |
| ------------------------ | ------------------------------- |
| `Screen.DisplaysChanged` | `{ displays: ScreenDisplay[] }` |

The TypeScript stream is `onDisplaysChanged()`. Its payload schema is owned by
the canonical `Screen.events.DisplaysChanged` RPC stream contract; the native
bridge lowers that stream to the existing `Screen.DisplaysChanged` host event
method. The native host emits the event from Tao window scale-factor changes.
The event includes the same `scaleFactor` field as `getDisplays`. General
monitor hot-plug events are limited by the current Tao event surface, so callers
that need exact topology should refresh with `getDisplays` after the event.

## Types

```ts
ScreenDisplay = {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
}

ScreenPoint = { x: number; y: number }
```

The Rust host reports Tao monitor geometry in physical host coordinates. On
macOS, `workArea` uses AppKit `NSScreen.visibleFrame`, so menu-bar and Dock
reserved areas are excluded. On Windows, `workArea` uses Win32 `rcWork`, so
taskbar and app desktop toolbar reservations are excluded. On Linux, `workArea`
uses GDK monitor work areas, so desktop-panel reservations reported by the
active GTK backend are excluded.

## Platform matrix

| Platform | Status    | Notes                                                                                                                                         |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | supported | Tao-backed monitors, AppKit-backed work areas, and pointer position.                                                                          |
| Windows  | supported | Tao-backed monitors, Win32-backed work areas, and pointer position.                                                                           |
| Linux    | partial   | Monitor enumeration and GDK-backed work areas are supported; pointer position may report unsupported on compositors that deny cursor queries. |

## Errors

`ScreenError`.

## Test layer

`ScreenTest(options)` from `@orika/test`.

## React hooks

`useDisplays()` from `@orika/react`.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Explanation: [RPC surface vs. mapped](../../explanation/rpc-surface-vs-mapped.md) — Screen is the direct-surface example
- Source: [`packages/native/src/screen.ts`](../../../packages/native/src/screen.ts)
