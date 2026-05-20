---
title: PowerMonitor (native)
description: Power monitor API status and event contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `PowerMonitor`

System power and sleep events.

The Rust host publishes power monitor events on macOS. Windows and Linux return
typed unsupported results until platform watchers are implemented. The macOS
adapter uses `NSWorkspace` notifications for suspend, resume, shutdown, lock,
and unlock events, and polls `pmset -g ps` for power-source changes.

## Methods

| Method        | Payload      | Success                  | Runtime support |
| ------------- | ------------ | ------------------------ | --------------- |
| `isSupported` | `{ method }` | `{ supported: boolean }` | partial         |

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

`PowerMonitorError` is the host protocol error union. `isSupported` is protected
by the `native.invoke:PowerMonitor.isSupported` permission. Denied calls fail as
`PermissionDenied` before the handler runs. Each event stream checks
`isSupported` before subscribing; unsupported streams fail as typed
`Unsupported` and do not open a native event subscription.

## Stream semantics

Events preserve host publication order per method. The host protocol client keeps
the newest 64 events per method for reconnect/replay after the transport reader
has seen them. Subscription queues are unbounded inside the current host client;
future high-volume sources should use a bounded policy instead. Streams fail on
invalid host payloads or host transport failure and have no terminal event. The
Rust macOS notification observers and power-source poller are scoped to the
runtime connection and are removed when the runtime disconnects.

## React hook

`usePower()` from `@orika/react` consumes the TypeScript streams. It
receives native OS events on macOS and typed unsupported failures on Windows and
Linux.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/power-monitor.ts`](../../../packages/native/src/power-monitor.ts)
