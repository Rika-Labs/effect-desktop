import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import {
  Cause,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  type Schema,
  Stream
} from "effect"
import { expect, test } from "bun:test"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import {
  Native,
  NativeCapabilities,
  RealtimeMediaSession,
  RealtimeMediaSessionLive,
  RealtimeMediaSessionMethodNames,
  RealtimeMediaSessionRpcs,
  makeNativeCapabilitiesLayer,
  makeRealtimeMediaSessionMemoryClient,
  makeRealtimeMediaSessionPermissionDeniedError,
  makeRealtimeMediaSessionUnsupportedClient,
  RealtimeMediaSessionClient,
  RealtimeMediaSessionSurface
} from "./index.js"
import {
  RealtimeMediaDeviceStateEvent,
  RealtimeMediaInterruptionEvent,
  RealtimeMediaPermissionStateEvent,
  RealtimeMediaSessionOpenInput,
  RealtimeMediaSessionSelectDeviceInput,
  RealtimeMediaSessionStateEvent,
  RealtimeMediaSessionSupportedResult
} from "./contracts/index.js"

const RealtimeMediaSessionEventTags = [
  "RealtimeMediaSession.events.DeviceState",
  "RealtimeMediaSession.events.PermissionState",
  "RealtimeMediaSession.events.Interruption",
  "RealtimeMediaSession.events.SessionState"
] as const

test("RealtimeMediaSession public surface omits the side event object", async () => {
  const mediaModule = await import("./realtime-media-session.js")
  const rootModule = await import("./index.js")

  expect("RealtimeMediaSessionRpcEvents" in mediaModule).toBe(false)
  expect("RealtimeMediaSessionRpcEvents" in rootModule).toBe(false)
})

test("RealtimeMediaSession declares a narrow RPC and event surface", () => {
  expect([...RealtimeMediaSessionMethodNames]).toEqual([
    "open",
    "close",
    "selectDevice",
    "interrupt",
    "isSupported"
  ])
  expect([...RealtimeMediaSessionRpcs.requests.keys()]).toEqual([
    "RealtimeMediaSession.open",
    "RealtimeMediaSession.close",
    "RealtimeMediaSession.selectDevice",
    "RealtimeMediaSession.interrupt",
    "RealtimeMediaSession.isSupported",
    ...RealtimeMediaSessionEventTags
  ])
})

test("RealtimeMediaSession event schemas are owned by RPC stream contracts", () => {
  const expectedSchemas: ReadonlyArray<
    readonly [string, Schema.Codec<unknown, unknown, never, never>]
  > = [
    ["RealtimeMediaSession.events.DeviceState", RealtimeMediaDeviceStateEvent],
    ["RealtimeMediaSession.events.PermissionState", RealtimeMediaPermissionStateEvent],
    ["RealtimeMediaSession.events.Interruption", RealtimeMediaInterruptionEvent],
    ["RealtimeMediaSession.events.SessionState", RealtimeMediaSessionStateEvent]
  ]

  for (const [tag, schema] of expectedSchemas) {
    const eventRpc = RealtimeMediaSessionRpcs.requests.get(tag)
    expect(eventRpc).toBeDefined()
    expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
      true
    )
    if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
      expect(eventRpc.successSchema.success).toBe(schema)
      expect(eventRpc.pipe(rpcSupport)).toMatchObject({
        status: "partial",
        reason: "host-media-startup-unverified"
      })
    }
  }
})

test("RealtimeMediaSession memory client exercises success, partitioned streams, and replay", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeRealtimeMediaSessionMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          yield* media.open(new RealtimeMediaSessionOpenInput({ profileId: "p1", sessionId: "s1" }))
          yield* media.open(new RealtimeMediaSessionOpenInput({ profileId: "p2", sessionId: "s1" }))
          yield* media.selectDevice(
            new RealtimeMediaSessionSelectDeviceInput({
              profileId: "p1",
              sessionId: "s1",
              kind: "microphone",
              deviceId: "mic-1"
            })
          )

          const p1Device = yield* media
            .deviceState({ profileId: "p1", sessionId: "s1" })
            .pipe(Stream.take(1), Stream.runCollect)
          const p2Device = yield* media
            .deviceState({ profileId: "p2", sessionId: "s1" })
            .pipe(Stream.take(1), Stream.runCollect, Effect.timeoutOption("20 millis"))

          return { p1Device, p2Device }
        }),
        Layer.provide(RealtimeMediaSessionLive, Layer.succeed(RealtimeMediaSessionClient)(client))
      )

      expect(Array.from(result.p1Device)).toEqual([
        new RealtimeMediaDeviceStateEvent({
          type: "device-state",
          profileId: "p1",
          sessionId: "s1",
          devices: [
            {
              kind: "microphone",
              deviceId: "mic-1",
              label: "mic-1",
              selected: true,
              available: true
            }
          ]
        })
      ])
      expect(Option.isNone(result.p2Device)).toBe(true)
    })
  ))

