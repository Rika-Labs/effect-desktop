---
title: TransactionalFileMutation (native)
description: Product-neutral file mutation prepare, diff, commit, rollback, conflict detection, lifecycle events, and fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `TransactionalFileMutation`

Product-neutral transactional file mutation service. Callers prepare a replacement for one absolute file path, inspect the unified diff and source hash, commit only if the source has not changed, roll back a prepared mutation, and subscribe to lifecycle events.

The public service is Layer-first and test-substitutable. It validates Schema contracts before transport, checks native invoke and filesystem read/write permissions before privileged work, emits audit rows before host work, exposes typed lifecycle events, and maps stale-source commits to typed `InvalidState` failures.

## Methods

| Method        | Payload                                                                         | Success                                                                      |
| ------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `prepare`     | `{ actor, path, replacementBytes, expectedSourceHash?, mutationId?, traceId? }` | `{ mutationId, path, state: "prepared", sourceHash, replacementHash, diff }` |
| `commit`      | `{ actor, mutationId, expectedSourceHash?, traceId? }`                          | `{ mutationId, path, state: "committed", committed }`                        |
| `rollback`    | `{ actor, mutationId, traceId? }`                                               | `{ mutationId, path, state: "rolled-back", rolledBack }`                     |
| `isSupported` | `void`                                                                          | `{ supported, reason? }`                                                     |
| `events`      | `void`                                                                          | stream of mutation lifecycle events                                          |

## Semantics

`prepare` records the source hash and replacement hash and returns a unified diff. `commit` rechecks the source hash before applying the replacement; if another mutation or process changed the source, the service emits a `conflicted` event and fails with `InvalidState`. `rollback` removes the prepared mutation without touching the file.

The service is not a thin filesystem wrapper. `Filesystem` owns raw reads and atomic writes. `TransactionalFileMutation` owns mutation identity, prepare/commit/rollback state, diff exposure, stale-source conflict detection, lifecycle events, and audit ordering around reviewable file replacement.

The TypeScript service performs a pre-transport syntax guard: paths must be absolute and must not include `.` or `..` segments. A native host adapter that implements commits must still resolve canonical filesystem paths before touching files so symlinks and hard links cannot escape the granted root. The current Rust adapter is unsupported and does not mutate files.

## Permissions

The service checks native invoke permission before host side effects:

- `Native.Permissions.transactionalFileMutation.prepare`
- `Native.Permissions.transactionalFileMutation.commit`
- `Native.Permissions.transactionalFileMutation.rollback`

`prepare` and `commit` also check `filesystem.read` and `filesystem.write` covering the target path. `rollback` checks native invoke permission because it only removes a prepared mutation.

## Errors

`TransactionalFileMutationError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, missing mutations, stale source conflicts, and host failures are typed tagged failures.

## Support

The current Rust host adapter is intentionally fail-closed while native commit storage and atomic replacement are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid paths and mutation identifiers are rejected before the unsupported response.

## Testing

Use `makeTransactionalFileMutationMemoryClient()` for deterministic prepare, commit, rollback, conflict, and event tests without native filesystem writes. Use `makeTransactionalFileMutationUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/transactional-file-mutation.ts`](../../../packages/native/src/transactional-file-mutation.ts)
- Contract: [`packages/native/src/contracts/transactional-file-mutation.ts`](../../../packages/native/src/contracts/transactional-file-mutation.ts)
