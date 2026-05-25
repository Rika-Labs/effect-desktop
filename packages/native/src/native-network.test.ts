import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { NativeNetworkEvent, NativeNetworkSupportedResult } from "./contracts/native-network.js"
import {
  makeNativeNetworkMemoryClient,
  makeNativeNetworkUnsupportedClient,
  NativeNetwork,
  NativeNetworkRpcs,
  NativeNetworkSurface,
  type NativeNetworkClientApi
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

test("NativeNetwork public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("native-network.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "NativeNetwork" + "CapabilityFacts",
        "class NativeNetworkClient",
        "NativeNetworkLive",
        "NativeNetworkServiceApi",
        "makeNativeNetworkService",
        "makeNativeNetworkClientLayer",
        "makeNativeNetworkServiceLayer",
        "makeNativeNetworkBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("NativeNetwork exposes isSupported and its event stream as callable RPCs", () => {
  const callableTags = Array.from(NativeNetworkRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["NativeNetwork.events.Event", "NativeNetwork.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`NativeNetwork.${method}`)
  }
})

test("NativeNetwork event schema is owned by the RPC stream contract", async () => {
  const nativeNetworkModule = await import("./native-network.js")
  const eventRpc = NativeNetworkRpcs.requests.get("NativeNetwork.events.Event")

  expect("NativeNetworkRpcEvents" in nativeNetworkModule).toBe(false)
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(NativeNetworkEvent)
  }

  const eventDoc = NativeNetworkSurface.schemaDocs.find(
    (doc) => doc.tag === "NativeNetwork.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
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
        nativeNetworkLayer(client)
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
        nativeNetworkLayer(client)
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

test("NativeNetwork direct client consumes the canonical RPC event stream", () =>
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
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: {
                        type: "native-network-event",
                        timestamp: 1_710_000_000_001,
                        phase: "fetch-completed",
                        request: requestHandle(),
                        url: "https://example.test/data"
                      }
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
            nextRequestId: () => "native-network-event-rpc",
            nextTraceId: () => "trace-native-network-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* NativeNetwork
          return yield* client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(NativeNetworkSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(
        new NativeNetworkEvent({
          type: "native-network-event",
          timestamp: 1_710_000_000_001,
          phase: "fetch-completed",
          request: requestHandle(),
          url: "https://example.test/data"
        })
      )
      expect(requests.map((request) => request.method)).toEqual(["NativeNetwork.events.Event"])
    })
  ))

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
            const client = yield* NativeNetwork
            return yield* Effect.exit(client.isSupported())
          }),
          NativeNetworkSurface.bridgeClientLayer(exchange)
        )

        expectInvalidOutput(exit)
      }
    })
  ))

test("NativeNetwork declares the 5 unsupported methods as non-callable capability facts", () => {
  const facts = nativeNetworkCapabilityFacts()
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `NativeNetwork.${method}`).toSorted())
  for (const fact of facts) {
    expect(fact.support).toEqual(UnsupportedSupport)
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
        expect(fact?.capability.kind).toBe("native.invoke")
      }

      const callableFactTags = NativeNetworkSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["NativeNetwork.isSupported", "NativeNetwork.events.Event"])
      expect(byTag.get("NativeNetwork.events.Event")?.capability.kind).toBe("none")
      expect(byTag.get("NativeNetwork.events.Event")?.support).toEqual({ status: "supported" })

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
          const client = yield* NativeNetwork
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        NativeNetworkSurface.bridgeClientLayer(exchange)
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
          const client = yield* NativeNetwork
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        NativeNetworkSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

test("NativeNetwork bridge client validates event payloads through the RPC stream contract", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const eventMethods: string[] = []
      const exchange: BridgeClientExchange = {
        request: () =>
          Effect.die("NativeNetwork event contract test does not issue bridge requests"),
        subscribe: (method) => {
          eventMethods.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "native-network-event-trace",
              payload: {
                type: "native-network-event",
                timestamp: 1_710_000_000_000,
                phase: "fetch-completed",
                request: requestHandle(),
                url: "https://example.test/data",
                unexpected: "must be rejected by strict contract decode"
              }
            })
          )
        }
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* NativeNetwork
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        NativeNetworkSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
      expect(eventMethods).toEqual(["NativeNetwork.Event"])
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

const nativeNetworkLayer = (client: NativeNetworkClientApi): Layer.Layer<NativeNetwork> =>
  Layer.succeed(NativeNetwork)(client)

const nativeNetworkCapabilityFacts = () =>
  NativeNetworkSurface.schemaDocs.filter((doc) => !doc.callable)

const requestHandle = () =>
  ({
    kind: "native-network-request",
    id: makeResourceId("native-network-request:1"),
    generation: 0,
    ownerScope: "scope-1",
    state: "open"
  }) as const

const socketHandle = () =>
  ({
    kind: "native-network-websocket",
    id: makeResourceId("native-network-websocket:1"),
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
