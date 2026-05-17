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
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  makeWorkspaceIndexBridgeClientLayer,
  makeWorkspaceIndexMemoryClient,
  makeWorkspaceIndexServiceLayer,
  makeWorkspaceIndexUnsupportedClient,
  WorkspaceIndex,
  WorkspaceIndexClient,
  type WorkspaceIndexClientApi
} from "./workspace-index.js"
import {
  WorkspaceIndexActor,
  WorkspaceIndexCloseInput,
  WorkspaceIndexCloseRequest,
  WorkspaceIndexIgnoreRule,
  WorkspaceIndexOpenInput,
  WorkspaceIndexOpenRequest,
  WorkspaceIndexRefreshInput,
  WorkspaceIndexRefreshRequest,
  WorkspaceIndexScope
} from "./contracts/workspace-index.js"
import { EventJournal } from "effect/unstable/eventlog"

test("WorkspaceIndex service opens, filters ignored paths, refreshes, closes, emits events, and audits use", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  let forwardedPaths: readonly string[] | undefined
  const baseClient = await Effect.runPromise(
    makeWorkspaceIndexMemoryClient({ nextIndexId: () => "workspace-index-1" })
  )
  const client: WorkspaceIndexClientApi = {
    ...baseClient,
    refresh: (input) =>
      Effect.sync(() => {
        forwardedPaths = input.changedPaths
      }).pipe(Effect.andThen(baseClient.refresh(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      const refreshed = yield* index.refresh(
        new WorkspaceIndexRefreshRequest({
          indexId: opened.indexId,
          changedPaths: [
            "/workspace/app/src/main.ts",
            "/workspace/app/node_modules/pkg/index.js",
            "/workspace/app/dist/output.js"
          ],
          traceId: "trace-refresh"
        })
      )
      const closed = yield* index.close(
        new WorkspaceIndexCloseRequest({ indexId: opened.indexId, traceId: "trace-close" })
      )
      const event = yield* index.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { closed, event, opened, refreshed }
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextIndexId: () => "workspace-index-1",
          nextTraceId: () => "trace-index"
        })
      )
    )
  )

  expect(result.opened).toMatchObject({
    indexId: "workspace-index-1",
    root: "/workspace/app",
    state: "opened"
  })
  expect(forwardedPaths).toEqual(["/workspace/app/src/main.ts"])
  expect(result.refreshed).toMatchObject({ indexed: 1, ignored: 2 })
  expect(result.closed.closed).toBe(true)
  expect(result.event.phase).toBe("opened")
  expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
  expect(rows.find((row) => row.source === "WorkspaceIndex.open")?.actor).toMatchObject({
    id: "workspace:workspace-1"
  })
  expect(rows.some((row) => row.source === "WorkspaceIndex.close")).toBe(true)
})

test("WorkspaceIndex denies open before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let calls = 0
  const baseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const client: WorkspaceIndexClientApi = {
    ...baseClient,
    open: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.open(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      return yield* Effect.exit(index.open(openRequest()))
    }).pipe(Effect.provide(makeWorkspaceIndexServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "WorkspaceIndex.open" })
  })
})

test("WorkspaceIndex audit failures stop host side effects", async () => {
  const openPermissions = await configuredPermissions([])
  let openCalls = 0
  const openBaseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const openClient: WorkspaceIndexClientApi = {
    ...openBaseClient,
    open: (input) =>
      Effect.sync(() => {
        openCalls += 1
      }).pipe(Effect.andThen(openBaseClient.open(input)))
  }

  const openExit = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      return yield* Effect.exit(index.open(openRequest()))
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(openClient, {
          permissions: openPermissions,
          audit: failingAuditFor("WorkspaceIndex.open")
        })
      )
    )
  )

  const refreshPermissions = await configuredPermissions([])
  let refreshCalls = 0
  const refreshBaseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const refreshClient: WorkspaceIndexClientApi = {
    ...refreshBaseClient,
    refresh: (input) =>
      Effect.sync(() => {
        refreshCalls += 1
      }).pipe(Effect.andThen(refreshBaseClient.refresh(input)))
  }

  const refreshExit = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      return yield* Effect.exit(
        index.refresh(
          new WorkspaceIndexRefreshRequest({
            indexId: opened.indexId,
            changedPaths: ["/workspace/app/src/main.ts"]
          })
        )
      )
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(refreshClient, {
          permissions: refreshPermissions,
          audit: failingAuditFor("WorkspaceIndex.refresh"),
          nextIndexId: () => "workspace-index-1"
        })
      )
    )
  )

  const closePermissions = await configuredPermissions([])
  let closeCalls = 0
  const closeBaseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const closeClient: WorkspaceIndexClientApi = {
    ...closeBaseClient,
    close: (input) =>
      Effect.sync(() => {
        closeCalls += 1
      }).pipe(Effect.andThen(closeBaseClient.close(input)))
  }

  const closeExit = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      return yield* Effect.exit(
        index.close(new WorkspaceIndexCloseRequest({ indexId: opened.indexId }))
      )
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(closeClient, {
          permissions: closePermissions,
          audit: failingAuditFor("WorkspaceIndex.close"),
          nextIndexId: () => "workspace-index-1"
        })
      )
    )
  )

  expect(openCalls).toBe(0)
  expect(refreshCalls).toBe(0)
  expect(closeCalls).toBe(0)
  for (const exit of [openExit, refreshExit, closeExit]) {
    expectExitFailure(exit, (error) => {
      expect(error).toMatchObject({ tag: "Internal" })
    })
  }
})

