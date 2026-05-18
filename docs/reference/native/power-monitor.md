---
title: PowerMonitor (native)
description: Power monitor API status and event contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `PowerMonitor`

System power and sleep events.

The TypeScript surface is present for contract and bridge-event decoding work,
but the Rust host power monitor adapter is not implemented. The native surface
reports `unsupported` on macOS, Windows, and Linux until host power watchers,
permission enforcement, platform support mapping, and event delivery are
implemented.

## Methods

| Method        | Payload      | Success                  | Runtime support |
| ------------- | ------------ | ------------------------ | --------------- |
| `isSupported` | `{ method }` | `{ supported: boolean }` | unsupported     |

`method` is one of `onSuspend`, `onResume`, `onShutdown`, or
`onPowerSourceChanged`.

## Events

The current TypeScript event streams are:

- `onSuspend()` emits `PowerMonitorSuspendEvent`.
- `onResume()` emits `PowerMonitorResumeEvent`.
- `onShutdown()` emits `PowerMonitorShutdownEvent`.
- `onPowerSourceChanged()` emits `PowerMonitorSourceChangedEvent`.

Lock and unlock events are not exposed by the current TypeScript contract.

## Errors

`PowerMonitorError` is the host protocol error union. Until the host adapter is
implemented, `isSupported` decodes through a Rust `PowerMonitor.isSupported`
route and returns `{ supported: false }`; subscriptions still do not have a
native OS event source.

## React hook

`usePower()` from `@effect-desktop/react` consumes the TypeScript streams, but it
does not provide native OS events until the host adapter exists.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/power-monitor.ts`](../../../packages/native/src/power-monitor.ts)
