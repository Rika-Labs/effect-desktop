---
title: Native hooks (React)
description: useTheme, useDisplays, usePower — convenience over native services.
kind: reference
audience: app-developers
effect_version: 4
---

# Native hooks

Convenience React hooks over high-frequency native reads. Each is a thin wrapper over the matching RPC client.

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
} from "@effect-desktop/react"
```

## `useTheme()` → `ThemeState`

```ts
{ isDark: boolean }
```

Subscribes to `SystemAppearance` theme events.

## `useThemeMode()` → `"light" | "dark"`

Same as `useTheme().isDark` rendered as a string mode.

## `useDisplays()` → `DisplaysResult`

```ts
{ displays: ScreenDisplay[] }
```

Calls `Screen.getDisplays`.

## `usePower()` → `PowerState`

```ts
{ event?: "suspend" | "resume" | "shutdown" | "lock-screen" | "unlock-screen" }
```

Subscribes to `PowerMonitor` events.

## Related

- Reference: [`SystemAppearance`](../native/system-appearance.md), [`Screen`](../native/screen.md), [`PowerMonitor`](../native/power-monitor.md)
- Source: [`packages/react/src/hooks/native.ts`](../../../packages/react/src/hooks/native.ts)
