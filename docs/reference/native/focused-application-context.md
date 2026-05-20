---
title: FocusedApplicationContext (native)
description: Product-neutral focused app, window, process, and display metadata broker.
kind: reference
audience: app-developers
effect_version: 4
---

# `FocusedApplicationContext`

Product-neutral broker for the focused desktop surface. Snapshots expose application, window, process, package, and display metadata only.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before host side effects, audits privileged use, records security-relevant failures, and emits typed events.

## Methods

The callable RPCs on this surface are the metadata snapshot and the support query:

| Method        | Payload               | Success                                          |
| ------------- | --------------------- | ------------------------------------------------ |
| `snapshot`    | `{ actor, traceId? }` | `{ application, window?, display?, observedAt }` |
| `isSupported` | `void`                | `{ supported, reason? }`                         |
| `events`      | `void`                | stream of focused context events                 |

## Capability facts (non-callable)

`watch` and `stopWatching` are not callable RPCs. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` and reason `host-adapter-unimplemented`, but no host adapter can be invoked. They describe the intended watch lifecycle until the host can publish focus lifecycle events.

| Capability fact | Intended role                                   |
| --------------- | ----------------------------------------------- |
| `watch`         | Start a long-lived focused-context watch.       |
| `stopWatching`  | Stop a previously started watch and release it. |

## Snapshot

The snapshot is metadata only:

- `application`: stable app id plus optional name, bundle id, package name, executable path, and process id
- `window`: optional window id, title, bounds, and display id
- `display`: optional display id, bounds, and scale factor
- `observedAt`: host observation timestamp

## Support

The Rust host adapter now implements `snapshot` on macOS through `NSWorkspace.frontmostApplication`.
That path reports focused application metadata only; focused window/display metadata, watch lifecycle, and host-originated focus events remain unsupported.

| Method / fact  | macOS                                          | Windows       | Linux         |
| -------------- | ---------------------------------------------- | ------------- | ------------- |
| `snapshot`     | `partial` (`macos-frontmost-application-only`) | `unsupported` | `unsupported` |
| `watch`        | `unsupported` (capability fact)                | `unsupported` | `unsupported` |
| `stopWatching` | `unsupported` (capability fact)                | `unsupported` | `unsupported` |

`isSupported` still returns `{ supported: false, reason: "host-adapter-unimplemented" }` until the host provides snapshot, watch lifecycle, and event delivery for the surface. The `watch` and `stopWatching` capability facts carry `support.status: "unsupported"` with reason `host-adapter-unimplemented` and are not invocable.
The bridge-backed `FocusedApplicationContext.Event` stream also fails as typed `Unsupported` before opening a host subscription until the native watch adapter can publish focus lifecycle events.

## Testing

Use `makeFocusedApplicationContextMemoryClient()` for deterministic snapshot and event tests without native UI. Use `makeFocusedApplicationContextUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/focused-application-context.ts`](../../../packages/native/src/focused-application-context.ts)
- Contract: [`packages/native/src/contracts/focused-application-context.ts`](../../../packages/native/src/contracts/focused-application-context.ts)
