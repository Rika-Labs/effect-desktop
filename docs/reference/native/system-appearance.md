---
title: SystemAppearance (native)
description: System appearance API status, snapshot methods, and events.
kind: reference
audience: app-developers
effect_version: 4
---

# `SystemAppearance`

Theme and appearance information.

The Rust host system appearance adapter implements read-only snapshot methods
and appearance-change events on macOS and Windows. Linux supports nullable
accent-color reads and leaves the broader snapshot/event surface unsupported.
The host binary includes a macOS-only `--system-appearance-smoke-test` mode that
reads the snapshot methods and exits before starting the renderer runtime.

## Methods

| Method                   | Success                  | Runtime support       |
| ------------------------ | ------------------------ | --------------------- |
| `getAppearance`          | `{ appearance }`         | macOS, Windows        |
| `getAccentColor`         | `{ color }`              | macOS, Windows, Linux |
| `getReducedMotion`       | `{ enabled: boolean }`   | macOS, Windows        |
| `getReducedTransparency` | `{ enabled: boolean }`   | macOS, Windows        |
| `isSupported`            | `{ supported: boolean }` | supported             |

`appearance` is `"light"`, `"dark"`, or `"highContrast"`. `color` is either
`null` or an RGBA object.

On Windows, `getAppearance` uses high-contrast state plus the current user's
`AppsUseLightTheme` setting, `getAccentColor` uses the DWM colorization color,
`getReducedMotion` reflects client-area animation settings, and
`getReducedTransparency` uses the current user's `EnableTransparency` setting.
Missing optional registry values fall back to light appearance, no accent color,
and transparency enabled.

On macOS, `getAppearance` uses accessibility contrast state plus the current
user's `AppleInterfaceStyle`, `getAccentColor` uses `NSColor.controlAccentColor`,
and reduced-motion/transparency values come from `NSWorkspace` accessibility
display options.

On Linux, `getAccentColor` returns `null`. The current GTK3 host dependency
surface does not expose a stable desktop-wide accent-color setting, and `null`
is the API's explicit "no accent color" value.

Linux `getAppearance` remains unsupported. The GTK3 settings available to the
host expose application dark-theme preference and theme name, but that is not a
durable desktop-wide `"light" | "dark" | "highContrast"` contract across Linux
desktops.

Linux `getReducedMotion` remains unsupported. GTK3 exposes
`gtk-enable-animations`, but that API is GTK-main-thread scoped and is not a
durable desktop-wide reduced-motion contract for the host protocol path.

Linux `getReducedTransparency` remains unsupported. The current Linux host
dependency surface does not expose a stable desktop-wide transparency reduction
setting.

`isSupported` is protected by `native.invoke:SystemAppearance.isSupported`.

## Events

The current TypeScript event stream is `onAppearanceChanged()`, which emits a
`SystemAppearanceChangedEvent` snapshot:

```ts
{
  appearance: "light" | "dark" | "highContrast"
  accentColor: null | { r: number; g: number; b: number; a: number }
  reducedMotion: boolean
  reducedTransparency: boolean
}
```

On macOS and Windows the Rust host installs a runtime-scoped snapshot poller and
publishes `SystemAppearance.AppearanceChanged` when the snapshot changes. The
first observed snapshot is also published so subscribers receive the same typed
shape as later changes. The poller is cleared on renderer disconnect, runtime
restart, and host resource cleanup.

## Errors

`SystemAppearanceError` is the host protocol error union. Unsupported platforms
decode through Rust `SystemAppearance.*` routes and fail closed as typed
`Unsupported`. `isSupported` decodes through the Rust host and reports method
support.

`onAppearanceChanged()` checks `isSupported("onAppearanceChanged")` before it
subscribes. When the host reports that appearance events are unsupported, such
as on Linux, the stream fails as typed `Unsupported` and does not open a native
event subscription.

## React hook

`useTheme()` and `useThemeMode()` from `@effect-desktop/react` consume the
TypeScript appearance stream. Native appearance events are host-backed on macOS
and Windows and fail as typed unsupported on Linux.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/system-appearance.ts`](../../../packages/native/src/system-appearance.ts)
