---
title: WorkspaceIndex (native)
description: Product-neutral workspace index sessions with scoped grants, ignore rules, lifecycle events, and fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `WorkspaceIndex`

Product-neutral workspace index service. Callers open an index session for a workspace root, provide explicit filesystem read grants, set ignore rules, refresh changed paths, close the session, and subscribe to lifecycle events through the canonical `WorkspaceIndex.events.Event` RPC stream.

The public service is Layer-first and test-substitutable. It validates Schema contracts before transport, checks native invoke and filesystem read permissions before privileged work, filters ignored paths before the host client sees them, rejects non-canonical path syntax and lexical paths outside the indexed root, emits typed lifecycle events, and records audit rows for privileged use and denial before host work.

## Methods

| Method        | Payload                                | Success                                             |
| ------------- | -------------------------------------- | --------------------------------------------------- |
| `open`        | `{ actor, scope, indexId?, traceId? }` | `{ indexId, root, state: "opened" }`                |
| `refresh`     | `{ indexId, changedPaths?, traceId? }` | `{ indexId, state, indexed, invalidated, ignored }` |
| `close`       | `{ indexId, traceId? }`                | `{ indexId, closed }`                               |
| `isSupported` | `void`                                 | `{ supported, reason? }`                            |
| `events`      | `void`                                 | stream of workspace index lifecycle events          |

## Scope

`open` receives a scope:

- `root`: absolute workspace root.
- `ignoreRules`: relative ignore patterns such as `node_modules/**`.
- `grants`: normalized permissions that must include `filesystem.read` covering `root`.
- `watch`: reserved for future background host watching; pass `false` for the current explicit-refresh adapter.

The service treats `WorkspaceIndex` as an index/session primitive, not a filesystem wrapper. `Filesystem` owns file reads. `WorkspaceIndex` owns session identity, scoped grant policy, lexical root containment, ignore filtering, session lifecycle, events, and audit around index invalidation.

The TypeScript service performs a pre-transport syntax guard: paths must be absolute and must not include `.` or `..` segments. The Rust host adapter resolves canonical filesystem paths before indexing entries so symlinks cannot escape the granted root. The adapter records paths and lifecycle state; it does not read file contents or provide semantic search.

## Permissions

The service checks native invoke permission before host side effects:

- `Native.Permissions.workspaceIndex.open`
- `Native.Permissions.workspaceIndex.refresh`
- `Native.Permissions.workspaceIndex.close`

`open` also checks `filesystem.read` for the actor and validates that `scope.grants` includes a covering `filesystem.read` grant. `refresh` rejects changed paths outside the opened root before calling the client and omits ignored paths from the client payload.

## Events

`events()` consumes the canonical `WorkspaceIndex.events.Event` RPC stream and
emits typed workspace index lifecycle events. The native/web bridge maps this
stream to the existing host event method `WorkspaceIndex.Event` at the boundary.
Event payloads are Schema-decoded before application code sees them.

## Errors

`WorkspaceIndexError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Host Behavior

The Rust host adapter keeps index sessions in host process memory. `open` canonicalizes the workspace root, verifies a canonical `filesystem.read` grant covers it, scans file and directory entries, applies ignore rules, and emits `opened`, `entry-indexed`, and `refresh-completed` events. `refresh` rescans all entries when `changedPaths` is omitted, or reconciles explicit changed paths when provided. Missing changed paths emit invalidation events. `close` removes the in-memory session and emits `closed`.

`watch: true` is rejected with a typed unsupported error until the host owns a real watcher lifecycle. The current adapter is explicit-refresh based and does not install a background OS watcher.

## Support

| Platform | Status      | Reason |
| -------- | ----------- | ------ |
| macOS    | `supported` |        |
| Windows  | `supported` |        |
| Linux    | `supported` |        |

`isSupported` returns `{ supported: true }`. Mutating host requests decode and validate payloads before filesystem access. Invalid scopes, non-canonical paths, missing sessions, out-of-root refresh paths, and symlink escapes are typed host protocol failures.

## Testing

Use `makeWorkspaceIndexMemoryClient()` for deterministic open, refresh, close, and event tests without OS watchers. Use `makeWorkspaceIndexUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/workspace-index.ts`](../../../packages/native/src/workspace-index.ts)
- Contract: [`packages/native/src/contracts/workspace-index.ts`](../../../packages/native/src/contracts/workspace-index.ts)
