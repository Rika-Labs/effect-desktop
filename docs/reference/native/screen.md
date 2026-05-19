---
title: Screen (native)
description: Display information and pointer position.
kind: reference
audience: app-developers
effect_version: 4
---

# `Screen`

Display information, display-change events, and pointer position.

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

The native host emits `Screen.DisplaysChanged` from Tao window scale-factor
changes. The event includes the same `scaleFactor` field as `getDisplays`.
General monitor hot-plug events are limited by the current Tao event surface, so
callers that need exact topology should refresh with `getDisplays` after the
event.

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
taskbar and app desktop toolbar reservations are excluded. On Linux, Tao does
not expose monitor work areas through its public monitor API yet, so `workArea`
currently matches `bounds`.

## Platform matrix

| Platform | Status    | Notes                                                                                                                                                        |
| -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | supported | Tao-backed monitors, AppKit-backed work areas, and pointer position.                                                                                         |
| Windows  | supported | Tao-backed monitors, Win32-backed work areas, and pointer position.                                                                                          |
| Linux    | partial   | Monitor enumeration is supported and `workArea` currently matches `bounds`; pointer position may report unsupported on compositors that deny cursor queries. |

## Errors

`ScreenError`.

## Test layer

`ScreenTest(options)` from `@effect-desktop/test`.

## React hooks

`useDisplays()` from `@effect-desktop/react`.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Explanation: [RPC surface vs. mapped](../../explanation/rpc-surface-vs-mapped.md) — Screen is the direct-surface example
- Source: [`packages/native/src/screen.ts`](../../../packages/native/src/screen.ts)
