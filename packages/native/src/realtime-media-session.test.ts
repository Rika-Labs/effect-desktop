import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  HostProtocolEventEnvelope,
  type HostProtocolRequestEnvelope
} from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect"
import { expect, test } from "bun:test"

import {
  Native,
  NativeCapabilities,
  RealtimeMediaSession,
  RealtimeMediaSessionLive,
  RealtimeMediaSessionMethodNames,
  RealtimeMediaSessionRpcs,
  RealtimeMediaSessionRpcEvents,
  makeNativeCapabilitiesLayer,
  makeRealtimeMediaSessionBridgeClientLayer,
  makeRealtimeMediaSessionMemoryClient,
  makeRealtimeMediaSessionPermissionDeniedError,
  makeRealtimeMediaSessionServiceLayer,
  makeRealtimeMediaSessionUnsupportedClient
} from "./index.js"
import {
  RealtimeMediaDeviceStateEvent,
  RealtimeMediaInterruptionEvent,
  RealtimeMediaSessionOpenInput,
  RealtimeMediaSessionSelectDeviceInput,
  RealtimeMediaSessionSupportedResult
} from "./contracts/index.js"

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
    "RealtimeMediaSession.isSupported"
  ])
  expect(Object.keys(RealtimeMediaSessionRpcEvents)).toEqual([
    "DeviceState",
    "PermissionState",
    "Interruption",
    "SessionState"
  ])
})

test("RealtimeMediaSession memory client exercises success, partitioned streams, and replay", async () => {
  const client = await Effect.runPromise(makeRealtimeMediaSessionMemoryClient())

  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeRealtimeMediaSessionServiceLayer(client)))
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

test("RealtimeMediaSession memory client exposes typed permission-denied failures", async () => {
  const client = await Effect.runPromise(
    makeRealtimeMediaSessionMemoryClient({
      failure: {
        open: makeRealtimeMediaSessionPermissionDeniedError("RealtimeMediaSession.open")
      }
    })
  )
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      return yield* Effect.flip(
        media.open(new RealtimeMediaSessionOpenInput({ profileId: "p1", sessionId: "s1" }))
      )
    }).pipe(Effect.provide(makeRealtimeMediaSessionServiceLayer(client)))
  )

  expect(error).toMatchObject({
    tag: "PermissionDenied",
    operation: "RealtimeMediaSession.open"
  })
})

test("RealtimeMediaSession unsupported client validates malformed input before unsupported", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      return yield* Effect.exit(media.open(invalidOpenInput()))
    }).pipe(
      Effect.provide(
        makeRealtimeMediaSessionServiceLayer(makeRealtimeMediaSessionUnsupportedClient())
      )
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

test("RealtimeMediaSession bridge client sends typed envelopes and decodes events", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = realtimeMediaSessionExchange(requests, (request) => ({
    kind: "success",
    payload: request.method === "RealtimeMediaSession.isSupported" ? { supported: true } : undefined
  }))

  const result = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        Layer.provide(RealtimeMediaSessionLive, makeRealtimeMediaSessionBridgeClientLayer(exchange))
      )
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

test("RealtimeMediaSession bridge event streams fail typed unsupported when host startup is unverified", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = realtimeMediaSessionExchange(requests, (request) => ({
    kind: "success",
    payload:
      request.method === "RealtimeMediaSession.isSupported"
        ? { supported: false, reason: "host-media-startup-unverified" }
        : undefined
  }))

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      return yield* Effect.exit(
        media.events({ profileId: "p1", sessionId: "s1" }).pipe(Stream.take(1), Stream.runCollect)
      )
    }).pipe(
      Effect.provide(
        Layer.provide(RealtimeMediaSessionLive, makeRealtimeMediaSessionBridgeClientLayer(exchange))
      )
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

test("RealtimeMediaSession bridge client rejects malformed input before native transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      return yield* Effect.exit(media.open(invalidOpenInput()))
    }).pipe(
      Effect.provide(
        Layer.provide(
          RealtimeMediaSessionLive,
          makeRealtimeMediaSessionBridgeClientLayer(
            realtimeMediaSessionExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
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

test("NativeCapabilities reports realtime media privileged operations as runtime-verified partial support", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const support = yield* capabilities.support("RealtimeMediaSession.open")
      const requireOpen = yield* Effect.exit(capabilities.require("RealtimeMediaSession.open"))
      return { requireOpen, support }
    }).pipe(
      Effect.provide(makeNativeCapabilitiesLayer(Native.available(Native.RealtimeMediaSession)))
    )
  )

  expect(exit.support).toEqual({
    status: "partial",
    reason: "host-media-runtime-verified",
    platforms: [
      { platform: "macos", status: "partial", reason: "host-media-runtime-verified" },
      { platform: "windows", status: "unsupported", reason: "host-media-startup-unverified" },
      { platform: "linux", status: "unsupported", reason: "host-media-startup-unverified" }
    ]
  })
  expect(Exit.isSuccess(exit.requireOpen)).toBe(true)
})

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

const invalidOpenInput = (): RealtimeMediaSessionOpenInput => {
  const input = new RealtimeMediaSessionOpenInput({
    profileId: "profile",
    sessionId: "s1"
  })
  Object.defineProperty(input, "profileId", { value: "" })
  return input
}