test("WorkspaceIndex rejects malformed scopes before bridge transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { indexId: "workspace-index-1", root: "/workspace/app", state: "opened" }
      })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* WorkspaceIndexClient
      return yield* Effect.exit(
        client.open(
          new WorkspaceIndexOpenInput({
            actor: actor(),
            scope: scope({ root: "relative/path" })
          })
        )
      )
    }).pipe(Effect.provide(makeWorkspaceIndexBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.open" })
  })
})

test("WorkspaceIndex accepts root read grants and rejects noncanonical scope paths before bridge transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: { indexId: "workspace-index-1", root: "/workspace/app", state: "opened" }
      })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* WorkspaceIndexClient
      const accepted = yield* client.open(
        new WorkspaceIndexOpenInput({
          actor: actor(),
          scope: scope({ grants: [P.filesystemRead({ roots: ["/"] })] })
        })
      )
      const rejected = yield* Effect.exit(
        client.open(
          new WorkspaceIndexOpenInput({
            actor: actor(),
            scope: scope({
              ignoreRules: [new WorkspaceIndexIgnoreRule({ pattern: "../secrets/**" })]
            })
          })
        )
      )
      const rejectedRoot = yield* Effect.exit(
        client.open(
          new WorkspaceIndexOpenInput({
            actor: actor(),
            scope: scope({
              root: "/workspace/app/../secret",
              grants: [P.filesystemRead({ roots: ["/workspace"] })]
            })
          })
        )
      )
      const rejectedGrant = yield* Effect.exit(
        client.open(
          new WorkspaceIndexOpenInput({
            actor: actor(),
            scope: scope({
              grants: [P.filesystemRead({ roots: ["/workspace/app/.."] })]
            })
          })
        )
      )
      return { accepted, rejected, rejectedGrant, rejectedRoot }
    }).pipe(Effect.provide(makeWorkspaceIndexBridgeClientLayer(exchange)))
  )

  expect(exit.accepted.indexId).toBe("workspace-index-1")
  expect(requests).toHaveLength(1)
  expectExitFailure(exit.rejected, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.open" })
  })
  expectExitFailure(exit.rejectedRoot, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.open" })
  })
  expectExitFailure(exit.rejectedGrant, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.open" })
  })
})

test("WorkspaceIndex rejects changed paths outside the indexed root before refresh side effects", async () => {
  const permissions = await configuredPermissions([])
  let refreshes = 0
  const baseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const client: WorkspaceIndexClientApi = {
    ...baseClient,
    refresh: (input) =>
      Effect.sync(() => {
        refreshes += 1
      }).pipe(Effect.andThen(baseClient.refresh(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      return yield* Effect.exit(
        index.refresh(
          new WorkspaceIndexRefreshRequest({
            indexId: opened.indexId,
            changedPaths: ["/workspace/other/file.ts"]
          })
        )
      )
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )
    )
  )

  expect(refreshes).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.refresh" })
  })
})

test("WorkspaceIndex rejects traversal and relative changed paths before refresh side effects", async () => {
  const permissions = await configuredPermissions([])
  let refreshes = 0
  const baseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const client: WorkspaceIndexClientApi = {
    ...baseClient,
    refresh: (input) =>
      Effect.sync(() => {
        refreshes += 1
      }).pipe(Effect.andThen(baseClient.refresh(input)))
  }

  const exits = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      const traversal = yield* Effect.exit(
        index.refresh(
          new WorkspaceIndexRefreshRequest({
            indexId: opened.indexId,
            changedPaths: ["/workspace/app/../secret.ts"]
          })
        )
      )
      const relative = yield* Effect.exit(
        index.refresh(
          new WorkspaceIndexRefreshRequest({
            indexId: opened.indexId,
            changedPaths: ["src/main.ts"]
          })
        )
      )
      return { relative, traversal }
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )
    )
  )

  expect(refreshes).toBe(0)
  for (const exit of [exits.traversal, exits.relative]) {
    expectExitFailure(exit, (error) => {
      expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.refresh" })
    })
  }
})

