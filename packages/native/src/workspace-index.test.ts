import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  type HostProtocolEventEnvelope,
  type HostProtocolError,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  rpcSupport
} from "@orika/bridge"
import { type AuditEvent, type AuditEventsApi, makePermissionRegistry, P } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"
import { EventJournal } from "effect/unstable/eventlog"

import {
  makeWorkspaceIndexMemoryClient,
  makeWorkspaceIndexServiceLayer,
  makeWorkspaceIndexUnsupportedClient,
  WorkspaceIndex,
  WorkspaceIndexClient,
  WorkspaceIndexMethodNames,
  WorkspaceIndexRpcs,
  WorkspaceIndexSurface,
  type WorkspaceIndexClientApi
} from "./workspace-index.js"
import {
  WorkspaceIndexActor,
  WorkspaceIndexCloseInput,
  WorkspaceIndexCloseRequest,
  WorkspaceIndexEvent,
  WorkspaceIndexIgnoreRule,
  WorkspaceIndexOpenInput,
  WorkspaceIndexOpenRequest,
  WorkspaceIndexRefreshInput,
  WorkspaceIndexRefreshRequest,
  WorkspaceIndexScope
} from "./contracts/workspace-index.js"

const expectedWorkspaceIndexMethods: Array<(typeof WorkspaceIndexMethodNames)[number]> = [
  "open",
  "refresh",
  "close",
  "isSupported"
]

test("WorkspaceIndex event schema is owned by the RPC stream contract", async () => {
  const workspaceIndexModule = await import("./workspace-index.js")
  const rootModule = await import("./index.js")
  const eventRpc = WorkspaceIndexRpcs.requests.get("WorkspaceIndex.events.Event")

  expect("WorkspaceIndexRpcEvents" in workspaceIndexModule).toBe(false)
  expect("WorkspaceIndexRpcEvents" in rootModule).toBe(false)
  expect(Array.from(WorkspaceIndexRpcs.requests.keys())).toEqual([
    ...expectedWorkspaceIndexMethods.map((method) => `WorkspaceIndex.${method}`),
    "WorkspaceIndex.events.Event"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(Object.is(eventRpc.successSchema.success, WorkspaceIndexEvent)).toBe(true)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }
})

test("WorkspaceIndex direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolRequestEnvelope[] = []
      const protocolLayer = Layer.effect(RpcClient.Protocol)(
        makeDesktopClientProtocol(
          {
            send: (envelope) => {
              if (envelope.kind !== "request") {
                return Effect.void
              }
              requests.push(envelope)
              return Effect.all(
                [
                  Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_100,
                      traceId: envelope.traceId,
                      payload: {
                        type: "workspace-index-event",
                        timestamp: 1_710_000_000_100,
                        indexId: "workspace-index-1",
                        root: "/workspace/app",
                        path: "/workspace/app/src/main.ts",
                        phase: "entry-indexed",
                        indexed: 1,
                        invalidated: 0,
                        ignored: 0
                      }
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_101,
                      traceId: envelope.traceId
                    })
                  )
                ],
                { discard: true }
              )
            },
            run: (onEnvelope) =>
              Stream.fromQueue(queue).pipe(
                Stream.runForEach(onEnvelope),
                Effect.andThen(Effect.never)
              )
          },
          {
            nextRequestId: () => "workspace-index-event-rpc",
            nextTraceId: () => "trace-workspace-index-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WorkspaceIndexClient
          return yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(WorkspaceIndexSurface.clientLayer, protocolLayer)
      )

      expect(event).toMatchObject({
        indexId: "workspace-index-1",
        path: "/workspace/app/src/main.ts",
        phase: "entry-indexed",
        indexed: 1
      })
      expect(requests.map((request) => request.method)).toEqual(["WorkspaceIndex.events.Event"])
    })
  ))

