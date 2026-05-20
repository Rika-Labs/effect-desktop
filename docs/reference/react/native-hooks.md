---
title: Native hooks (React)
description: useTheme, useDisplays, usePower — convenience over native services.
kind: reference
audience: app-developers
effect_version: 4
---

# Native hooks

Convenience React hooks over high-frequency native reads. Each hook takes the
matching native service function or stream function as an argument.

## Imports

```ts
import {
  useTheme,
  useThemeMode,
  usePower,
  useDisplays,
  type ThemeState,
  type ThemeMode,
  type PowerState,
  type PowerEvent,
  type DisplaysResult
} from "@orika/react"
```

## `useTheme(onAppearanceChanged)` → `ThemeState`

```ts
{
  data?: {
    appearance: "light" | "dark" | "highContrast"
    accentColor: null | { r: number; g: number; b: number; a: number }
    reducedMotion: boolean
    reducedTransparency: boolean
  }
}
```

Consumes the TypeScript `SystemAppearance` appearance event stream. Native
appearance delivery is host-backed on macOS and Windows and reports typed
unsupported failures on Linux.

## `useThemeMode(getAppearance)` → `AsyncResult<SystemAppearanceMode, SystemAppearanceError>`

Reads `SystemAppearance.getAppearance()` and returns the current mode. Native
appearance reads are host-backed on macOS and Windows and fail as typed
unsupported on Linux.

`SystemAppearanceMode` is `"light" | "dark" | "highContrast"`.

## `useDisplays(getDisplays)` → `DisplaysResult`

```ts
ReadonlyArray<ScreenDisplay>
```

Calls `Screen.getDisplays`.

## `usePower(streams)` → `PowerState`

```ts
{
  data?:
    | PowerMonitorSuspendEvent
    | PowerMonitorResumeEvent
    | PowerMonitorShutdownEvent
    | PowerMonitorLockScreenEvent
    | PowerMonitorUnlockScreenEvent
    | PowerMonitorSourceChangedEvent
}
```

Consumes the TypeScript `PowerMonitor` event streams. Native OS event delivery is
available on macOS and reports typed unsupported failures on Windows and Linux.

## Related

- Reference: [`SystemAppearance`](../native/system-appearance.md), [`Screen`](../native/screen.md), [`PowerMonitor`](../native/power-monitor.md)
- Source: [`packages/react/src/hooks/native.ts`](../../../packages/react/src/hooks/native.ts)
