---
title: TransactionalFileMutation (native)
description: Product-neutral file mutation prepare, diff, commit, rollback, conflict detection, lifecycle events, and host-backed replacement behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `TransactionalFileMutation`

Product-neutral transactional file mutation service. Callers prepare a replacement for one absolute file path, inspect the unified diff and source hash, commit only if the source has not changed, roll back a prepared mutation, and subscribe to lifecycle events.

The public service is Layer-first and test-substitutable. It validates Schema contracts before transport, checks native invoke and filesystem read/write permissions before privileged work, emits audit rows before host work, exposes typed lifecycle events, and maps stale-source commits to typed `InvalidState` failures.

`events()` is exposed as the canonical `TransactionalFileMutation.events.Event` RPC stream. The bridge client keeps translating that contract to the existing host event channel `TransactionalFileMutation.Event`, so direct clients consume the Effect RPC stream while the native/web boundary preserves the current wire method.

## Methods

| Method        | Payload                                                                                      | Success                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `prepare`     | `{ actor, path, replacementBytes, expectedSourceHash?, mutationId?, ownerScope?, traceId? }` | `{ mutationId, path, state: "prepared", ownerScope, sourceHash, replacementHash, diff }` |
| `commit`      | `{ actor, mutationId, expectedSourceHash?, traceId? }`                                       | `{ mutationId, path, state: "committed", committed }`                                    |
| `rollback`    | `{ actor, mutationId, traceId? }`                                                            | `{ mutationId, path, state: "rolled-back", rolledBack }`                                 |
| `isSupported` | `void`                                                                                       | `{ supported, reason? }`                                                                 |
| `events`      | `void`                                                                                       | stream of mutation lifecycle events                                                      |

## Semantics

`prepare` records the source hash and replacement hash and returns a review diff. The hash strings are opaque tokens; callers may compare tokens they received from this service, but must not depend on a specific algorithm. `commit` rechecks the source hash before applying the replacement, atomically captures the reviewed source out of the destination path, validates the captured bytes, then installs the replacement only if no file has recreated the destination path. If another mutation or process changed the source, the service emits a `conflicted` event and fails with `InvalidState`. `rollback` removes the prepared mutation without touching the file.

Prepared mutations are registered in `ResourceRegistry` under `ownerScope`. Closing that scope rolls back the prepared mutation, so abandoned renderer, workspace, or actor scopes do not leave commit-capable state behind. If callers omit `ownerScope`, the service derives a scope from the actor kind and id.

After the host prepare call begins, host state creation and local `ResourceRegistry` ownership are one uninterruptible section. The service stores the actual registered resource id, including fallback ids allocated after a collision, so terminal cleanup disposes the owned mutation resource. Terminal operations claim prepared state before authorization and audit work. If a commit or rollback fiber is interrupted before the host terminal call begins, the service restores the prepared claim so the mutation can still be committed or rolled back. Once the host terminal call starts, the host call and local cleanup run as one uninterruptible terminal section.

The service is not a thin filesystem wrapper. `Filesystem` owns raw reads and atomic writes. `TransactionalFileMutation` owns mutation identity, prepare/commit/rollback state, review diff exposure, stale-source conflict detection, lifecycle events, resource cleanup, and audit ordering around reviewable file replacement.

The diff payload currently uses `format: "unified"` for compatibility with review UIs, but the memory client emits a full old/new review diff instead of a minimal patch. Treat it as display text, not as an apply-ready patch.

The TypeScript service performs a pre-transport syntax guard: paths must be absolute for the current platform and must not include `.` or `..` segments. Unix accepts `/...` paths. Windows accepts only drive-letter absolute paths such as `C:/...` or `C:\...`; current-drive-rooted `/...` paths are rejected. The Rust host adapter repeats that validation before touching files, rejects UNC paths, stores prepared mutations with their owner scope in a process-local registry, and applies commits through same-directory temporary files. The host captures the reviewed source with `rename`, validates the captured source, and creates the replacement path with an atomic hard link that fails if another writer recreated the path first.

## Permissions

The service checks native invoke permission before host side effects:

- `Native.Permissions.transactionalFileMutation.prepare`
- `Native.Permissions.transactionalFileMutation.commit`
- `Native.Permissions.transactionalFileMutation.rollback`

`prepare` and `commit` also check `filesystem.read` and `filesystem.write` covering the target path. `rollback` checks native invoke permission because it only removes a prepared mutation.

## Errors

`TransactionalFileMutationError` is the canonical host protocol error union. Permission denial, invalid input, missing mutations, stale source conflicts, and host failures are typed tagged failures.

## Support

The Rust host adapter supports local filesystem prepare, commit, rollback, and stale-source conflict detection.

| Platform | Status      | Notes                                        |
| -------- | ----------- | -------------------------------------------- |
| macOS    | `supported` | source capture plus atomic hard-link install |
| Windows  | `supported` | source capture plus atomic hard-link install |
| Linux    | `supported` | source capture plus atomic hard-link install |

`isSupported` returns `{ supported: true }`. Mutating host requests decode and validate payloads before filesystem reads, registry writes, or replacement commits.

## Testing

Use `makeTransactionalFileMutationMemoryClient()` for deterministic prepare, commit, rollback, conflict, and event tests without native filesystem writes. Use `makeTransactionalFileMutationUnsupportedClient()` when a test needs the typed unsupported path.

## Architecture-debt sweep

The legacy `TransactionalFileMutationRpcEvents` side object has been removed. Mutation lifecycle events now live in the same `RpcGroup` contract as request/response methods. Direct clients use the canonical RPC stream; bridge-specific host event naming stays local to the bridge client adapter.

`TransactionalFileMutationServiceApi` and `makeTransactionalFileMutationServiceLayer` remain public because they own service-only prepare/commit/rollback policy, permission and audit ordering, resource cleanup, stale-source conflict handling, and deterministic test composition.

## Related

- Source: [`packages/native/src/transactional-file-mutation.ts`](../../../packages/native/src/transactional-file-mutation.ts)
- Contract: [`packages/native/src/contracts/transactional-file-mutation.ts`](../../../packages/native/src/contracts/transactional-file-mutation.ts)
