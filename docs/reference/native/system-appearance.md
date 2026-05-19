---
title: SystemAppearance (native)
description: System appearance API status, snapshot methods, and events.
kind: reference
audience: app-developers
effect_version: 4
---

# `SystemAppearance`

Theme and appearance information.

The Rust host system appearance adapter implements read-only snapshot methods on
macOS and Windows. Linux and native OS appearance-change events remain
unsupported. The host binary includes a macOS-only
`--system-appearance-smoke-test` mode that reads the snapshot methods on the
main thread and exits before starting the renderer runtime.

## Methods

| Method                   | Success                  | Runtime support |
| ------------------------ | ------------------------ | --------------- |
| `getAppearance`          | `{ appearance }`         | macOS, Windows  |
| `getAccentColor`         | `{ color }`              | macOS, Windows  |
| `getReducedMotion`       | `{ enabled: boolean }`   | macOS, Windows  |
| `getReducedTransparency` | `{ enabled: boolean }`   | macOS, Windows  |
| `isSupported`            | `{ supported: boolean }` | supported       |

`appearance` is `"light"`, `"dark"`, or `"highContrast"`. `color` is either
`null` or an RGBA object.

On Windows, `getAppearance` uses high-contrast state plus the current user's
`AppsUseLightTheme` setting, `getAccentColor` uses the DWM colorization color,
`getReducedMotion` reflects client-area animation settings, and
`getReducedTransparency` uses the current user's `EnableTransparency` setting.
Missing optional registry values fall back to light appearance, no accent color,
and transparency enabled.

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

Native OS appearance delivery is currently unsupported until the host can publish
platform appearance-change events.

## Errors

`SystemAppearanceError` is the host protocol error union. Unsupported platforms
decode through Rust `SystemAppearance.*` routes and fail closed as typed
`Unsupported`. `isSupported` decodes through the Rust host and reports method
support; `onAppearanceChanged` remains unsupported because subscriptions do not
have a native OS event source.

`onAppearanceChanged()` checks `isSupported("onAppearanceChanged")` before it
subscribes. When the host reports that appearance events are unsupported, the
stream fails as typed `Unsupported` and does not open a native event
subscription.

## React hook

`useTheme()` and `useThemeMode()` from `@effect-desktop/react` consume the
TypeScript appearance stream, but do not provide native OS appearance events
until host event delivery is implemented.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/system-appearance.ts`](../../../packages/native/src/system-appearance.ts)
