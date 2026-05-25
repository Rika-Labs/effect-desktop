import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  type HostProtocolEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { SessionProfileEvent, SessionProfileOpenedEvent } from "./contracts/session-profile.js"
import {
  makeSessionProfileMemoryClient,
  makeSessionProfileUnsupportedClient,
  SessionProfile,
  type SessionProfileClientApi,
  SessionProfileRpcs,
  SessionProfileSurface
} from "./session-profile.js"

const CallableMethods = ["fromPartition", "destroy", "list", "isSupported"] as const
const ExpectedSupported = { status: "supported" } as const

test("SessionProfile public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("session-profile.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "SessionProfileServiceApi",
        "class SessionProfileClient",
        "SessionProfileLive",
        "makeSessionProfileClientLayer",
        "makeSessionProfileServiceLayer",
        "makeSessionProfileBridgeClientLayer",
        "makeSessionProfileService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("SessionProfile exposes profile lifecycle methods as callable RPCs", () => {
  const callableTags = Array.from(SessionProfileRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "SessionProfile.destroy",
    "SessionProfile.events.Event",
    "SessionProfile.fromPartition",
    "SessionProfile.isSupported",
    "SessionProfile.list"
  ])
})

test("SessionProfile event schema is owned by the RPC stream contract", async () => {
  const sessionProfileModule = await import("./session-profile.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(SessionProfileRpcs.requests.keys()).toSorted()
  const eventRpc = SessionProfileRpcs.requests.get("SessionProfile.events.Event")

  for (const removedExport of ["SessionProfileCapabilityFacts", "SessionProfileRpcEvents"]) {
    expect(removedExport in sessionProfileModule).toBe(false)
    expect(removedExport in rootModule).toBe(false)
  }
  expect(callableTags).toEqual([
    "SessionProfile.destroy",
    "SessionProfile.events.Event",
    "SessionProfile.fromPartition",
    "SessionProfile.isSupported",
    "SessionProfile.list"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(SessionProfileEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual(ExpectedSupported)
  }

  const eventDoc = SessionProfileSurface.schemaDocs.find(
    (doc) => doc.tag === "SessionProfile.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual(ExpectedSupported)
})

test("SessionProfile lifecycle methods surface in the manifest as callable supported RPCs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SessionProfileSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of CallableMethods) {
        const fact = byTag.get(`SessionProfile.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("supported")
      }

      const callableTags = SessionProfileSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual([
        "SessionProfile.destroy",
        "SessionProfile.events.Event",
        "SessionProfile.fromPartition",
        "SessionProfile.isSupported",
        "SessionProfile.list"
      ])

      const nonCallableTags = SessionProfileSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual([])
    })
  ))

test("SessionProfile memory client creates, lists, and destroys partition handles", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSessionProfileMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          const profile = yield* service.fromPartition({
            partition: "workspace-1",
            ownerScope: "workspace:1"
          })
          const sameProfile = yield* service.fromPartition({
            partition: "workspace-1",
            ownerScope: "workspace:1"
          })
          const beforeDestroy = yield* service.list()
          yield* service.destroy(profile)
          const afterDestroy = yield* service.list()
          return { afterDestroy, beforeDestroy, profile, sameProfile }
        }),
        sessionProfileLayer(client)
      )

      expect(result.profile).toMatchObject({
        kind: "session-profile",
        id: "session-profile:workspace-1",
        generation: 0,
        ownerScope: "workspace:1",
        state: "open"
      })
      expect(result.sameProfile).toEqual(result.profile)
      expect(result.beforeDestroy.profiles).toEqual([result.profile])
      expect(result.afterDestroy.profiles).toEqual([])
    })
  ))

test("SessionProfile isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSessionProfileMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* service.isSupported()
        }),
        sessionProfileLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("SessionProfile unsupported client reports the host-routing-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionProfileUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* service.isSupported()
        }),
        sessionProfileLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-session-profile-routing-unavailable")
    })
  ))

test("SessionProfile unsupported client fails lifecycle methods as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionProfileUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* Effect.exit(service.fromPartition({ partition: "workspace-1" }))
        }),
        sessionProfileLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-session-profile-routing-unavailable",
          operation: "SessionProfile.fromPartition"
        })
      })
    })
  ))

test("SessionProfile unsupported client fails the event stream as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionProfileUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* Effect.exit(service.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        sessionProfileLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-session-profile-routing-unavailable",
          operation: "SessionProfile.Event"
        })
      })
    })
  ))

test("SessionProfile contracts reject inconsistent event phase payloads", () => {
  const profile = profileHandle()
  const invalidPayloads = [
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "opened",
      message: "host failed"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "closed",
      profile,
      partition: "workspace-1",
      message: "closed with failure"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      profile,
      partition: "workspace-1",
      message: "host failed"
    }
  ] as const

  for (const payload of invalidPayloads) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(SessionProfileEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "opened",
      profile,
      partition: "workspace-1"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "closed",
      profile,
      partition: "workspace-1"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(SessionProfileEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("SessionProfile event types reject impossible phase payloads", () => {
  type SessionProfileEventValue = typeof SessionProfileEvent.Type
  const profile = profileHandle()
  const baseEvent = {
    type: "session-profile-event",
    timestamp: 1_710_000_000_000
  } as const

  const opened: SessionProfileEventValue = {
    ...baseEvent,
    phase: "opened",
    profile,
    partition: "workspace-1"
  }
  const closed: SessionProfileEventValue = {
    ...baseEvent,
    phase: "closed",
    profile,
    partition: "workspace-1"
  }
  const failed: SessionProfileEventValue = {
    ...baseEvent,
    phase: "failed",
    message: "host failed"
  }

  expect(opened.phase).toBe("opened")
  expect(closed.partition).toBe("workspace-1")
  expect(failed.message).toBe("host failed")

  // @ts-expect-error opened session profile events must not carry message.
  const openedWithMessage: SessionProfileEventValue = {
    ...baseEvent,
    phase: "opened",
    profile,
    partition: "workspace-1",
    message: "host failed"
  }
  // @ts-expect-error closed session profile events require partition.
  const closedWithoutPartition: SessionProfileEventValue = {
    ...baseEvent,
    phase: "closed",
    profile
  }
  // @ts-expect-error failed session profile events must not carry profile or partition.
  const failedWithProfile: SessionProfileEventValue = {
    ...baseEvent,
    phase: "failed",
    profile,
    partition: "workspace-1",
    message: "host failed"
  }

  expect(openedWithMessage.phase).toBe("opened")
  expect(closedWithoutPartition.phase).toBe("closed")
  expect(failedWithProfile.phase).toBe("failed")
})

test("SessionProfile direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const profile = profileHandle()
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
                      timestamp: 1_710_000_000_000,
                      traceId: envelope.traceId,
                      payload: {
                        type: "session-profile-event",
                        timestamp: 1_710_000_000_000,
                        phase: "opened",
                        profile,
                        partition: "workspace-1"
                      }
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
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
            nextRequestId: () => "session-profile-event-rpc",
            nextTraceId: () => "trace-session-profile-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* service.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(SessionProfileSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(
        new SessionProfileOpenedEvent({
          type: "session-profile-event",
          timestamp: 1_710_000_000_000,
          phase: "opened",
          profile,
          partition: "workspace-1"
        })
      )
      expect(requests.map((request) => request.method)).toEqual(["SessionProfile.events.Event"])
    })
  ))

test("SessionProfile bridge client subscribes to the host event channel", () =>
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

      const collected = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* service.events().pipe(Stream.runCollect)
        }),
        SessionProfileSurface.bridgeClientLayer(exchange)
      )

      expect(Array.from(collected)).toEqual([])
      expect(subscriptions).toEqual(["SessionProfile.Event"])
    })
  ))

test("SessionProfile bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("SessionProfile test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "session-profile-event-trace",
              payload: {
                type: "session-profile-event",
                timestamp: 1_710_000_000_000,
                phase: "opened",
                message: "host failed"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* Effect.exit(
            service.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        SessionProfileSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

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

const sessionProfileLayer = (client: SessionProfileClientApi): Layer.Layer<SessionProfile> =>
  Layer.succeed(SessionProfile)(client)

const profileHandle = () =>
  ({
    kind: "session-profile",
    id: makeResourceId("session-profile:workspace-1"),
    generation: 0,
    ownerScope: "workspace:1",
    state: "open"
  }) as const

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
