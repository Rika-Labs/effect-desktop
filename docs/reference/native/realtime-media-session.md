---
title: RealtimeMediaSession (native)
description: Product-neutral realtime microphone, speaker, device, permission, and interruption session primitive.
kind: reference
audience: app-developers
effect_version: 4
---

# `RealtimeMediaSession`

Product-neutral realtime media session primitive. It models microphone and speaker device state, permission state, interruption events, and session state without assistant, chat, model, prompt, or LLM concepts.

`RealtimeMediaSession` is scoped to realtime microphone/speaker sessions. It is
not the central WebView/session permission manager for notifications,
geolocation, clipboard, display capture, or generic browser permission prompts.

The public service is Layer-first and test-substitutable. The Rust host adapter is runtime-verified on macOS through CPAL. `isSupported` opens and immediately releases default microphone and speaker streams; it returns `supported: true` only where CPAL reports stream startup synchronously. Headless machines, missing devices, unavailable audio backends, denied OS media access, or platforms where stream startup is only enqueued return typed failures or typed unsupported results. `open` and `selectDevice` obey the same startup-verification gate, so unsupported platforms do not silently start best-effort streams.

`open` and `selectDevice` are supported on macOS because the host can synchronously verify stream
startup before registering or updating a session. Runtime failures such as missing devices or
denied OS media access remain typed operation failures and should be checked with `isSupported`
before opening a session.

## Methods

| Method         | Payload                                    | Success                  |
| -------------- | ------------------------------------------ | ------------------------ |
| `open`         | `{ profileId, sessionId }`                 | `void`                   |
| `close`        | `{ profileId, sessionId }`                 | `void`                   |
| `selectDevice` | `{ profileId, sessionId, kind, deviceId }` | `void`                   |
| `interrupt`    | `{ profileId, sessionId, reason }`         | `void`                   |
| `isSupported`  | `void`                                     | `{ supported, reason? }` |

## Streams

- `deviceState({ profileId, sessionId })`
- `permissionState({ profileId, sessionId })`
- `interruptions({ profileId, sessionId })`
- `sessionState({ profileId, sessionId })`
- `events({ profileId, sessionId })`

All streams are partitioned by explicit `profileId` and `sessionId`. The memory client uses a bounded replaying `PubSub`, so tests can subscribe after setup and still observe recent events.

The four event payload schemas are owned by canonical Effect RPC stream
contracts: `RealtimeMediaSession.events.DeviceState`,
`RealtimeMediaSession.events.PermissionState`,
`RealtimeMediaSession.events.Interruption`, and
`RealtimeMediaSession.events.SessionState`. The native bridge lowers those
contracts to the existing host event methods
`RealtimeMediaSession.DeviceState`, `RealtimeMediaSession.PermissionState`,
`RealtimeMediaSession.Interruption`, and `RealtimeMediaSession.SessionState`.

The production host emits host lifecycle events for `open`, `selectDevice`, `interrupt`, `close`, and CPAL stream failure:

- `open` records a host-owned session, starts the selected microphone and speaker streams, emits permission state, device state, and active session state. If the OS denies capture or the device cannot be opened, `open` fails before a session is registered.
- `selectDevice` validates the session and requested host device, opens the selected microphone or
  speaker stream, and emits a new device state event. Like `open`, it is supported on macOS and
  returns typed unsupported on Windows/Linux until verified realtime media startup exists there.
- `interrupt` releases the host-owned microphone and speaker streams, then emits interruption and
  interrupted session-state events. `interrupt` is supported on macOS for host-owned sessions;
  Windows/Linux return typed unsupported until verified realtime media startup exists there.
- `close`, request cancellation, renderer disconnect, and window destroy drop host session resources
  and release owned streams. `close` is supported on macOS for host-owned sessions; Windows/Linux
  return typed unsupported because the host disables realtime media session startup there until stream
  startup can be verified synchronously.
- CPAL stream failures enqueue a host-control cleanup signal, release the session off the audio callback path, and emit `host-failed` interruption plus closed session-state events when the runtime event channel is still available.

Device state is a host snapshot at `open` and `selectDevice`; this adapter does not claim a separate OS device-change watcher. Bridge event streams call `isSupported` before subscribing and fail with typed `Unsupported` when the real host reports startup-unverified or unavailable support.

## Errors

`RealtimeMediaSessionError` is the canonical host protocol error union. Permission denial, unsupported platforms, invalid input, and host failures are typed tagged failures.

`isSupported` currently reports `reason: "host-media-unavailable"` when the host adapter is present but the runtime cannot open and release default microphone and speaker streams. It reports `reason: "host-media-startup-unverified"` on Windows and Linux because CPAL enqueues stream startup there instead of synchronously proving `play()`. OS access denial during stream open is reported as `PermissionDenied` when CPAL exposes a permission-shaped backend error. The older `"host-adapter-unimplemented"` reason remains for clients that explicitly install the unsupported test client.

## Testing

Use `makeRealtimeMediaSessionMemoryClient()` for deterministic success and failure tests without OS prompts. Use `makeRealtimeMediaSessionUnsupportedClient()` when a test needs the real host-adapter maturity shape.

## Architecture-debt sweep

Issue #1829 removed the public `RealtimeMediaSessionRpcEvents` side object by
moving event payload ownership into canonical Effect RPC streams. The bridge
client remains the native/web boundary adapter because it preserves host event
method names and keeps the `isSupported` preflight before subscription.

## Related

- Source: [`packages/native/src/realtime-media-session.ts`](../../../packages/native/src/realtime-media-session.ts)
- Contract: [`packages/native/src/contracts/realtime-media-session.ts`](../../../packages/native/src/contracts/realtime-media-session.ts)
