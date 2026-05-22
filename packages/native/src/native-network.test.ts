import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError
} from "@orika/bridge"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Option, Schema, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { NativeNetworkEvent, NativeNetworkSupportedResult } from "./contracts/native-network.js"
import {
  makeNativeNetworkMemoryClient,
  makeNativeNetworkBridgeClientLayer,
  makeNativeNetworkServiceLayer,
  makeNativeNetworkUnsupportedClient,
  NativeNetwork,
  NativeNetworkCapabilityFacts,
  NativeNetworkClient,
  NativeNetworkRpcs,
  NativeNetworkSurface
} from "./native-network.js"

const UnsupportedMethods = [
  "fetch",
  "upload",
  "connectWebSocket",
  "closeWebSocket",
  "localhostUrl"
] as const

const UnsupportedSupport = {
  status: "unsupported",
  reason: "host-native-network-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-native-network-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-native-network-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-native-network-unavailable" }
  ]
} as const

test("NativeNetwork exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(NativeNetworkRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["NativeNetwork.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`NativeNetwork.${method}`)
  }
})

test("NativeNetwork isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeNativeNetworkMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          return yield* network.isSupported()
        }),
        makeNativeNetworkServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("NativeNetwork unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeNativeNetworkUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const network = yield* NativeNetwork
          return yield* network.isSupported()
        }),
        makeNativeNetworkServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-native-network-unavailable")
    })
  ))

test("NativeNetwork support results reject inconsistent reasons", () => {
  for (const payload of [
    { supported: true, reason: "unexpected" },
    { supported: false }
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(NativeNetworkSupportedResult)(payload)
    )
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    { supported: true },
    { supported: false, reason: "host-native-network-unavailable" }
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(NativeNetworkSupportedResult)(payload)
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("NativeNetwork bridge client rejects inconsistent isSupported output as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const payload of [
        { supported: true, reason: "unexpected" },
        { supported: false }
      ] as const) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success", payload }),
          subscribe: () => Stream.empty
        }
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const client = yield* NativeNetworkClient
            return yield* Effect.exit(client.isSupported())
          }),
          makeNativeNetworkBridgeClientLayer(exchange)
        )

        expectInvalidOutput(exit)
      }
    })
  ))

test("NativeNetwork declares the 5 unsupported methods as non-callable capability facts", () => {
  const factTags = NativeNetworkCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `NativeNetwork.${method}`).toSorted())
  for (const fact of NativeNetworkCapabilityFacts) {
    expect(fact.support).toEqual(UnsupportedSupport)
    expect(fact.capability.kind).toBe("native.invoke")
  }
})

test("NativeNetwork capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: NativeNetworkSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`NativeNetwork.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support).toEqual(UnsupportedSupport)
      }

      const callableFactTags = NativeNetworkSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["NativeNetwork.isSupported"])

      const nonCallableTags = NativeNetworkSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `NativeNetwork.${method}`).toSorted()
      )
    })
  ))

test("NativeNetwork contracts reject sent bytes greater than total bytes", () => {
  const unknownTotalExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(NativeNetworkEvent)({
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "upload-progress",
      request: requestHandle(),
      url: "https://example.test/upload",
      sentBytes: 20
    })
  )
  const invalidExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(NativeNetworkEvent)({
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "upload-progress",
      request: requestHandle(),
      url: "https://example.test/upload",
      sentBytes: 20,
      totalBytes: 10
    })
  )

  expect(unknownTotalExit._tag).toBe("Success")
  expect(invalidExit._tag).toBe("Failure")
})

test("NativeNetwork contracts reject inconsistent event phase payloads", () => {
  const socket = socketHandle()
  const request = requestHandle()
  const invalidPayloads = [
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "fetch-completed",
      socket,
      url: "wss://example.test/socket"
    },
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "websocket-opened",
      request,
      url: "https://example.test/data"
    },
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      request,
      socket,
      url: "https://example.test/data",
      message: "host failed"
    }
  ] as const

  for (const payload of invalidPayloads) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(NativeNetworkEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "fetch-completed",
      request,
      url: "https://example.test/data"
    },
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "upload-progress",
      request,
      url: "https://example.test/upload",
      sentBytes: 20,
      totalBytes: 100
    },
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "websocket-opened",
      socket,
      url: "wss://example.test/socket"
    },
    {
      type: "native-network-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      request,
      url: "https://example.test/data",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(NativeNetworkEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("NativeNetwork bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("NativeNetwork test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "native-network-event-trace",
              payload: {
                type: "native-network-event",
                timestamp: 1_710_000_000_000,
                phase: "fetch-completed",
                socket: socketHandle(),
                url: "wss://example.test/socket"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* NativeNetworkClient
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        makeNativeNetworkBridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

test("NativeNetwork bridge client rejects invalid byte progress events as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("NativeNetwork test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "native-network-event-trace",
              payload: {
                type: "native-network-event",
                timestamp: 1_710_000_000_000,
                phase: "upload-progress",
                request: requestHandle(),
                url: "https://example.test/upload",
                sentBytes: 20,
                totalBytes: 10
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* NativeNetworkClient
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        makeNativeNetworkBridgeClientLayer(exchange)
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

const requestHandle = () =>
  ({
    kind: "native-network-request",
    id: "request-1",
    generation: 0,
    ownerScope: "scope-1",
    state: "open"
  }) as const

const socketHandle = () =>
  ({
    kind: "native-network-websocket",
    id: "socket-1",
    generation: 0,
    ownerScope: "scope-1",
    state: "open"
  }) as const

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
