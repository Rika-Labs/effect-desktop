---
title: Native hooks (React)
description: useTheme, useDisplays, usePower — convenience over native services.
kind: reference
audience: app-developers
effect_version: 4
---

# Native hooks

Convenience React hooks over high-frequency native reads. Each hook takes the
matching native service function or stream factory as an argument — pass the
relevant method off your generated RPC endpoints. They are thin wrappers on top
of `useDesktopStream` / `useEffectResult`.

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

`ThemeState` is `StreamState<SystemAppearanceChangedEvent, SystemAppearanceError>`:

```ts
import type { Cause, Option } from "effect"

interface ThemeState {
  readonly status: "idle" | "running" | "closed" | "failure"
  readonly data: readonly {
    readonly appearance: "light" | "dark" | "highContrast"
    readonly accentColor: null | { r: number; g: number; b: number; a: number } // channels in [0, 1]
    readonly reducedMotion: boolean
    readonly reducedTransparency: boolean
  }[]
  readonly error: Option.Option<Cause.Cause<SystemAppearanceError>>
}
```

```tsx
const appearance = DesktopApp.useDesktop(SystemAppearanceRpcs)
const theme = useTheme(() => appearance.onAppearanceChanged())
const latest = theme.data.at(-1)
return <span>{latest?.appearance ?? "pending"}</span>
```

Native appearance delivery is host-backed on macOS and Windows and reports typed
unsupported failures on Linux.

## `useThemeMode(getAppearance)` → `AsyncResult<SystemAppearanceMode, SystemAppearanceError>`

Reads `SystemAppearance.getAppearance()` and returns the current mode. The
exported `ThemeMode` interface (`{ mode: SystemAppearanceMode }`) is a typing
helper for downstream wrappers; the hook itself returns the `AsyncResult`
directly.

```tsx
const appearance = DesktopApp.useDesktop(SystemAppearanceRpcs)
const mode = useThemeMode(() => appearance.getAppearance())
if (AsyncResult.isSuccess(mode)) {
  return <body data-theme={mode.value} />
}
```

Native appearance reads are host-backed on macOS and Windows and fail as typed
unsupported on Linux. `SystemAppearanceMode` is `"light" | "dark" | "highContrast"`.

## `useDisplays(getDisplays)` → `DisplaysResult`

```ts
AsyncResult.AsyncResult<ReadonlyArray<ScreenDisplay>, ScreenError>
```

```tsx
const screen = DesktopApp.useDesktop(ScreenRpcs)
const displays = useDisplays(() => screen.getDisplays())
```

## `usePower(streams)` → `PowerState`

`PowerState` is `StreamState<PowerEvent, PowerMonitorError>`. Pass the full
set of power-monitor stream factories — the hook merges them with
`Stream.mergeAll({ concurrency: 6 })`:

```tsx
const power = DesktopApp.useDesktop(PowerMonitorRpcs)
const state = usePower({
  onSuspend: () => power.onSuspend(),
  onResume: () => power.onResume(),
  onShutdown: () => power.onShutdown(),
  onLockScreen: () => power.onLockScreen(),
  onUnlockScreen: () => power.onUnlockScreen(),
  onPowerSourceChanged: () => power.onPowerSourceChanged()
})
```

`PowerEvent` is the union of `PowerMonitorSuspendEvent | PowerMonitorResumeEvent | PowerMonitorShutdownEvent | PowerMonitorLockScreenEvent | PowerMonitorUnlockScreenEvent | PowerMonitorSourceChangedEvent`. Native OS event delivery is available on macOS and reports typed unsupported failures on Windows and Linux.

## Related

- Reference: [`SystemAppearance`](../native/system-appearance.md), [`Screen`](../native/screen.md), [`PowerMonitor`](../native/power-monitor.md)
- Source: [`packages/react/src/hooks/native.ts`](../../../packages/react/src/hooks/native.ts)