test("WorkspaceIndex service opens, filters ignored paths, refreshes, closes, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      let forwardedPaths: readonly string[] | undefined
      const baseClient = yield* makeWorkspaceIndexMemoryClient({
        nextIndexId: () => "workspace-index-1"
      })
      const client: WorkspaceIndexClientApi = {
        ...baseClient,
        refresh: (input) =>
          Effect.sync(() => {
            forwardedPaths = input.changedPaths
          }).pipe(Effect.andThen(baseClient.refresh(input)))
      }

      const result = yield* runScoped(
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
        }),
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextIndexId: () => "workspace-index-1",
          nextTraceId: () => "trace-index"
        })
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
  ))

test("WorkspaceIndex denies open before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      let calls = 0
      const baseClient = yield* makeWorkspaceIndexMemoryClient()
      const client: WorkspaceIndexClientApi = {
        ...baseClient,
        open: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.open(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const index = yield* WorkspaceIndex
          return yield* Effect.exit(index.open(openRequest()))
        }),
        makeWorkspaceIndexServiceLayer(client, { permissions })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "PermissionDenied", operation: "WorkspaceIndex.open" })
      })
    })
  ))

test("WorkspaceIndex audit failures stop host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const openPermissions = yield* configuredPermissions([])
      let openCalls = 0
      const openBaseClient = yield* makeWorkspaceIndexMemoryClient()
      const openClient: WorkspaceIndexClientApi = {
        ...openBaseClient,
        open: (input) =>
          Effect.sync(() => {
            openCalls += 1
          }).pipe(Effect.andThen(openBaseClient.open(input)))
      }

      const openExit = yield* runScoped(
        Effect.gen(function* () {
          const index = yield* WorkspaceIndex
          return yield* Effect.exit(index.open(openRequest()))
        }),
        makeWorkspaceIndexServiceLayer(openClient, {
          permissions: openPermissions,
          audit: failingAuditFor("WorkspaceIndex.open")
        })
      )

      const refreshPermissions = yield* configuredPermissions([])
      let refreshCalls = 0
      const refreshBaseClient = yield* makeWorkspaceIndexMemoryClient()
      const refreshClient: WorkspaceIndexClientApi = {
        ...refreshBaseClient,
        refresh: (input) =>
          Effect.sync(() => {
            refreshCalls += 1
          }).pipe(Effect.andThen(refreshBaseClient.refresh(input)))
      }

      const refreshExit = yield* runScoped(
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
        }),
        makeWorkspaceIndexServiceLayer(refreshClient, {
          permissions: refreshPermissions,
          audit: failingAuditFor("WorkspaceIndex.refresh"),
          nextIndexId: () => "workspace-index-1"
        })
      )

      const closePermissions = yield* configuredPermissions([])
      let closeCalls = 0
      const closeBaseClient = yield* makeWorkspaceIndexMemoryClient()
      const closeClient: WorkspaceIndexClientApi = {
        ...closeBaseClient,
        close: (input) =>
          Effect.sync(() => {
            closeCalls += 1
          }).pipe(Effect.andThen(closeBaseClient.close(input)))
      }

      const closeExit = yield* runScoped(
        Effect.gen(function* () {
          const index = yield* WorkspaceIndex
          const opened = yield* index.open(openRequest())
          return yield* Effect.exit(
            index.close(new WorkspaceIndexCloseRequest({ indexId: opened.indexId }))
          )
        }),
        makeWorkspaceIndexServiceLayer(closeClient, {
          permissions: closePermissions,
          audit: failingAuditFor("WorkspaceIndex.close"),
          nextIndexId: () => "workspace-index-1"
        })
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
  ))

test("WorkspaceIndex rejects malformed scopes before bridge transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const exit = yield* runScoped(
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
        }),
        WorkspaceIndexSurface.bridgeClientLayer(exchange)
      )

      expect(requests).toEqual([])
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WorkspaceIndex.open" })
      })
    })
  ))

