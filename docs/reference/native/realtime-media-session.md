---
title: RealtimeMediaSession (native)
description: Product-neutral realtime microphone, speaker, device, permission, and interruption session primitive.
kind: reference
audience: app-developers
effect_version: 4
---

# `RealtimeMediaSession`

Product-neutral realtime media session primitive. It models microphone and speaker device state, permission state, interruption events, and session state without assistant, chat, model, prompt, or LLM concepts.

The public service is Layer-first and test-substitutable. The current Rust host adapter is explicit `Unsupported` on macOS, Windows, and Linux until real OS media capture is implemented; malformed input is still rejected before host work.

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

## Errors

`RealtimeMediaSessionError` is the canonical host protocol error union. Permission denial, unsupported platforms, invalid input, and host failures are typed tagged failures.

## Testing

Use `makeRealtimeMediaSessionMemoryClient()` for deterministic success and failure tests without OS prompts. Use `makeRealtimeMediaSessionUnsupportedClient()` when a test needs the real host-adapter maturity shape.

## Related

- Source: [`packages/native/src/realtime-media-session.ts`](../../../packages/native/src/realtime-media-session.ts)
- Contract: [`packages/native/src/contracts/realtime-media-session.ts`](../../../packages/native/src/contracts/realtime-media-session.ts)
