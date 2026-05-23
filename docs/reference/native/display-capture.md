---
title: DisplayCapture (native)
description: Privileged display, window, and region image capture broker.
kind: reference
audience: app-developers
effect_version: 4
---

# `DisplayCapture`

`DisplayCapture` captures pixels from an explicit display, window, or region target. Each request requires an actor and a user or policy grant verified by `DisplayCaptureGrantAuthority`, checks `native.invoke` permission before host work, returns typed image bytes, and audits only redacted metadata: capture id, source, byte length, and grant identifiers.

The current Rust host adapter captures on macOS through the system `screencapture` tool. This keeps macOS Screen Recording consent in the OS path and returns typed `PermissionDenied` when the OS denies capture. Windows and Linux still return typed `Unsupported` until platform adapters are implemented.

| Method           | Payload                                          | Success                  |
| ---------------- | ------------------------------------------------ | ------------------------ |
| `captureDisplay` | `{ actor, grant, target: { displayId }}`         | `{ image, metadata }`    |
| `captureWindow`  | `{ actor, grant, target: { windowId }}`          | `{ image, metadata }`    |
| `captureRegion`  | `{ actor, grant, target: { displayId, region }}` | `{ image, metadata }`    |
| `isSupported`    | —                                                | `{ supported, reason? }` |

`image` contains `mime: "image/png" | "image/jpeg"` and `bytes: number[]` with values from `0` through `255`. The public client rejects empty bytes and mismatched image headers. `metadata` records source identity and dimensions without storing image bytes.

On macOS, `displayId` is a `screencapture` display selector: `"main"`, a positive display index such as `"1"`, or `"display-1"`. `windowId` is a positive macOS capture window id accepted by `screencapture -l`; it is not the ORIKA `WindowHandle.id`.

## Layers

- `DisplayCaptureLive`
- `DisplayCaptureGrantAuthority`
- `makeDisplayCaptureGrantAuthority(grants)`
- `makeDisplayCaptureGrantAuthorityLayer(grants)`
- `makeDisplayCaptureServiceLayer(client, options)`
- `DisplayCaptureSurface.bridgeClientLayer(exchange, options?)`
- `makeDisplayCaptureMemoryClient(options?)`
- `makeDisplayCaptureUnsupportedClient()`

## Events

`DisplayCapture.events()` emits `DisplayCaptureEvent` values for `"captured"` and `"failed"` state. Events carry capture id, source, and byte length, not image bytes.
The bridge-backed `DisplayCapture.Event` stream currently fails as typed `Unsupported` before
opening a host subscription; use the memory client for deterministic event tests until the native
capture adapter publishes lifecycle events.

## Platform Matrix

| Platform | Status        | Behavior                             |
| -------- | ------------- | ------------------------------------ |
| macOS    | `supported`   | host PNG capture via `screencapture` |
| Windows  | `unsupported` | typed unsupported host response      |
| Linux    | `unsupported` | typed unsupported host response      |

## Testing

Use `makeDisplayCaptureMemoryClient()` for deterministic capture, event, permission, and audit tests without native OS prompts. Use `makeDisplayCaptureUnsupportedClient()` to exercise the typed unsupported path.

## Related

- Source: [`packages/native/src/display-capture.ts`](../../../packages/native/src/display-capture.ts)
- Contract: [`packages/native/src/contracts/display-capture.ts`](../../../packages/native/src/contracts/display-capture.ts)
