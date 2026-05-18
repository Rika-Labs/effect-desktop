---
title: SystemAppearance (native)
description: System appearance API status, snapshot methods, and events.
kind: reference
audience: app-developers
effect_version: 4
---

# `SystemAppearance`

Theme and appearance information.

The TypeScript surface is present for contract and bridge-event decoding work,
but the Rust host system appearance adapter is not implemented. The native
surface reports `unsupported` on macOS, Windows, and Linux until host appearance
snapshot methods, platform support mapping, and appearance event delivery are
implemented.

## Methods

| Method                   | Success                    | Runtime support |
| ------------------------ | -------------------------- | --------------- |
| `getAppearance`          | `{ appearance }`           | unsupported     |
| `getAccentColor`         | `{ color }`                | unsupported     |
| `getReducedMotion`       | `{ enabled: boolean }`     | unsupported     |
| `getReducedTransparency` | `{ enabled: boolean }`     | unsupported     |
| `isSupported`            | `{ supported: boolean }`   | unsupported     |

`appearance` is `"light"`, `"dark"`, or `"highContrast"`. `color` is either
`null` or an RGBA object.

## Events

The current TypeScript event stream is `onAppearanceChanged()`, which emits
`SystemAppearanceChangedEvent` with `{ appearance }`.

The event does not yet carry the same full snapshot shape as the initial
methods. Native OS appearance delivery is currently unsupported until the host
adapter exists.

## Errors

`SystemAppearanceError` is the host protocol error union. Until the host adapter
is implemented, bridge calls and subscriptions reach an unsupported or missing
host path rather than real OS appearance state.

## React hook

`useTheme()` and `useThemeMode()` from `@effect-desktop/react` consume the
TypeScript appearance stream, but do not provide native OS appearance events
until the host adapter exists.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/system-appearance.ts`](../../../packages/native/src/system-appearance.ts)
