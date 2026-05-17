import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolRequestEnvelope
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"
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
  TransactionalFileMutationPrepareInput,
  TransactionalFileMutationPrepareRequest,
  TransactionalFileMutationRollbackInput
} from "./contracts/transactional-file-mutation.js"

const Text = new TextEncoder()

test("TransactionalFileMutation prepares diffs, commits atomically, detects conflicts, emits events, and audits use", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const client = await Effect.runPromise(
    makeTransactionalFileMutationMemoryClient({
      files: { "/workspace/app/src/main.ts": "old\n" },
      nextMutationId: nextIdFactory(["file-mutation-1", "file-mutation-2"])
    })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
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
  )

  expect(result.first).toMatchObject({
    mutationId: "file-mutation-1",
    path: "/workspace/app/src/main.ts",
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
    path: "/workspace/app/src/main.ts",
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

test("TransactionalFileMutation denies prepare before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let calls = 0
  const baseClient = await Effect.runPromise(
    makeTransactionalFileMutationMemoryClient({ files: { "/workspace/app/src/main.ts": "old\n" } })
  )
  const client: TransactionalFileMutationClientApi = {
    ...baseClient,
    prepare: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.prepare(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const files = yield* TransactionalFileMutation
      return yield* Effect.exit(files.prepare(prepareRequest("next\n")))
    }).pipe(Effect.provide(makeTransactionalFileMutationServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "PermissionDenied",
      operation: "TransactionalFileMutation.prepare"
    })
  })
})

test("TransactionalFileMutation audit failures stop host side effects", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  let calls = 0
  const baseClient = await Effect.runPromise(
    makeTransactionalFileMutationMemoryClient({ files: { "/workspace/app/src/main.ts": "old\n" } })
  )
  const client: TransactionalFileMutationClientApi = {
    ...baseClient,
    prepare: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.prepare(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
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
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal" })
  })
})

test("TransactionalFileMutation rejects malformed paths before bridge transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: {
          mutationId: "file-mutation-1",
          path: "/workspace/app/src/main.ts",
          state: "prepared",
          sourceHash: "fnv1a-source",
          replacementHash: "fnv1a-next",
          diff: { format: "unified", text: "", additions: 0, deletions: 0 }
        }
      })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* TransactionalFileMutationClient
      return yield* Effect.exit(
        client.prepare(
          new TransactionalFileMutationPrepareInput({
            actor: actor(),
            path: "relative/path.ts",
            replacementBytes: bytes("next\n")
          })
        )
      )
    }).pipe(Effect.provide(makeTransactionalFileMutationBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "TransactionalFileMutation.prepare"
    })
  })
})

test("TransactionalFileMutation unsupported client exposes typed unsupported failures", async () => {
  const client = makeTransactionalFileMutationUnsupportedClient()
  const prepareExit = await Effect.runPromise(Effect.exit(client.prepare(prepareInput("next\n"))))
  const commitExit = await Effect.runPromise(
    Effect.exit(
      client.commit(
        new TransactionalFileMutationCommitInput({
          actor: actor(),
          mutationId: "file-mutation-1"
        })
      )
    )
  )
  const rollbackExit = await Effect.runPromise(
    Effect.exit(
      client.rollback(
        new TransactionalFileMutationRollbackInput({
          actor: actor(),
          mutationId: "file-mutation-1"
        })
      )
    )
  )

  for (const exit of [prepareExit, commitExit, rollbackExit]) {
    expectExitFailure(exit, (error) => {
      expect(error).toMatchObject({ tag: "Unsupported" })
    })
  }
  const supported = await Effect.runPromise(client.isSupported())
  expect(supported.supported).toBe(false)
})

const configuredPermissions = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  await Effect.runPromise(
    Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "TransactionalFileMutation", methods: ["prepare"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "TransactionalFileMutation", methods: ["commit"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "TransactionalFileMutation", methods: ["rollback"] })
      ),
      permissions.declare(P.filesystemRead({ roots: ["/workspace/app"] })),
      permissions.declare(P.filesystemWrite({ roots: ["/workspace/app"] }))
    ])
  )
  return permissions
}

const actor = (): TransactionalFileMutationActor =>
  new TransactionalFileMutationActor({ kind: "workspace", id: "workspace-1" })

const prepareRequest = (content: string): TransactionalFileMutationPrepareRequest =>
  new TransactionalFileMutationPrepareRequest({
    actor: actor(),
    path: "/workspace/app/src/main.ts",
    replacementBytes: bytes(content),
    traceId: "trace-prepare"
  })

const prepareInput = (content: string): TransactionalFileMutationPrepareInput =>
  new TransactionalFileMutationPrepareInput({
    actor: actor(),
    path: "/workspace/app/src/main.ts",
    replacementBytes: bytes(content),
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
