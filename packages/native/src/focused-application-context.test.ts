import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  rpcSupport
} from "@orika/bridge"
import { type AuditEvent, makePermissionRegistry, makeResourceRegistry, P } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  FocusedApplicationContext,
  FocusedApplicationContextCapabilityFacts,
  FocusedApplicationContextClient,
  FocusedApplicationContextRpcs,
  FocusedApplicationContextSurface,
  makeFocusedApplicationContextMemoryClient,
  makeFocusedApplicationContextServiceLayer,
  makeFocusedApplicationContextUnsupportedClient,
  type FocusedApplicationContextClientApi
} from "./focused-application-context.js"
import {
  FocusedApplicationContextActor,
  FocusedApplicationContextEvent,
  FocusedApplicationContextSnapshotRequest
} from "./contracts/focused-application-context.js"

const UnsupportedMethods = ["watch", "stopWatching"] as const
type FocusedApplicationContextEventValue = typeof FocusedApplicationContextEvent.Type

test("FocusedApplicationContext exposes only snapshot and isSupported as callable RPCs", () => {
  const callableTags = Array.from(FocusedApplicationContextRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "FocusedApplicationContext.events.Event",
    "FocusedApplicationContext.isSupported",
    "FocusedApplicationContext.snapshot"
  ])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`FocusedApplicationContext.${method}`)
  }
})

test("FocusedApplicationContext event schema is owned by the RPC stream contract", async () => {
  const contextModule = await import("./focused-application-context.js")
  const eventRpc = FocusedApplicationContextRpcs.requests.get(
    "FocusedApplicationContext.events.Event"
  )

  expect("FocusedApplicationContextRpcEvents" in contextModule).toBe(false)
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(FocusedApplicationContextEvent)
    expect(eventRpc.pipe(rpcSupport)).toMatchObject({
      status: "unsupported",
      reason: "host-adapter-unimplemented"
    })
  }

  const eventDoc = FocusedApplicationContextSurface.schemaDocs.find(
    (doc) => doc.tag === "FocusedApplicationContext.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toMatchObject({
    status: "unsupported",
    reason: "host-adapter-unimplemented"
  })
})

test("FocusedApplicationContext declares watch and stopWatching as non-callable capability facts", () => {
  const factTags = FocusedApplicationContextCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `FocusedApplicationContext.${method}`).toSorted()
  )
  for (const fact of FocusedApplicationContextCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("FocusedApplicationContext capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: FocusedApplicationContextSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`FocusedApplicationContext.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = FocusedApplicationContextSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual([
        "FocusedApplicationContext.events.Event",
        "FocusedApplicationContext.isSupported",
        "FocusedApplicationContext.snapshot"
      ])

      const nonCallableTags = FocusedApplicationContextSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `FocusedApplicationContext.${method}`).toSorted()
      )
    })
  ))

test("FocusedApplicationContext direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolRequestEnvelope[] = []
      const eventPayload = {
        ...eventBase(),
        phase: "focus-changed",
        snapshot: focusedSnapshot()
      } as const
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
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: eventPayload
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_002,
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
            nextRequestId: () => "focused-context-event-rpc",
            nextTraceId: () => "trace-focused-context-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* FocusedApplicationContextClient
          return yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(FocusedApplicationContextSurface.clientLayer, protocolLayer)
      )

      expect(event).toMatchObject(eventPayload)
      expect(requests.map((request) => request.method)).toEqual([
        "FocusedApplicationContext.events.Event"
      ])
    })
  ))

test("FocusedApplicationContext events reject inconsistent phase payloads", () => {
  const snapshot = focusedSnapshot()
  for (const payload of [
    {
      ...eventBase(),
      phase: "focus-changed"
    },
    {
      ...eventBase(),
      phase: "focus-changed",
      snapshot,
      reason: "host-failed"
    },
    {
      ...eventBase(),
      phase: "watch-started"
    },
    {
      ...eventBase(),
      phase: "watch-stopped",
      watchId: "watch-1",
      message: "stopped"
    },
    {
      ...eventBase(),
      phase: "failed"
    },
    {
      ...eventBase(),
      phase: "failed",
      reason: "host-failed",
      snapshot
    }
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(FocusedApplicationContextEvent)(payload)
    )
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      ...eventBase(),
      phase: "focus-changed",
      snapshot
    },
    {
      ...eventBase(),
      phase: "focus-changed",
      watchId: "watch-1",
      snapshot
    },
    {
      ...eventBase(),
      phase: "watch-started",
      watchId: "watch-1"
    },
    {
      ...eventBase(),
      phase: "watch-stopped",
      watchId: "watch-1"
    },
    {
      ...eventBase(),
      phase: "failed",
      reason: "host-failed",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(FocusedApplicationContextEvent)(payload)
    )
    expect(exit._tag).toBe("Success")
  }
})

