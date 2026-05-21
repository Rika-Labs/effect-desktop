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

The surface exposes only the genuinely callable methods below.

| Method        | Payload                         | Success                    |
| ------------- | ------------------------------- | -------------------------- |
| `isSupported` | `void`                          | `{ supported, reason? }`   |
| `events`      | optional `SessionProfileHandle` | stream of request/decision |

## Capability facts (non-callable)

`request`, `decide`, and `listDecisions` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

| Capability fact | Intended payload                                 | Status        |
| --------------- | ------------------------------------------------ | ------------- |
| `request`       | `{ profile, kind, origin, requestId? }`          | `unsupported` |
| `decide`        | `{ profile, requestId, kind, origin, decision }` | `unsupported` |
| `listDecisions` | `{ profile, kind?, origin? }`                    | `unsupported` |

## Permission Kinds

- `camera`
- `microphone`
- `notifications`
- `geolocation`
- `clipboard-read`
- `clipboard-write`
- `display-capture`

`origin` must be an `app`, `http`, or `https` origin such as `app://localhost` or `https://example.test`. Paths, query strings, fragments, and empty hosts are rejected before transport.

`decide` remains unsupported as an explicit v1 native capability decision. A
truthful implementation must resolve a pending browser permission request under
the same `SessionProfileHandle`, apply the caller's `grant` or `deny` decision
to a retained provider callback, record the decision under the profile, and emit
a `decided` event. The current host does not retain profile-bound WebView
permission callbacks or pending request state, so a routed `decide` method could
only accept data without changing the browser permission prompt it claims to
settle.

`listDecisions` remains unsupported for the same host-boundary reason. The
result must come from a profile-scoped decision store populated by real browser
permission requests and decisions, not from renderer memory or a synthetic
cache. The current host has no such store, so listing decisions would either be
empty for the wrong reason or detached from actual WebView permission state.

## Support

The host does not yet receive portable browser permission callbacks from profile-bound WebViews. Because those methods are not implemented, they are published as non-callable capability facts with `support.status: "unsupported"` rather than registered as invocable RPCs.

| Platform | Status        | Reason                                |
| -------- | ------------- | ------------------------------------- |
| macOS    | `unsupported` | `host-session-permission-unavailable` |
| Windows  | `unsupported` | `host-session-permission-unavailable` |
| Linux    | `unsupported` | `host-session-permission-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-session-permission-unavailable" }` from the host. Use `makeSessionPermissionMemoryClient()` for deterministic `isSupported` and event tests; use `makeSessionPermissionUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/session-permission.ts`](../../../packages/native/src/session-permission.ts)
- Contract: [`packages/native/src/contracts/session-permission.ts`](../../../packages/native/src/contracts/session-permission.ts)
