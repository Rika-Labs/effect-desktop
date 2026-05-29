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

`isSupported` is intentionally partial: it returns `true` on macOS for known
power-monitor methods and `false` on Windows/Linux until those platforms have
host-owned event watchers instead of inferred or renderer-side state.

## Methods

| Method        | Payload      | Success                  | Runtime support |
| ------------- | ------------ | ------------------------ | --------------- |
| `isSupported` | `{ method }` | `{ supported: boolean }` | partial         |

`method` is one of `onSuspend`, `onResume`, `onShutdown`, `onLockScreen`,
`onUnlockScreen`, or `onPowerSourceChanged`.

## Events

The TypeScript streams are backed by canonical Effect RPC stream contracts:

| TypeScript stream        | RPC stream tag                           | Payload schema                   |
| ------------------------ | ---------------------------------------- | -------------------------------- |
| `onSuspend()`            | `PowerMonitor.events.Suspend`            | `PowerMonitorSuspendEvent`       |
| `onResume()`             | `PowerMonitor.events.Resume`             | `PowerMonitorResumeEvent`        |
| `onShutdown()`           | `PowerMonitor.events.Shutdown`           | `PowerMonitorShutdownEvent`      |
| `onLockScreen()`         | `PowerMonitor.events.LockScreen`         | `PowerMonitorLockScreenEvent`    |
| `onUnlockScreen()`       | `PowerMonitor.events.UnlockScreen`       | `PowerMonitorUnlockScreenEvent`  |
| `onPowerSourceChanged()` | `PowerMonitor.events.PowerSourceChanged` | `PowerMonitorSourceChangedEvent` |

Direct clients consume the `PowerMonitor.events.*` RPC streams. The native/web
bridge maps those RPC tags to the host event methods such as
`PowerMonitor.Suspend` at the boundary.

## Errors

`PowerMonitorError` is the host protocol error union. `isSupported` carries the
native authority `kind: "native"` for the `PowerMonitor` primitive rather than a
per-method `native.invoke` capability, so support queries do not require an
app-declared `native.invoke:PowerMonitor.isSupported` permission. The bridge
client checks `isSupported` for the requested method before opening any event
stream; unsupported event sources fail as typed `Unsupported` and do not open a
native event subscription. The direct host RPC client does not insert that
pre-flight check.

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

## Migration

Use `PowerMonitor.layer` directly when wiring the default service layer. `PowerMonitorLive` was removed because it only renamed the canonical Effect service layer and did not add durable desktop-specific policy, lifecycle, security, event semantics, or protocol translation.

Architecture-debt sweep outcome: removed the shallow `PowerMonitorLive` alias; no additional wrapper debt was found in the PowerMonitor service, surface, handler, or packaged Power Monitor demo paths.

## Related

- Reference: [React native hooks](../react/native-hooks.md)
- Source: [`packages/native/src/power-monitor.ts`](../../../packages/native/src/power-monitor.ts)