test("WorkspaceIndex accepts root read grants and rejects noncanonical scope paths before bridge transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const exit = yield* runScoped(
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
            client.open({
              actor: { kind: "workspace", id: "workspace-1" },
              scope: {
                root: "/workspace/app",
                ignoreRules: [
                  { pattern: "node_modules/**", reason: "dependencies" },
                  { pattern: "dist/**", reason: "build output" }
                ],
                grants: [P.filesystemRead({ roots: ["/workspace/app/.."] })],
                watch: false
              }
            })
          )
          return { accepted, rejected, rejectedGrant, rejectedRoot }
        }),
        WorkspaceIndexSurface.bridgeClientLayer(exchange)
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
  ))

test("WorkspaceIndex bridge client decodes native index events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const nativeEvent: HostProtocolEventEnvelope = {
        kind: "event",
        method: "WorkspaceIndex.Event",
        timestamp: 1_710_000_000_000,
        traceId: "trace-workspace-index-event",
        payload: {
          type: "workspace-index-event",
          timestamp: 1_710_000_000_000,
          indexId: "workspace-index-1",
          root: "/workspace/app",
          path: "/workspace/app/src/main.ts",
          phase: "entry-indexed",
          indexed: 1,
          invalidated: 0,
          ignored: 0
        }
      }
      const exchange: BridgeClientExchange = {
        request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
        subscribe: (method) => {
          expect(method).toBe("WorkspaceIndex.Event")
          return Stream.make(nativeEvent)
        }
      }
      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WorkspaceIndexClient
          return yield* client.events().pipe(Stream.runHead)
        }),
        WorkspaceIndexSurface.bridgeClientLayer(exchange)
      )

      expect(event._tag).toBe("Some")
      if (event._tag === "Some") {
        expect(event.value).toMatchObject({
          indexId: "workspace-index-1",
          path: "/workspace/app/src/main.ts",
          phase: "entry-indexed",
          indexed: 1
        })
      }
    })
  ))

test("WorkspaceIndex rejects contradictory event phase states before exposing native events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = {
        type: "workspace-index-event",
        timestamp: 1_710_000_000_000,
        indexId: "workspace-index-1",
        phase: "closed",
        state: "opened"
      }
      const directDecode = yield* Effect.exit(
        Schema.decodeUnknownEffect(WorkspaceIndexEvent)(payload)
      )
      const nativeEvent: HostProtocolEventEnvelope = {
        kind: "event",
        method: "WorkspaceIndex.Event",
        timestamp: 1_710_000_000_000,
        traceId: "trace-workspace-index-event",
        payload
      }
      const exchange: BridgeClientExchange = {
        request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
        subscribe: (method) => {
          expect(method).toBe("WorkspaceIndex.Event")
          return Stream.make(nativeEvent)
        }
      }
      const bridgeDecode = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WorkspaceIndexClient
          return yield* Effect.exit(client.events().pipe(Stream.runHead))
        }),
        WorkspaceIndexSurface.bridgeClientLayer(exchange)
      )

      expect(Exit.isFailure(directDecode)).toBe(true)
      expectExitFailure(bridgeDecode, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidOutput",
          operation: "WorkspaceIndex.Event"
        })
      })
    })
  ))

test("WorkspaceIndex rejects changed paths outside the indexed root before refresh side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let refreshes = 0
      const baseClient = yield* makeWorkspaceIndexMemoryClient()
      const client: WorkspaceIndexClientApi = {
        ...baseClient,
        refresh: (input) =>
          Effect.sync(() => {
            refreshes += 1
          }).pipe(Effect.andThen(baseClient.refresh(input)))
      }

      const exit = yield* runScoped(
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
        }),
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )

      expect(refreshes).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "WorkspaceIndex.refresh"
        })
      })
    })
  ))

