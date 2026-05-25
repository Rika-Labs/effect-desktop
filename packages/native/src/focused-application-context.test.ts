import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  RendererOriginAuth,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  rpcSupport
} from "@orika/bridge"
import { PermissionRegistry, makePermissionRegistry } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  FocusedApplicationContext,
  FocusedApplicationContextRpcs,
  FocusedApplicationContextSurface,
  makeFocusedApplicationContextMemoryClient,
  makeFocusedApplicationContextUnsupportedClient,
  type FocusedApplicationContextClientApi
} from "./focused-application-context.js"
import {
  FocusedApplicationContextActor,
  FocusedApplicationContextEvent,
  FocusedApplicationContextSnapshotInput,
  FocusedApplicationContextSupportedResult
} from "./contracts/focused-application-context.js"

const UnsupportedMethods = ["watch", "stopWatching"] as const
type FocusedApplicationContextEventValue = typeof FocusedApplicationContextEvent.Type

test("FocusedApplicationContext public surface omits shallow service and side exports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("focused-application-context.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "FocusedApplicationContextCapabilityFacts",
        "class FocusedApplicationContextClient",
        "FocusedApplicationContextLive",
        "FocusedApplicationContextServiceApi",
        "makeFocusedApplicationContextClientLayer",
        "makeFocusedApplicationContextServiceLayer",
        "makeFocusedApplicationContextBridgeClientLayer",
        "makeFocusedApplicationContextService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

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
  const facts = FocusedApplicationContextSurface.schemaDocs.filter((doc) => !doc.callable)
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `FocusedApplicationContext.${method}`).toSorted()
  )
  for (const fact of facts) {
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
          const client = yield* FocusedApplicationContext
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
      const client = yield* makeFocusedApplicationContextMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* context.snapshot(
            new FocusedApplicationContextSnapshotInput({ actor: actor() })
          )
        }),
        Layer.succeed(FocusedApplicationContext)(client)
      )

      expect(result.application.applicationId).toBe("memory-app")
      expect(result.window?.title).toBe("Memory Window")
    })
  ))

test("FocusedApplicationContext denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const baseClient = yield* makeFocusedApplicationContextMemoryClient()
      const calls: string[] = []
      const runtime = FocusedApplicationContextSurface.hostRuntime(
        {
          "FocusedApplicationContext.snapshot": (input) =>
            Effect.sync(() => {
              calls.push("snapshot")
            }).pipe(Effect.andThen(baseClient.snapshot(input))),
          "FocusedApplicationContext.isSupported": () =>
            Effect.succeed(new FocusedApplicationContextSupportedResult({ supported: true })),
          "FocusedApplicationContext.events.Event": () => Stream.empty
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "focused-context-denied",
            method: "FocusedApplicationContext.snapshot",
            timestamp: 1_710_000_000_000,
            traceId: "trace-focused-context-denied",
            payload: { actor: actor() }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("FocusedApplicationContext surfaces injected host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
            context.snapshot(new FocusedApplicationContextSnapshotInput({ actor: actor() }))
          )
        }),
        Layer.succeed(FocusedApplicationContext)(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext rejects malformed input before client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const baseClient = yield* makeFocusedApplicationContextMemoryClient()
      let calls = 0
      const client: FocusedApplicationContextClientApi = {
        ...baseClient,
        snapshot: (input) =>
          baseClient.snapshot(input).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                calls += 1
              })
            )
          )
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(context.snapshot({ actor: actor(), traceId: "\0" }))
        }),
        Layer.succeed(FocusedApplicationContext)(client)
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

test("FocusedApplicationContext unsupported client fails through public service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotInput({ actor: actor() }))
          )
        }),
        Layer.succeed(FocusedApplicationContext)(makeFocusedApplicationContextUnsupportedClient())
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
          const client = yield* FocusedApplicationContext
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

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag
