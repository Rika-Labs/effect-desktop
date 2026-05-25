import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  type HostProtocolEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { SessionPermissionEvent } from "./contracts/session-permission.js"
import {
  makeSessionPermissionMemoryClient,
  makeSessionPermissionUnsupportedClient,
  SessionPermission,
  SessionPermissionRpcs,
  SessionPermissionSurface,
  type SessionPermissionClientApi
} from "./session-permission.js"

const UnsupportedMethods = ["request", "decide", "listDecisions"] as const
const UnsupportedReason = "host-session-permission-unavailable"
const ExpectedUnsupportedSupport = {
  status: "unsupported",
  reason: UnsupportedReason,
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
} as const

test("SessionPermission public surface omits shallow service and side exports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("session-permission.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "SessionPermissionCapabilityFacts",
        "SessionPermissionRpcEvents",
        "class SessionPermissionClient",
        "SessionPermissionServiceApi",
        "SessionPermissionLive",
        "makeSessionPermissionService",
        "makeSessionPermissionClientLayer",
        "makeSessionPermissionServiceLayer",
        "makeSessionPermissionBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("SessionPermission exposes support and events as callable RPCs", () => {
  const callableTags = Array.from(SessionPermissionRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["SessionPermission.events.Event", "SessionPermission.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`SessionPermission.${method}`)
  }
})

test("SessionPermission event schema is owned by the RPC stream contract", async () => {
  const sessionPermissionModule = await import("./session-permission.js")
  const rootModule = await import("./index.js")
  const eventRpc = SessionPermissionRpcs.requests.get("SessionPermission.events.Event")

  for (const removedExport of ["SessionPermissionCapabilityFacts", "SessionPermissionRpcEvents"]) {
    expect(removedExport in sessionPermissionModule).toBe(false)
    expect(removedExport in rootModule).toBe(false)
  }
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(SessionPermissionEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual(ExpectedUnsupportedSupport)
  }

  const eventDoc = SessionPermissionSurface.schemaDocs.find(
    (doc) => doc.tag === "SessionPermission.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual(ExpectedUnsupportedSupport)
})

test("SessionPermission isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSessionPermissionMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const sessionPermission = yield* SessionPermission
          return yield* sessionPermission.isSupported()
        }),
        sessionPermissionLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("SessionPermission unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionPermissionUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const sessionPermission = yield* SessionPermission
          return yield* sessionPermission.isSupported()
        }),
        sessionPermissionLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe(UnsupportedReason)
    })
  ))

test("SessionPermission declares the 3 unsupported methods as non-callable capability facts", () => {
  const facts = SessionPermissionSurface.schemaDocs.filter((doc) => !doc.callable)
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `SessionPermission.${method}`).toSorted()
  )
  for (const fact of facts) {
    expect(fact.support).toEqual(ExpectedUnsupportedSupport)
  }
})

test("SessionPermission capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SessionPermissionSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`SessionPermission.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = SessionPermissionSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableFactTags).toEqual([
        "SessionPermission.events.Event",
        "SessionPermission.isSupported"
      ])

      const nonCallableTags = SessionPermissionSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `SessionPermission.${method}`).toSorted()
      )
    })
  ))

test("SessionPermission direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const profile = profileHandle("workspace-1")
      const otherProfile = profileHandle("workspace-2")
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
                      payload: sessionPermissionEvent(otherProfile, "permission-request-2")
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: sessionPermissionEvent(profile, "permission-request-1")
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
            nextRequestId: () => "session-permission-event-rpc",
            nextTraceId: () => "trace-session-permission-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionPermission
          return yield* service.events(profile).pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(SessionPermissionSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(new SessionPermissionEvent(sessionPermissionEvent(profile)))
      expect(requests.map((request) => request.method)).toEqual(["SessionPermission.events.Event"])
    })
  ))

test("SessionPermission bridge client subscribes to the host event channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const profile = profileHandle("workspace-1")
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "trace-session-permission-event",
              payload: sessionPermissionEvent(profile)
            })
          )
        }
      }

      const event = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionPermission
          return yield* service.events(profile).pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        SessionPermissionSurface.bridgeClientLayer(exchange)
      )

      expect(event).toEqual(new SessionPermissionEvent(sessionPermissionEvent(profile)))
      expect(subscriptions).toEqual(["SessionPermission.Event"])
    })
  ))

test("SessionPermission events require decisions only for decided phase", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const baseEvent = {
        type: "session-permission-event",
        timestamp: 1710000000000,
        profile: {
          kind: "session-profile",
          id: "session-profile:workspace-1",
          generation: 0,
          ownerScope: "workspace:1",
          state: "open"
        },
        requestId: "permission-request-1",
        kind: "camera",
        origin: "https://example.test"
      } as const

      for (const event of [
        { ...baseEvent, phase: "decided" },
        { ...baseEvent, phase: "requested", decision: "grant" },
        { ...baseEvent, phase: "failed", decision: "deny" }
      ] as const) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(SessionPermissionEvent)(event))
        expect(Exit.isFailure(exit)).toBe(true)
      }

      for (const event of [
        { ...baseEvent, phase: "requested" },
        { ...baseEvent, phase: "decided", decision: "grant" },
        { ...baseEvent, phase: "failed", message: "host session permission unavailable" }
      ] as const) {
        const decoded = yield* Schema.decodeUnknownEffect(SessionPermissionEvent)(event)
        expect(decoded.phase).toBe(event.phase)
      }
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

const sessionPermissionLayer = (
  client: SessionPermissionClientApi
): Layer.Layer<SessionPermission, never, never> => Layer.succeed(SessionPermission)(client)

const profileHandle = (partition: string) =>
  Object.freeze({
    kind: "session-profile",
    id: makeResourceId(`session-profile:${partition}`),
    generation: 0,
    ownerScope: "workspace:1",
    state: "open"
  } as const)

const sessionPermissionEvent = (
  profile: ReturnType<typeof profileHandle>,
  requestId = "permission-request-1"
) =>
  ({
    type: "session-permission-event",
    timestamp: 1_710_000_000_000,
    phase: "requested",
    profile,
    requestId,
    kind: "camera",
    origin: "https://example.test"
  }) as const
