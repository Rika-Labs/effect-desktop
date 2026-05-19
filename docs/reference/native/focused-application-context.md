---
title: FocusedApplicationContext (native)
description: Product-neutral focused app, window, process, and display metadata broker.
kind: reference
audience: app-developers
effect_version: 4
---

# `FocusedApplicationContext`

Product-neutral broker for the focused desktop surface. Snapshots expose application, window, process, package, and display metadata only.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before host side effects, audits privileged use, records security-relevant failures, emits typed events, and registers long-lived watches with `ResourceRegistry` before starting the host watch. If registration or host start fails, no watch remains owned by the service.

## Methods

| Method         | Payload                                      | Success                                          |
| -------------- | -------------------------------------------- | ------------------------------------------------ |
| `snapshot`     | `{ actor, traceId? }`                        | `{ application, window?, display?, observedAt }` |
| `watch`        | `{ actor, watchId?, ownerScope?, traceId? }` | `{ watchId, active }`                            |
| `stopWatching` | `{ actor, watchId, traceId? }`               | `{ watchId, stopped }`                           |
| `isSupported`  | `void`                                       | `{ supported, reason? }`                         |
| `events`       | `void`                                       | stream of focused context events                 |

## Snapshot

The snapshot is metadata only:

- `application`: stable app id plus optional name, bundle id, package name, executable path, and process id
- `window`: optional window id, title, bounds, and display id
- `display`: optional display id, bounds, and scale factor
- `observedAt`: host observation timestamp

## Support

The Rust host adapter now implements `snapshot` on macOS through `NSWorkspace.frontmostApplication`.
That path reports focused application metadata only; focused window/display metadata, watch lifecycle, and host-originated focus events remain unsupported.

| Method         | macOS                                          | Windows       | Linux         |
| -------------- | ---------------------------------------------- | ------------- | ------------- |
| `snapshot`     | `partial` (`macos-frontmost-application-only`) | `unsupported` | `unsupported` |
| `watch`        | `unsupported`                                  | `unsupported` | `unsupported` |
| `stopWatching` | `unsupported`                                  | `unsupported` | `unsupported` |

`isSupported` still returns `{ supported: false, reason: "host-adapter-unimplemented" }` until the host provides snapshot, watch lifecycle, and event delivery for the surface. Unsupported host requests decode and validate payloads, then return typed `Unsupported`; invalid payloads are rejected before the unsupported response.

## Testing

Use `makeFocusedApplicationContextMemoryClient()` for deterministic snapshot, watch, cleanup, and event tests without native UI. Use `makeFocusedApplicationContextUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/focused-application-context.ts`](../../../packages/native/src/focused-application-context.ts)
- Contract: [`packages/native/src/contracts/focused-application-context.ts`](../../../packages/native/src/contracts/focused-application-context.ts)
