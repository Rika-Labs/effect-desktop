---
title: SessionPermission (native)
description: Typed browser permission decisions scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `SessionPermission`

`SessionPermission` declares profile-scoped browser permission requests, decisions, decision listing, and events for camera, microphone, notifications, geolocation, clipboard, and display capture. The `SessionProfileHandle` is the partition identity; decisions do not live in global browser state.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, and exposes `SessionPermission.Event` as a typed stream. The memory client records pending requests and decisions under `profile.id` so tests can prove partition isolation and event replay.

## Methods

| Method          | Payload                                 | Success                    |
| --------------- | --------------------------------------- | -------------------------- |
| `request`       | `{ profile, kind, origin, requestId? }` | `{ requestId, status }`    |
| `decide`        | `{ profile, requestId, kind, origin }`  | decision record            |
| `listDecisions` | `{ profile, kind?, origin? }`           | `{ decisions }`            |
| `isSupported`   | `void`                                  | `{ supported, reason? }`   |
| `events`        | optional `SessionProfileHandle`         | stream of request/decision |

## Permission Kinds

- `camera`
- `microphone`
- `notifications`
- `geolocation`
- `clipboard-read`
- `clipboard-write`
- `display-capture`

`origin` must be an `app`, `http`, or `https` origin such as `app://localhost` or `https://example.test`. Paths, query strings, fragments, and empty hosts are rejected before transport.

## Support

The Rust host routes the methods and validates payloads, but it does not yet receive portable browser permission callbacks from profile-bound WebViews. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                                |
| -------- | ------------- | ------------------------------------- |
| macOS    | `unsupported` | `host-session-permission-unavailable` |
| Windows  | `unsupported` | `host-session-permission-unavailable` |
| Linux    | `unsupported` | `host-session-permission-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-session-permission-unavailable" }` from the host. Use `makeSessionPermissionMemoryClient()` for deterministic success, denial, partitioning, and replay tests; use `makeSessionPermissionUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/session-permission.ts`](../../../packages/native/src/session-permission.ts)
- Contract: [`packages/native/src/contracts/session-permission.ts`](../../../packages/native/src/contracts/session-permission.ts)