test("RealtimeMediaSession memory client exposes typed permission-denied failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeRealtimeMediaSessionMemoryClient({
        failure: {
          open: makeRealtimeMediaSessionPermissionDeniedError("RealtimeMediaSession.open")
        }
      })
      const error = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          return yield* Effect.flip(
            media.open(new RealtimeMediaSessionOpenInput({ profileId: "p1", sessionId: "s1" }))
          )
        }),
        Layer.provide(RealtimeMediaSessionLive, Layer.succeed(RealtimeMediaSessionClient)(client))
      )

      expect(error).toMatchObject({
        tag: "PermissionDenied",
        operation: "RealtimeMediaSession.open"
      })
    })
  ))

test("RealtimeMediaSession unsupported client validates malformed input before unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          return yield* Effect.exit(media.open(invalidOpenInput()))
        }),
        Layer.provide(
          RealtimeMediaSessionLive,
          Layer.succeed(RealtimeMediaSessionClient)(makeRealtimeMediaSessionUnsupportedClient())
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          tag: "InvalidArgument",
          operation: "RealtimeMediaSession.open"
        })
      }
    })
  ))

test("RealtimeMediaSession bridge client sends typed envelopes and decodes events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = realtimeMediaSessionExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "RealtimeMediaSession.isSupported" ? { supported: true } : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          const supported = yield* media.isSupported()
          yield* media.open(new RealtimeMediaSessionOpenInput({ profileId: "p1", sessionId: "s1" }))
          yield* media.selectDevice(
            new RealtimeMediaSessionSelectDeviceInput({
              profileId: "p1",
              sessionId: "s1",
              kind: "speaker",
              deviceId: "speaker-1"
            })
          )
          const interruption = yield* media
            .interruptions({ profileId: "p1", sessionId: "s1" })
            .pipe(Stream.take(1), Stream.runCollect)
          yield* media.close({ profileId: "p1", sessionId: "s1" })

          return { interruption, supported }
        }),
        Layer.provide(
          RealtimeMediaSessionLive,
          RealtimeMediaSessionSurface.bridgeClientLayer(exchange)
        )
      )

      expect(result.supported).toEqual(
        new RealtimeMediaSessionSupportedResult({
          supported: true
        })
      )
      expect(Array.from(result.interruption)).toEqual([
        new RealtimeMediaInterruptionEvent({
          type: "interruption",
          profileId: "p1",
          sessionId: "s1",
          reason: "background"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["RealtimeMediaSession.isSupported", null],
        ["RealtimeMediaSession.open", { profileId: "p1", sessionId: "s1" }],
        [
          "RealtimeMediaSession.selectDevice",
          { profileId: "p1", sessionId: "s1", kind: "speaker", deviceId: "speaker-1" }
        ],
        ["RealtimeMediaSession.isSupported", null],
        ["RealtimeMediaSession.close", { profileId: "p1", sessionId: "s1" }]
      ])
    })
  ))

test("RealtimeMediaSession direct client consumes canonical RPC event streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* directRealtimeMediaSessionInterruption({
        type: "interruption",
        profileId: "p1",
        sessionId: "s1",
        reason: "background"
      })

      expect(result.event).toEqual(
        new RealtimeMediaInterruptionEvent({
          type: "interruption",
          profileId: "p1",
          sessionId: "s1",
          reason: "background"
        })
      )
      expect(result.methods.toSorted()).toEqual([...RealtimeMediaSessionEventTags].toSorted())
    })
  ))

test("RealtimeMediaSession direct client exposes the unpartitioned canonical event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* directRealtimeMediaSessionInterruption(
        {
          type: "interruption",
          profileId: "p1",
          sessionId: "s1",
          reason: "background"
        },
        "all"
      )

      expect(result.event).toEqual(
        new RealtimeMediaInterruptionEvent({
          type: "interruption",
          profileId: "p1",
          sessionId: "s1",
          reason: "background"
        })
      )
      expect(result.methods.toSorted()).toEqual([...RealtimeMediaSessionEventTags].toSorted())
    })
  ))

test("RealtimeMediaSession bridge client exposes the unpartitioned event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = realtimeMediaSessionExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "RealtimeMediaSession.isSupported" ? { supported: true } : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          return yield* media.events().pipe(Stream.take(1), Stream.runCollect)
        }),
        Layer.provide(
          RealtimeMediaSessionLive,
          RealtimeMediaSessionSurface.bridgeClientLayer(exchange)
        )
      )

      expect(Array.from(result)).toEqual([
        new RealtimeMediaInterruptionEvent({
          type: "interruption",
          profileId: "p1",
          sessionId: "s1",
          reason: "background"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["RealtimeMediaSession.isSupported", null]
      ])
    })
  ))

