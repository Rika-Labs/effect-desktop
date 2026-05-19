import { expect, test } from "bun:test"
import path from "node:path"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolRequestEnvelope,
  makeHostProtocolInvalidArgumentError
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { EventJournal } from "effect/unstable/eventlog"

import {
  makeTransactionalFileMutationBridgeClientLayer,
  makeTransactionalFileMutationMemoryClient,
  makeTransactionalFileMutationServiceLayer,
  makeTransactionalFileMutationUnsupportedClient,
  TransactionalFileMutation,
  TransactionalFileMutationClient,
  type TransactionalFileMutationClientApi
} from "./transactional-file-mutation.js"
import {
  TransactionalFileMutationActor,
  TransactionalFileMutationCommitInput,
  TransactionalFileMutationCommitRequest,
  TransactionalFileMutationDiff,
  TransactionalFileMutationPrepareInput,
  TransactionalFileMutationPrepareRequest,
  TransactionalFileMutationPrepareResult,
  TransactionalFileMutationRollbackInput,
  TransactionalFileMutationRollbackResult
} from "./contracts/transactional-file-mutation.js"

const Text = new TextEncoder()
const testPath = (...segments: string[]): string =>
  path.resolve(...segments).replaceAll(path.sep, "/")
const WORKSPACE_ROOT = testPath("workspace", "app")
const WORKSPACE_FILE = testPath("workspace", "app", "src", "main.ts")
const initialFiles = (): Record<string, string> => ({ [WORKSPACE_FILE]: "old\n" })

test("TransactionalFileMutation prepares diffs, commits atomically, detects conflicts, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeTransactionalFileMutationMemoryClient({
        files: initialFiles(),
        nextMutationId: nextIdFactory(["file-mutation-1", "file-mutation-2"])
      })

      const result = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const first = yield* files.prepare(prepareRequest("first\n"))
        const second = yield* files.prepare(prepareRequest("second\n"))
        const committed = yield* files.commit(
          new TransactionalFileMutationCommitRequest({
            actor: actor(),
            mutationId: second.mutationId,
            traceId: "trace-commit-second"
          })
        )
        const conflicted = yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: first.mutationId,
              traceId: "trace-commit-first"
            })
          )
        )
        const events = yield* files.events().pipe(Stream.take(6), Stream.runCollect)
        return { committed, conflicted, events, first }
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit: memoryAudit(rows),
            nextTraceId: () => "trace-file-mutation"
          })
        )
      )

      expect(result.first).toMatchObject({
        mutationId: "file-mutation-1",
        path: WORKSPACE_FILE,
        state: "prepared"
      })
      expect(result.first.diff).toMatchObject({
        format: "unified",
        additions: 2,
        deletions: 2
      })
      expect(result.first.diff.text).toContain("-old")
      expect(result.first.diff.text).toContain("+first")
      expect(result.committed).toMatchObject({
        mutationId: "file-mutation-2",
        path: WORKSPACE_FILE,
        state: "committed",
        committed: true
      })
      expectExitFailure(result.conflicted, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidState",
          operation: "TransactionalFileMutation.commit"
        })
      })
      expect(result.events.map((event) => event.phase)).toEqual([
        "prepared",
        "prepared",
        "commit-started",
        "committed",
        "commit-started",
        "conflicted"
      ])
      expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
      expect(
        rows.some(
          (row) =>
            row.source === "TransactionalFileMutation.prepare" &&
            isCapabilityKind(row.normalizedCapability, "filesystem.write")
        )
      ).toBe(true)
    })
  ))

test("TransactionalFileMutation denies prepare before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      let calls = 0
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        prepare: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.prepare(input)))
      }

      const exit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        return yield* Effect.exit(files.prepare(prepareRequest("next\n")))
      }).pipe(Effect.provide(makeTransactionalFileMutationServiceLayer(client, { permissions })))

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "TransactionalFileMutation.prepare"
        })
      })
    })
  ))

test("TransactionalFileMutation rejects duplicate memory mutation IDs without overwriting the prepared mutation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      const first = yield* client.prepare(prepareInput("first\n", "same-mutation"))
      const duplicate = yield* Effect.exit(
        client.prepare(prepareInput("second\n", "same-mutation"))
      )

      yield* client.commit(
        new TransactionalFileMutationCommitInput({
          actor: actor(),
          mutationId: first.mutationId
        })
      )
      const next = yield* client.prepare(
        new TransactionalFileMutationPrepareInput({
          actor: actor(),
          path: WORKSPACE_FILE,
          replacementBytes: bytes("third\n"),
          expectedSourceHash: first.replacementHash,
          mutationId: "next-mutation"
        })
      )

      expectExitFailure(duplicate, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "TransactionalFileMutation.prepare"
        })
      })
      expect(next.mutationId).toBe("next-mutation")
    })
  ))

test("TransactionalFileMutation claims a prepared mutation before concurrent commits reach the client", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let commitCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        commit: (input) =>
          Effect.sync(() => {
            commitCalls += 1
          }).pipe(
            Effect.andThen(Effect.sleep("20 millis")),
            Effect.andThen(baseClient.commit(input))
          )
      }

      const result = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(prepareRequest("next\n"))
        const request = () =>
          new TransactionalFileMutationCommitRequest({
            actor: actor(),
            mutationId: prepared.mutationId
          })
        return yield* Effect.all(
          [Effect.exit(files.commit(request())), Effect.exit(files.commit(request()))],
          { concurrency: "unbounded" }
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(commitCalls).toBe(1)
      expect(result.filter(Exit.isSuccess)).toHaveLength(1)
      expect(result.filter(Exit.isFailure)).toHaveLength(1)
    })
  ))

test("TransactionalFileMutation registers or rolls back host prepare when interrupted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const prepareEntered = yield* Deferred.make<void>()
      const releasePrepare = yield* Deferred.make<void>()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let prepareCalls = 0
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        prepare: (input) =>
          Effect.sync(() => {
            prepareCalls += 1
          }).pipe(
            Effect.andThen(Deferred.succeed(prepareEntered, undefined)),
            Effect.andThen(Deferred.await(releasePrepare)),
            Effect.andThen(baseClient.prepare(input))
          ),
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(Effect.andThen(baseClient.rollback(input)))
      }

      const commitExit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepareFiber = yield* files
          .prepare(
            new TransactionalFileMutationPrepareRequest({
              actor: actor(),
              path: WORKSPACE_FILE,
              replacementBytes: bytes("next\n"),
              mutationId: "interrupted-prepare",
              ownerScope: "scope-workspace"
            })
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(prepareEntered)
        const interruptFiber = yield* Fiber.interrupt(prepareFiber).pipe(
          Effect.forkChild({ startImmediately: true })
        )
        yield* Deferred.succeed(releasePrepare, undefined)
        yield* Fiber.join(interruptFiber)
        yield* resources.closeScope("scope-workspace")
        return yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: "interrupted-prepare"
            })
          )
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            resources,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(prepareCalls).toBe(1)
      expect(rollbackCalls).toBe(1)
      expectExitFailure(commitExit, (error) => {
        expect(error).toMatchObject({
          tag: "NotFound",
          operation: "TransactionalFileMutation.commit"
        })
      })
    })
  ))

test("TransactionalFileMutation disposes the actual registered resource id after fallback allocation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const requestedResourceId = makeResourceId("transactional-file-mutation-colliding-mutation")
      const fallbackResourceId = makeResourceId("transactional-file-mutation-fallback-resource")
      let collidingResourceDisposed = 0
      const resources = yield* makeResourceRegistry({
        nextId: () => fallbackResourceId
      })
      yield* resources.register({
        kind: "test-collision",
        id: requestedResourceId,
        ownerScope: "scope-other",
        state: "open",
        dispose: Effect.sync(() => {
          collidingResourceDisposed += 1
        })
      })
      const client = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })

      const snapshot = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(
          new TransactionalFileMutationPrepareRequest({
            actor: actor(),
            path: WORKSPACE_FILE,
            replacementBytes: bytes("next\n"),
            mutationId: "colliding-mutation",
            ownerScope: "scope-workspace"
          })
        )
        yield* files.commit(
          new TransactionalFileMutationCommitRequest({
            actor: actor(),
            mutationId: prepared.mutationId
          })
        )
        return yield* resources.list()
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            resources,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(collidingResourceDisposed).toBe(0)
      expect(snapshot.entries.map((entry) => entry.handle.id)).toEqual([requestedResourceId])
    })
  ))

test("TransactionalFileMutation restores a commit claim when interrupted before host commit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const auditEntered = yield* Deferred.make<void>()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let commitCalls = 0
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        commit: (input) =>
          Effect.sync(() => {
            commitCalls += 1
          }).pipe(Effect.andThen(baseClient.commit(input))),
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(Effect.andThen(baseClient.rollback(input)))
      }
      const audit = blockingAuditFor(rows, "TransactionalFileMutation.commit", auditEntered)

      const rollbackExit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(prepareRequest("next\n"))
        const commitFiber = yield* files
          .commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(auditEntered)
        yield* Fiber.interrupt(commitFiber)
        return yield* Effect.exit(
          files.rollback(
            new TransactionalFileMutationRollbackInput({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit
          })
        )
      )

      expect(commitCalls).toBe(0)
      expect(rollbackCalls).toBe(1)
      expect(Exit.isSuccess(rollbackExit)).toBe(true)
    })
  ))

test("TransactionalFileMutation restores a rollback claim when interrupted before host rollback", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const auditEntered = yield* Deferred.make<void>()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let commitCalls = 0
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        commit: (input) =>
          Effect.sync(() => {
            commitCalls += 1
          }).pipe(Effect.andThen(baseClient.commit(input))),
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(Effect.andThen(baseClient.rollback(input)))
      }
      const audit = blockingAuditFor(rows, "TransactionalFileMutation.rollback", auditEntered)

      const commitExit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(prepareRequest("next\n"))
        const rollbackFiber = yield* files
          .rollback(
            new TransactionalFileMutationRollbackInput({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(auditEntered)
        yield* Fiber.interrupt(rollbackFiber)
        return yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit
          })
        )
      )

      expect(rollbackCalls).toBe(0)
      expect(commitCalls).toBe(1)
      expect(Exit.isSuccess(commitExit)).toBe(true)
    })
  ))

test("TransactionalFileMutation does not let owner-scope cleanup rollback an in-flight commit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const commitEntered = yield* Deferred.make<void>()
      const releaseCommit = yield* Deferred.make<void>()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        commit: (input) =>
          Deferred.succeed(commitEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCommit)),
            Effect.andThen(baseClient.commit(input))
          ),
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(Effect.andThen(baseClient.rollback(input)))
      }

      const result = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(
          new TransactionalFileMutationPrepareRequest({
            actor: actor(),
            path: WORKSPACE_FILE,
            replacementBytes: bytes("next\n"),
            ownerScope: "scope-workspace"
          })
        )
        const commitFiber = yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        ).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(commitEntered)
        yield* resources.closeScope("scope-workspace")
        yield* Deferred.succeed(releaseCommit, undefined)
        return yield* Fiber.join(commitFiber)
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            resources,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(rollbackCalls).toBe(0)
      expect(Exit.isSuccess(result)).toBe(true)
    })
  ))

test("TransactionalFileMutation does not restore a failed commit after owner-scope cleanup", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const commitEntered = yield* Deferred.make<void>()
      const releaseCommit = yield* Deferred.make<void>()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        commit: (input) =>
          Deferred.succeed(commitEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCommit)),
            Effect.andThen(baseClient.commit(input))
          ),
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(Effect.andThen(baseClient.rollback(input)))
      }

      const result = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(
          new TransactionalFileMutationPrepareRequest({
            actor: actor(),
            path: WORKSPACE_FILE,
            replacementBytes: bytes("next\n"),
            ownerScope: "scope-workspace"
          })
        )
        const commitFiber = yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId,
              expectedSourceHash: "fnv1a-wrong"
            })
          )
        ).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(commitEntered)
        yield* resources.closeScope("scope-workspace")
        yield* Deferred.succeed(releaseCommit, undefined)
        const commitExit = yield* Fiber.join(commitFiber)
        const retryExit = yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        )
        return { commitExit, retryExit }
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            resources,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(rollbackCalls).toBe(1)
      expectExitFailure(result.commitExit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidState",
          operation: "TransactionalFileMutation.commit"
        })
      })
      expectExitFailure(result.retryExit, (error) => {
        expect(error).toMatchObject({
          tag: "NotFound",
          operation: "TransactionalFileMutation.commit"
        })
      })
    })
  ))

test("TransactionalFileMutation does not restore a failed rollback after owner-scope cleanup", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const rollbackEntered = yield* Deferred.make<void>()
      const releaseRollback = yield* Deferred.make<void>()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        rollback: () =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(
            Effect.andThen(Deferred.succeed(rollbackEntered, undefined)),
            Effect.andThen(Deferred.await(releaseRollback)),
            Effect.andThen(
              Effect.fail(
                makeHostProtocolInvalidArgumentError(
                  "mutationId",
                  "rollback failed",
                  "TransactionalFileMutation.rollback"
                )
              )
            )
          )
      }

      const result = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(
          new TransactionalFileMutationPrepareRequest({
            actor: actor(),
            path: WORKSPACE_FILE,
            replacementBytes: bytes("next\n"),
            ownerScope: "scope-workspace"
          })
        )
        const rollbackFiber = yield* Effect.exit(
          files.rollback(
            new TransactionalFileMutationRollbackInput({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        ).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(rollbackEntered)
        yield* resources.closeScope("scope-workspace")
        yield* Deferred.succeed(releaseRollback, undefined)
        const rollbackExit = yield* Fiber.join(rollbackFiber)
        const retryExit = yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        )
        return { retryExit, rollbackExit }
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            resources,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(rollbackCalls).toBe(1)
      expectExitFailure(result.rollbackExit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "TransactionalFileMutation.rollback"
        })
      })
      expectExitFailure(result.retryExit, (error) => {
        expect(error).toMatchObject({
          tag: "NotFound",
          operation: "TransactionalFileMutation.commit"
        })
      })
    })
  ))

test("TransactionalFileMutation rolls back prepared mutations when their resource scope closes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(Effect.andThen(baseClient.rollback(input)))
      }

      const commitExit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        const prepared = yield* files.prepare(
          new TransactionalFileMutationPrepareRequest({
            actor: actor(),
            path: WORKSPACE_FILE,
            replacementBytes: bytes("next\n"),
            ownerScope: "scope-workspace"
          })
        )
        yield* resources.closeScope("scope-workspace")
        return yield* Effect.exit(
          files.commit(
            new TransactionalFileMutationCommitRequest({
              actor: actor(),
              mutationId: prepared.mutationId
            })
          )
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            resources,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(rollbackCalls).toBe(1)
      expectExitFailure(commitExit, (error) => {
        expect(error).toMatchObject({
          tag: "NotFound",
          operation: "TransactionalFileMutation.commit"
        })
      })
    })
  ))

test("TransactionalFileMutation rolls back host state when a returned mutation ID collides locally", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let rollbackCalls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        prepare: (input) =>
          Effect.succeed(
            new TransactionalFileMutationPrepareResult({
              mutationId: "duplicate-mutation",
              path: input.path,
              state: "prepared",
              ownerScope: input.ownerScope ?? "scope-workspace",
              sourceHash: "fnv1a-source",
              replacementHash: "fnv1a-next",
              diff: new TransactionalFileMutationDiff({
                format: "unified",
                text: "",
                additions: 0,
                deletions: 0
              })
            })
          ),
        rollback: (input) =>
          Effect.sync(() => {
            rollbackCalls += 1
          }).pipe(
            Effect.as(
              new TransactionalFileMutationRollbackResult({
                mutationId: input.mutationId,
                path: WORKSPACE_FILE,
                state: "rolled-back",
                rolledBack: true
              })
            )
          )
      }

      const duplicate = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        yield* files.prepare(prepareRequest("first\n"))
        return yield* Effect.exit(files.prepare(prepareRequest("second\n")))
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(rollbackCalls).toBe(1)
      expectExitFailure(duplicate, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "TransactionalFileMutation.prepare"
        })
      })
    })
  ))

test("TransactionalFileMutation uses one generated trace for prepare permission audits", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })

      yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        return yield* files.prepare(
          new TransactionalFileMutationPrepareRequest({
            actor: actor(),
            path: WORKSPACE_FILE,
            replacementBytes: bytes("next\n")
          })
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit: memoryAudit(rows),
            nextTraceId: () => "trace-generated"
          })
        )
      )

      const prepareAudits = rows.filter(
        (row) =>
          row.source === "TransactionalFileMutation.prepare" && row.kind === "permission-used"
      )
      expect(prepareAudits).not.toHaveLength(0)
      expect(prepareAudits.every((row) => row.traceId === "trace-generated")).toBe(true)
    })
  ))

test("TransactionalFileMutation rejects blank owner scopes before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      let calls = 0
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        prepare: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.prepare(input)))
      }

      const exit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        return yield* Effect.exit(
          files.prepare(
            new TransactionalFileMutationPrepareRequest({
              actor: actor(),
              path: WORKSPACE_FILE,
              replacementBytes: bytes("next\n"),
              ownerScope: " "
            })
          )
        )
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit: memoryAudit(rows)
          })
        )
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "TransactionalFileMutation.prepare"
        })
      })
    })
  ))

test("TransactionalFileMutation audit failures stop host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      let calls = 0
      const baseClient = yield* makeTransactionalFileMutationMemoryClient({ files: initialFiles() })
      const client: TransactionalFileMutationClientApi = {
        ...baseClient,
        prepare: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.prepare(input)))
      }

      const exit = yield* Effect.gen(function* () {
        const files = yield* TransactionalFileMutation
        return yield* Effect.exit(files.prepare(prepareRequest("next\n")))
      }).pipe(
        Effect.provide(
          makeTransactionalFileMutationServiceLayer(client, {
            permissions,
            audit: failingAuditFor("TransactionalFileMutation.prepare")
          })
        )
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Internal" })
      })
    })
  ))

test("TransactionalFileMutation rejects malformed paths before bridge transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: {
              mutationId: "file-mutation-1",
              path: WORKSPACE_FILE,
              state: "prepared",
              ownerScope: "scope-workspace",
              sourceHash: "fnv1a-source",
              replacementHash: "fnv1a-next",
              diff: { format: "unified", text: "", additions: 0, deletions: 0 }
            }
          })
        },
        subscribe: () => Stream.empty
      }

      const malformedPaths = [
        "relative/path.ts",
        ...(process.platform === "win32" ? [] : ["C:/workspace/app/src/main.ts"])
      ]

      for (const path of malformedPaths) {
        const exit = yield* Effect.gen(function* () {
          const client = yield* TransactionalFileMutationClient
          return yield* Effect.exit(
            client.prepare(
              new TransactionalFileMutationPrepareInput({
                actor: actor(),
                path,
                replacementBytes: bytes("next\n")
              })
            )
          )
        }).pipe(Effect.provide(makeTransactionalFileMutationBridgeClientLayer(exchange)))

        expectExitFailure(exit, (error) => {
          expect(error).toMatchObject({
            tag: "InvalidArgument",
            operation: "TransactionalFileMutation.prepare"
          })
        })
      }
      expect(requests).toEqual([])
    })
  ))

test("TransactionalFileMutation unsupported client exposes typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeTransactionalFileMutationUnsupportedClient()
      const prepareExit = yield* Effect.exit(client.prepare(prepareInput("next\n")))
      const commitExit = yield* Effect.exit(
        client.commit(
          new TransactionalFileMutationCommitInput({
            actor: actor(),
            mutationId: "file-mutation-1"
          })
        )
      )
      const rollbackExit = yield* Effect.exit(
        client.rollback(
          new TransactionalFileMutationRollbackInput({
            actor: actor(),
            mutationId: "file-mutation-1"
          })
        )
      )

      for (const exit of [prepareExit, commitExit, rollbackExit]) {
        expectExitFailure(exit, (error) => {
          expect(error).toMatchObject({ tag: "Unsupported" })
        })
      }
      const supported = yield* client.isSupported()
      expect(supported.supported).toBe(false)
    })
  ))

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
    yield* Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "TransactionalFileMutation", methods: ["prepare"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "TransactionalFileMutation", methods: ["commit"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "TransactionalFileMutation", methods: ["rollback"] })
      ),
      permissions.declare(P.filesystemRead({ roots: [WORKSPACE_ROOT] })),
      permissions.declare(P.filesystemWrite({ roots: [WORKSPACE_ROOT] }))
    ])
    return permissions
  })

const actor = (): TransactionalFileMutationActor =>
  new TransactionalFileMutationActor({ kind: "workspace", id: "workspace-1" })

const prepareRequest = (
  content: string,
  mutationId?: string
): TransactionalFileMutationPrepareRequest =>
  new TransactionalFileMutationPrepareRequest({
    actor: actor(),
    path: WORKSPACE_FILE,
    replacementBytes: bytes(content),
    ...(mutationId === undefined ? {} : { mutationId }),
    traceId: "trace-prepare"
  })

const prepareInput = (
  content: string,
  mutationId?: string
): TransactionalFileMutationPrepareInput =>
  new TransactionalFileMutationPrepareInput({
    actor: actor(),
    path: WORKSPACE_FILE,
    replacementBytes: bytes(content),
    ...(mutationId === undefined ? {} : { mutationId }),
    traceId: "trace-prepare"
  })

const bytes = (content: string): Uint8Array => Text.encode(content)

const nextIdFactory = (ids: readonly string[]): (() => string) => {
  let index = 0
  return () => {
    const id = ids[index]
    index += 1
    return id ?? `file-mutation-${index}`
  }
}

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const blockingAuditFor = (
  rows: AuditEvent[],
  source: string,
  entered: Deferred.Deferred<void>
): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    event.source === source && event.kind === "permission-used"
      ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
      : memoryAudit(rows).emit(event),
  observe: () => Stream.fromIterable(rows)
})

const failingAuditFor = (source: string): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    event.source === source
      ? Effect.fail(
          new EventJournal.EventJournalError({
            method: "EventJournal.write",
            cause: new Error("journal full")
          })
        )
      : Effect.void,
  observe: () => Stream.empty
})

const isCapabilityKind = (value: unknown, kind: string): boolean =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === kind

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}
