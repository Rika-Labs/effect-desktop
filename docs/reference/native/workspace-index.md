---
title: WorkspaceIndex (native)
description: Product-neutral workspace index sessions with scoped grants, ignore rules, lifecycle events, and fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `WorkspaceIndex`

Product-neutral workspace index service. Callers open an index session for a workspace root, provide explicit filesystem read grants, set ignore rules, refresh changed paths, close the session, and subscribe to lifecycle events.

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
- `watch`: whether the host should attach file watching for the session.

The service treats `WorkspaceIndex` as an index/session primitive, not a filesystem wrapper. `Filesystem` owns file reads. `WorkspaceIndex` owns session identity, scoped grant policy, lexical root containment, ignore filtering, session lifecycle, events, and audit around index invalidation.

The TypeScript service performs a pre-transport syntax guard: paths must be absolute and must not include `.` or `..` segments. A native host adapter that implements indexing must still resolve canonical filesystem paths before reading files so symlinks and hard links cannot escape the granted root. The current Rust adapter is unsupported and does not perform file reads.

## Permissions

The service checks native invoke permission before host side effects:

- `Native.Permissions.workspaceIndex.open`
- `Native.Permissions.workspaceIndex.refresh`
- `Native.Permissions.workspaceIndex.close`

`open` also checks `filesystem.read` for the actor and validates that `scope.grants` includes a covering `filesystem.read` grant. `refresh` rejects changed paths outside the opened root before calling the client and omits ignored paths from the client payload.

## Errors

`WorkspaceIndexError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Support

The current Rust host adapter is intentionally fail-closed while native file watching and index storage are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid scopes and changed paths are rejected before the unsupported response.

## Testing

Use `makeWorkspaceIndexMemoryClient()` for deterministic open, refresh, close, and event tests without OS watchers. Use `makeWorkspaceIndexUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/workspace-index.ts`](../../../packages/native/src/workspace-index.ts)
- Contract: [`packages/native/src/contracts/workspace-index.ts`](../../../packages/native/src/contracts/workspace-index.ts)
