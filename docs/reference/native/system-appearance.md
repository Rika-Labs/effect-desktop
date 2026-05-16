---
title: SystemAppearance (native)
description: Theme and accent events.
kind: reference
audience: app-developers
effect_version: 4
---

# `SystemAppearance`

Theme and appearance information.

## Methods

| Method  | Success               |
| ------- | --------------------- |
| `theme` | `{ isDark: boolean }` |

Plus an event stream emitting `{ isDark: boolean }` whenever the OS theme changes.

## Errors

`SystemAppearanceError`.

## React hook

`useTheme()` from `@effect-desktop/react`.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/system-appearance.ts`](../../../packages/native/src/system-appearance.ts)