test("FocusedApplicationContext event types reject impossible phase payloads", () => {
  const snapshot = focusedSnapshot()
  const validEvents: ReadonlyArray<FocusedApplicationContextEventValue> = [
    {
      ...eventBase(),
      phase: "focus-changed",
      snapshot
    },
    {
      ...eventBase(),
      phase: "watch-started",
      watchId: "watch-1"
    },
    {
      ...eventBase(),
      phase: "failed",
      watchId: "watch-1",
      reason: "host-failed",
      message: "host failed"
    }
  ]

  // @ts-expect-error failed focused application context events cannot carry snapshots.
  const rejectedFailedEvent: FocusedApplicationContextEventValue = {
    ...eventBase(),
    phase: "failed",
    reason: "host-failed",
    snapshot
  }
  // @ts-expect-error watch events cannot carry failure metadata.
  const rejectedWatchEvent: FocusedApplicationContextEventValue = {
    ...eventBase(),
    phase: "watch-stopped",
    watchId: "watch-1",
    message: "stopped"
  }

  void rejectedFailedEvent
  void rejectedWatchEvent
  expect(validEvents.map((event) => event.phase)).toEqual([
    "focus-changed",
    "watch-started",
    "failed"
  ])
})

test("FocusedApplicationContext snapshots expose focused surface metadata only", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const client = yield* makeFocusedApplicationContextMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* context.snapshot(
            new FocusedApplicationContextSnapshotRequest({ actor: actor() })
          )
        }),
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )

      expect(result.application.applicationId).toBe("memory-app")
      expect(result.window?.title).toBe("Memory Window")
      expect(rows.some((row) => row.source === "FocusedApplicationContext.snapshot")).toBe(true)
    })
  ))

test("FocusedApplicationContext denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeFocusedApplicationContextMemoryClient()
      let calls = 0
      const client: FocusedApplicationContextClientApi = {
        ...baseClient,
        snapshot: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.snapshot(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
          )
        }),
        makeFocusedApplicationContextServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext surfaces injected host failure and audits failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const failure = makeHostProtocolInternalError(
        "host failed",
        "FocusedApplicationContext.snapshot"
      )
      const client = yield* makeFocusedApplicationContextMemoryClient({
        failure: { snapshot: failure }
      })

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
          )
        }),
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
      expect(rows.some((row) => row.outcome === "failed")).toBe(true)
    })
  ))

test("FocusedApplicationContext rejects malformed input before client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeFocusedApplicationContextMemoryClient()
      let calls = 0
      const client: FocusedApplicationContextClientApi = {
        ...baseClient,
        snapshot: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.snapshot(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(context.snapshot({ actor: actor(), traceId: "\0" }))
        }),
        makeFocusedApplicationContextServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext unsupported client fails through public service layer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const resources = yield* makeResourceRegistry()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
          )
        }),
        makeFocusedApplicationContextServiceLayer(
          makeFocusedApplicationContextUnsupportedClient(),
          {
            permissions,
            resources
          }
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext bridge client fails event stream as unsupported before subscribing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* FocusedApplicationContextClient
          return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        FocusedApplicationContextSurface.bridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "FocusedApplicationContext.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* permissions.declare(
      P.nativeInvoke({ primitive: "FocusedApplicationContext", methods: ["snapshot"] })
    )
    rows.length = 0
    return permissions
  })

const memoryAudit = (rows: AuditEvent[]) => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const actor = () => new FocusedApplicationContextActor({ kind: "workspace", id: "workspace-1" })

const eventBase = () =>
  ({
    type: "focused-application-context-event",
    timestamp: 1_710_000_000_100
  }) as const

const focusedSnapshot = () => ({
  application: {
    applicationId: "com.example.App",
    name: "Example App"
  },
  observedAt: 1_710_000_000_000
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

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