test("WorkspaceIndex refresh rechecks filesystem permission after open", async () => {
  const permissions = await configuredPermissions([])
  let refreshes = 0
  const baseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const client: WorkspaceIndexClientApi = {
    ...baseClient,
    refresh: (input) =>
      Effect.sync(() => {
        refreshes += 1
      }).pipe(Effect.andThen(baseClient.refresh(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      yield* permissions.declare(P.filesystemRead({ roots: ["/workspace/app"] }), {
        effect: "deny",
        source: "policy"
      })
      return yield* Effect.exit(
        index.refresh(
          new WorkspaceIndexRefreshRequest({
            indexId: opened.indexId,
            changedPaths: ["/workspace/app/src/main.ts"]
          })
        )
      )
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )
    )
  )

  expect(refreshes).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "WorkspaceIndex.refresh" })
  })
})

test("WorkspaceIndex refresh does not call the host when all changed paths are ignored", async () => {
  const permissions = await configuredPermissions([])
  let refreshes = 0
  const baseClient = await Effect.runPromise(makeWorkspaceIndexMemoryClient())
  const client: WorkspaceIndexClientApi = {
    ...baseClient,
    refresh: (input) =>
      Effect.sync(() => {
        refreshes += 1
      }).pipe(Effect.andThen(baseClient.refresh(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const index = yield* WorkspaceIndex
      const opened = yield* index.open(openRequest())
      return yield* index.refresh(
        new WorkspaceIndexRefreshRequest({
          indexId: opened.indexId,
          changedPaths: [
            "/workspace/app/node_modules/pkg/index.js",
            "/workspace/app/dist/output.js"
          ]
        })
      )
    }).pipe(
      Effect.provide(
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )
    )
  )

  expect(refreshes).toBe(0)
  expect(result).toMatchObject({ indexed: 0, invalidated: 0, ignored: 2, state: "opened" })
})

test("WorkspaceIndex unsupported client exposes typed unsupported failures", async () => {
  const client = makeWorkspaceIndexUnsupportedClient()
  const openExit = await Effect.runPromise(Effect.exit(client.open(openInput())))
  const refreshExit = await Effect.runPromise(
    Effect.exit(client.refresh(new WorkspaceIndexRefreshInput({ indexId: "workspace-index-1" })))
  )
  const closeExit = await Effect.runPromise(
    Effect.exit(client.close(new WorkspaceIndexCloseInput({ indexId: "workspace-index-1" })))
  )

  for (const exit of [openExit, refreshExit, closeExit]) {
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
      permissions.declare(P.nativeInvoke({ primitive: "WorkspaceIndex", methods: ["open"] })),
      permissions.declare(P.nativeInvoke({ primitive: "WorkspaceIndex", methods: ["refresh"] })),
      permissions.declare(P.nativeInvoke({ primitive: "WorkspaceIndex", methods: ["close"] })),
      permissions.declare(P.filesystemRead({ roots: ["/workspace/app"] }))
    ])
  )
  return permissions
}

const actor = (): WorkspaceIndexActor =>
  new WorkspaceIndexActor({ kind: "workspace", id: "workspace-1" })

const scope = (
  options: Partial<ConstructorParameters<typeof WorkspaceIndexScope>[0]> = {}
): WorkspaceIndexScope =>
  new WorkspaceIndexScope({
    root: "/workspace/app",
    ignoreRules: [
      new WorkspaceIndexIgnoreRule({ pattern: "node_modules/**", reason: "dependencies" }),
      new WorkspaceIndexIgnoreRule({ pattern: "dist/**", reason: "build output" })
    ],
    grants: [P.filesystemRead({ roots: ["/workspace/app"] })],
    watch: true,
    ...options
  })

const openRequest = (): WorkspaceIndexOpenRequest =>
  new WorkspaceIndexOpenRequest({
    actor: actor(),
    scope: scope(),
    traceId: "trace-open"
  })

const openInput = (): WorkspaceIndexOpenInput =>
  new WorkspaceIndexOpenInput({
    actor: actor(),
    scope: scope(),
    traceId: "trace-open"
  })

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

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}
