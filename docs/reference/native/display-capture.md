---
title: DisplayCapture (native)
description: Privileged display, window, and region image capture broker.
kind: reference
audience: app-developers
effect_version: 4
---

# `DisplayCapture`

`DisplayCapture` captures pixels from an explicit display, window, or region target. Each request requires an actor and a user or policy grant verified by `DisplayCaptureGrantAuthority`, checks `native.invoke` permission before host work, returns typed image bytes, and audits only redacted metadata: capture id, source, byte length, and grant identifiers.

The current Rust host adapter validates payloads and returns typed `Unsupported` for capture methods on macOS, Windows, and Linux until platform adapters are implemented.

| Method           | Payload                                          | Success                  |
| ---------------- | ------------------------------------------------ | ------------------------ |
| `captureDisplay` | `{ actor, grant, target: { displayId }}`         | `{ image, metadata }`    |
| `captureWindow`  | `{ actor, grant, target: { windowId }}`          | `{ image, metadata }`    |
| `captureRegion`  | `{ actor, grant, target: { displayId, region }}` | `{ image, metadata }`    |
| `isSupported`    | —                                                | `{ supported, reason? }` |

`image` contains `mime: "image/png" | "image/jpeg"` and `bytes: number[]` with values from `0` through `255`. The public client rejects empty bytes and mismatched image headers. `metadata` records source identity and dimensions without storing image bytes.

## Layers

- `DisplayCaptureLive`
- `DisplayCaptureGrantAuthority`
- `makeDisplayCaptureGrantAuthority(grants)`
- `makeDisplayCaptureGrantAuthorityLayer(grants)`
- `makeDisplayCaptureClientLayer(client)`
- `makeDisplayCaptureServiceLayer(client, options)`
- `makeDisplayCaptureBridgeClientLayer(exchange, options?)`
- `makeDisplayCaptureMemoryClient(options?)`
- `makeDisplayCaptureUnsupportedClient()`

## Events

`DisplayCapture.events()` emits `DisplayCaptureEvent` values for `"captured"` and `"failed"` state. Events carry capture id, source, and byte length, not image bytes.

## Platform Matrix

| Platform | Status        | Behavior                        |
| -------- | ------------- | ------------------------------- |
| macOS    | `unsupported` | typed unsupported host response |
| Windows  | `unsupported` | typed unsupported host response |
| Linux    | `unsupported` | typed unsupported host response |

## Testing

Use `makeDisplayCaptureMemoryClient()` for deterministic capture, event, permission, and audit tests without native OS prompts. Use `makeDisplayCaptureUnsupportedClient()` to exercise the typed unsupported path.

## Related

- Source: [`packages/native/src/display-capture.ts`](../../../packages/native/src/display-capture.ts)
- Contract: [`packages/native/src/contracts/display-capture.ts`](../../../packages/native/src/contracts/display-capture.ts)