test("WorkspaceIndex rejects traversal and relative changed paths before refresh side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let refreshes = 0
      const baseClient = yield* makeWorkspaceIndexMemoryClient()
      const client: WorkspaceIndexClientApi = {
        ...baseClient,
        refresh: (input) =>
          Effect.sync(() => {
            refreshes += 1
          }).pipe(Effect.andThen(baseClient.refresh(input)))
      }

      const exits = yield* runScoped(
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
        }),
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )

      expect(refreshes).toBe(0)
      for (const exit of [exits.traversal, exits.relative]) {
        expectExitFailure(exit, (error) => {
          expect(error).toMatchObject({
            tag: "InvalidArgument",
            operation: "WorkspaceIndex.refresh"
          })
        })
      }
    })
  ))

test("WorkspaceIndex refresh rechecks filesystem permission after open", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let refreshes = 0
      const baseClient = yield* makeWorkspaceIndexMemoryClient()
      const client: WorkspaceIndexClientApi = {
        ...baseClient,
        refresh: (input) =>
          Effect.sync(() => {
            refreshes += 1
          }).pipe(Effect.andThen(baseClient.refresh(input)))
      }

      const exit = yield* runScoped(
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
        }),
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )

      expect(refreshes).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "WorkspaceIndex.refresh"
        })
      })
    })
  ))

test("WorkspaceIndex refresh does not call the host when all changed paths are ignored", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let refreshes = 0
      const baseClient = yield* makeWorkspaceIndexMemoryClient()
      const client: WorkspaceIndexClientApi = {
        ...baseClient,
        refresh: (input) =>
          Effect.sync(() => {
            refreshes += 1
          }).pipe(Effect.andThen(baseClient.refresh(input)))
      }

      const result = yield* runScoped(
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
        }),
        makeWorkspaceIndexServiceLayer(client, {
          permissions,
          nextIndexId: () => "workspace-index-1"
        })
      )

      expect(refreshes).toBe(0)
      expect(result).toMatchObject({ indexed: 0, invalidated: 0, ignored: 2, state: "opened" })
    })
  ))

test("WorkspaceIndex unsupported client exposes typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeWorkspaceIndexUnsupportedClient()
      const openExit = yield* Effect.exit(client.open(openInput()))
      const refreshExit = yield* Effect.exit(
        client.refresh(new WorkspaceIndexRefreshInput({ indexId: "workspace-index-1" }))
      )
      const closeExit = yield* Effect.exit(
        client.close(new WorkspaceIndexCloseInput({ indexId: "workspace-index-1" }))
      )

      for (const exit of [openExit, refreshExit, closeExit]) {
        expectExitFailure(exit, (error) => {
          expect(error).toMatchObject({ tag: "Unsupported" })
        })
      }
      const supported = yield* client.isSupported()
      expect(supported.supported).toBe(false)
    })
  ))

test("WorkspaceIndex RPC metadata reports host methods and event stream as supported", () => {
  expect(
    WorkspaceIndexSurface.schemaDocs.map((doc) => ({
      support: doc.support,
      tag: doc.tag
    }))
  ).toEqual([
    { tag: "WorkspaceIndex.open", support: { status: "supported" } },
    { tag: "WorkspaceIndex.refresh", support: { status: "supported" } },
    { tag: "WorkspaceIndex.close", support: { status: "supported" } },
    { tag: "WorkspaceIndex.isSupported", support: { status: "supported" } },
    { tag: "WorkspaceIndex.events.Event", support: { status: "supported" } }
  ])
})

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
    yield* Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "WorkspaceIndex", methods: ["open"] })),
      permissions.declare(P.nativeInvoke({ primitive: "WorkspaceIndex", methods: ["refresh"] })),
      permissions.declare(P.nativeInvoke({ primitive: "WorkspaceIndex", methods: ["close"] })),
      permissions.declare(P.filesystemRead({ roots: ["/workspace/app"] }))
    ])
    return permissions
  })

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
    watch: false,
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

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
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
