---
title: Screen (native)
description: Display information and pointer position.
kind: reference
audience: app-developers
effect_version: 4
---

# `Screen`

Display information and pointer position. **Direct surface** — the public service _is_ the generated client.

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `getDisplays` | — | `{ displays: ScreenDisplay[] }` |
| `getPrimaryDisplay` | — | `ScreenDisplay` |
| `getPointerPoint` | — | `ScreenPoint` |
| `isSupported` | `{ method }` | `{ supported: boolean }` |

## Types

```ts
ScreenDisplay = {
  id, label, bounds: { x, y, width, height }, workArea: { x, y, width, height },
  scaleFactor, isPrimary, rotation, monitor?
}
ScreenPoint = { x: number; y: number }
```

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
