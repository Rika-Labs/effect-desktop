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

`method` is one of `onSuspend`, `onResume`, `onShutdown`, `onLockScreen`,
`onUnlockScreen`, or `onPowerSourceChanged`.

## Events

The TypeScript event streams and Rust host-protocol event payload structs are:

- `onSuspend()` emits `PowerMonitorSuspendEvent`.
- `onResume()` emits `PowerMonitorResumeEvent`.
- `onShutdown()` emits `PowerMonitorShutdownEvent`.
- `onLockScreen()` emits `PowerMonitorLockScreenEvent`.
- `onUnlockScreen()` emits `PowerMonitorUnlockScreenEvent`.
- `onPowerSourceChanged()` emits `PowerMonitorSourceChangedEvent`.

## Errors

`PowerMonitorError` is the host protocol error union. Until the host adapter is
implemented, `isSupported` decodes through a Rust `PowerMonitor.isSupported`
route and returns `{ supported: false }`. Each event stream checks
`isSupported` before subscribing; unsupported streams fail as typed `Unsupported`
and do not open a native event subscription.

## Stream semantics

Once a platform adapter exists, streams must preserve host event order per
subscription, fail the stream on invalid host payloads, and release the native
subscription when the stream is interrupted or its scope closes. The current
unsupported host path has no replay/backfill buffer and no terminal event.

## React hook

`usePower()` from `@effect-desktop/react` consumes the TypeScript streams, but it
does not provide native OS events until the host adapter exists.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/power-monitor.ts`](../../../packages/native/src/power-monitor.ts)
