---
title: PowerMonitor (native)
description: System power and sleep events.
kind: reference
audience: app-developers
effect_version: 4
---

# `PowerMonitor`

System power and sleep events.

## Methods

| Method        | Payload      | Success                  |
| ------------- | ------------ | ------------------------ |
| `isSupported` | `{ method }` | `{ supported: boolean }` |

Event stream of `"suspend" \| "resume" \| "shutdown" \| "lock-screen" \| "unlock-screen"`.

## Errors

`PowerMonitorError`.

## React hook

`usePower()` from `@effect-desktop/react`.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/power-monitor.ts`](../../../packages/native/src/power-monitor.ts)