test("RealtimeMediaSession bridge event streams fail typed unsupported when host startup is unverified", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = realtimeMediaSessionExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "RealtimeMediaSession.isSupported"
            ? { supported: false, reason: "host-media-startup-unverified" }
            : undefined
      }))

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          return yield* Effect.exit(
            media
              .events({ profileId: "p1", sessionId: "s1" })
              .pipe(Stream.take(1), Stream.runCollect)
          )
        }),
        Layer.provide(
          RealtimeMediaSessionLive,
          RealtimeMediaSessionSurface.bridgeClientLayer(exchange)
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          tag: "Unsupported",
          reason: "host-media-startup-unverified",
          operation: "RealtimeMediaSession.events"
        })
      }
    })
  ))

test("RealtimeMediaSession bridge client rejects malformed input before native transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const media = yield* RealtimeMediaSession
          return yield* Effect.exit(media.open(invalidOpenInput()))
        }),
        Layer.provide(
          RealtimeMediaSessionLive,
          RealtimeMediaSessionSurface.bridgeClientLayer(
            realtimeMediaSessionExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      expect(requests).toEqual([])
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          tag: "InvalidArgument",
          operation: "RealtimeMediaSession.open"
        })
      }
    })
  ))

test("NativeCapabilities reports realtime media privileged operation support truthfully", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const capabilities = yield* NativeCapabilities
          const openSupport = yield* capabilities.support("RealtimeMediaSession.open")
          const closeSupport = yield* capabilities.support("RealtimeMediaSession.close")
          const selectDeviceSupport = yield* capabilities.support(
            "RealtimeMediaSession.selectDevice"
          )
          const interruptSupport = yield* capabilities.support("RealtimeMediaSession.interrupt")
          const requireOpen = yield* Effect.exit(capabilities.require("RealtimeMediaSession.open"))
          const requireClose = yield* Effect.exit(
            capabilities.require("RealtimeMediaSession.close")
          )
          const requireSelectDevice = yield* Effect.exit(
            capabilities.require("RealtimeMediaSession.selectDevice")
          )
          const requireInterrupt = yield* Effect.exit(
            capabilities.require("RealtimeMediaSession.interrupt")
          )
          return {
            closeSupport,
            interruptSupport,
            openSupport,
            requireClose,
            requireInterrupt,
            requireOpen,
            requireSelectDevice,
            selectDeviceSupport
          }
        }),
        makeNativeCapabilitiesLayer(Native.available(Native.RealtimeMediaSession))
      )

      expect(result.closeSupport).toEqual({
        status: "partial",
        reason: "host-media-startup-unverified",
        platforms: [
          { platform: "macos", status: "supported" },
          { platform: "windows", status: "unsupported", reason: "host-media-startup-unverified" },
          { platform: "linux", status: "unsupported", reason: "host-media-startup-unverified" }
        ]
      })
      expect(result.openSupport).toEqual(result.closeSupport)
      expect(result.selectDeviceSupport).toEqual(result.closeSupport)
      expect(result.interruptSupport).toEqual(result.closeSupport)
      expect(Exit.isSuccess(result.requireOpen)).toBe(true)
      expect(Exit.isSuccess(result.requireClose)).toBe(true)
      expect(Exit.isSuccess(result.requireSelectDevice)).toBe(true)
      expect(Exit.isSuccess(result.requireInterrupt)).toBe(true)
    })
  ))

const realtimeMediaSessionExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "RealtimeMediaSession.Interruption"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000800,
            traceId: "event-trace",
            method,
            payload: {
              type: "interruption",
              profileId: "p1",
              sessionId: "s1",
              reason: "background"
            }
          })
        )
      : Stream.empty
})

const directRealtimeMediaSessionInterruption = (
  payload: unknown,
  mode: "all" | "session" = "session"
) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
    const requests: HostProtocolRequestEnvelope[] = []
    let requestId = 0
    const protocolLayer = Layer.effect(RpcClient.Protocol)(
      makeDesktopClientProtocol(
        {
          send: (envelope) => {
            if (envelope.kind !== "request") {
              return Effect.void
            }
            requests.push(envelope)
            const eventEnvelope =
              envelope.method === "RealtimeMediaSession.events.Interruption"
                ? Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload
                    })
                  )
                : Effect.void
            return Effect.all(
              [
                eventEnvelope,
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
          nextRequestId: () => `realtime-media-event-request-${requestId++}`,
          nextTraceId: () => "realtime-media-event-trace"
        }
      )
    )

    const event = yield* runScoped(
      Effect.gen(function* () {
        const media = yield* RealtimeMediaSession
        const stream =
          mode === "all"
            ? media.events()
            : media.interruptions({ profileId: "p1", sessionId: "s1" })
        return yield* stream.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      }),
      Layer.provide(RealtimeMediaSessionLive, RealtimeMediaSessionSurface.clientLayer).pipe(
        Layer.provide(protocolLayer)
      )
    )

    return {
      event,
      methods: requests.map((request) => request.method)
    }
  })

const invalidOpenInput = (): RealtimeMediaSessionOpenInput => {
  const input = new RealtimeMediaSessionOpenInput({
    profileId: "profile",
    sessionId: "s1"
  })
  Object.defineProperty(input, "profileId", { value: "" })
  return input
}

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })
