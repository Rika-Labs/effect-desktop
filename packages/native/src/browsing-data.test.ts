import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  type HostProtocolEventEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  rpcSupport
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import {
  BrowsingData,
  type BrowsingDataClientApi,
  BrowsingDataRpcs,
  BrowsingDataSurface,
  makeBrowsingDataMemoryClient,
  makeBrowsingDataUnsupportedClient
} from "./browsing-data.js"
import { makeNativeCapabilityManifest } from "./capabilities.js"
import { BrowsingDataEvent } from "./contracts/browsing-data.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"

const UnsupportedMethods = ["estimate"] as const
const PortableBrowsingDataTypes = [
  "cache",
  "cookies",
  "localStorage",
  "indexedDb",
  "history",
  "serviceWorkers"
] as const
const TestProfile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-1"),
  generation: 0,
  ownerScope: "workspace:1",
  state: "open"
} satisfies SessionProfileHandle

test("BrowsingData public surface omits shallow service and side exports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("browsing-data.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "BrowsingDataCapabilityFacts",
        "BrowsingDataRpcEvents",
        "BrowsingDataServiceApi",
        "class BrowsingDataClient",
        "BrowsingDataLive",
        "makeBrowsingDataClientLayer",
        "makeBrowsingDataServiceLayer",
        "makeBrowsingDataBridgeClientLayer",
        "makeBrowsingDataService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("BrowsingData exposes clear, listTypes, and isSupported as callable RPCs", () => {
  const callableTags = Array.from(BrowsingDataRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "BrowsingData.clear",
    "BrowsingData.events.Event",
    "BrowsingData.isSupported",
    "BrowsingData.listTypes"
  ])
})

test("BrowsingData event schema is owned by the RPC stream contract", async () => {
  const browsingDataModule = await import("./browsing-data.js")
  const rootModule = await import("./index.js")
  const eventRpc = BrowsingDataRpcs.requests.get("BrowsingData.events.Event")

  for (const removedExport of ["BrowsingDataCapabilityFacts", "BrowsingDataRpcEvents"]) {
    expect(removedExport in browsingDataModule).toBe(false)
    expect(removedExport in rootModule).toBe(false)
  }
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(BrowsingDataEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = BrowsingDataSurface.schemaDocs.find(
    (doc) => doc.tag === "BrowsingData.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("BrowsingData contract module does not export unsupported estimate payload schemas", async () => {
  const contractExports = Object.keys(await import("./contracts/browsing-data.js"))
  expect(contractExports).not.toContain("BrowsingDataEstimateInput")
  expect(contractExports).not.toContain("BrowsingDataTypeEstimate")
  expect(contractExports).not.toContain("BrowsingDataEstimateResult")
})

test("BrowsingData isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeBrowsingDataMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const browsingData = yield* BrowsingData
          return yield* browsingData.isSupported()
        }),
        browsingDataLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("BrowsingData memory client clears requested portable data types", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeBrowsingDataMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const browsingData = yield* BrowsingData
          return yield* browsingData.clear({
            profile: TestProfile,
            types: ["cache", "cookies"]
          })
        }),
        browsingDataLayer(client)
      )

      expect(result).toEqual({ cleared: ["cache", "cookies"], unsupported: [] })
    })
  ))

test("BrowsingData memory client lists portable data types", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeBrowsingDataMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const browsingData = yield* BrowsingData
          return yield* browsingData.listTypes()
        }),
        browsingDataLayer(client)
      )

      expect(result).toEqual({ types: Array.from(PortableBrowsingDataTypes) })
    })
  ))

test("BrowsingData unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeBrowsingDataUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const browsingData = yield* BrowsingData
          return yield* browsingData.isSupported()
        }),
        browsingDataLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-browsing-data-unavailable")
    })
  ))

test("BrowsingData keeps estimate as a non-callable capability fact", () => {
  const facts = BrowsingDataSurface.schemaDocs.filter((doc) => !doc.callable)
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `BrowsingData.${method}`).toSorted())
  for (const fact of facts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("BrowsingData manifest exposes supported callable methods and keeps estimate non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: BrowsingDataSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`BrowsingData.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = BrowsingDataSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableFactTags).toEqual([
        "BrowsingData.clear",
        "BrowsingData.events.Event",
        "BrowsingData.isSupported",
        "BrowsingData.listTypes"
      ])

      const nonCallableTags = BrowsingDataSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `BrowsingData.${method}`).toSorted()
      )
    })
  ))

test("BrowsingData direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
                      payload: browsingDataEvent(otherProfile)
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: browsingDataEvent(TestProfile)
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
            nextRequestId: () => "browsing-data-event-rpc",
            nextTraceId: () => "trace-browsing-data-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const browsingData = yield* BrowsingData
          return yield* browsingData
            .events(TestProfile)
            .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(BrowsingDataSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(new BrowsingDataEvent(browsingDataEvent(TestProfile)))
      expect(requests.map((request) => request.method)).toEqual(["BrowsingData.events.Event"])
    })
  ))

test("BrowsingData rejects inconsistent event phase payloads before exposing native events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidPayloads = [
        {
          type: "browsing-data-event",
          timestamp: 1_710_000_000_000,
          phase: "failed",
          profile: TestProfile,
          cleared: ["cache"],
          unsupported: [],
          message: "host failed"
        },
        {
          type: "browsing-data-event",
          timestamp: 1_710_000_000_000,
          phase: "failed",
          profile: TestProfile,
          cleared: [],
          unsupported: []
        },
        {
          type: "browsing-data-event",
          timestamp: 1_710_000_000_000,
          phase: "cleared",
          profile: TestProfile,
          cleared: ["cache"],
          unsupported: [],
          message: "host failed"
        }
      ]

      for (const payload of invalidPayloads) {
        const directDecode = yield* Effect.exit(
          Schema.decodeUnknownEffect(BrowsingDataEvent)(payload)
        )
        expect(Exit.isFailure(directDecode)).toBe(true)
      }

      for (const payload of [
        {
          type: "browsing-data-event",
          timestamp: 1_710_000_000_000,
          phase: "cleared",
          profile: TestProfile,
          cleared: ["cache"],
          unsupported: []
        },
        {
          type: "browsing-data-event",
          timestamp: 1_710_000_000_000,
          phase: "failed",
          profile: TestProfile,
          message: "host failed"
        }
      ] as const) {
        const directDecode = yield* Effect.exit(
          Schema.decodeUnknownEffect(BrowsingDataEvent)(payload)
        )
        expect(Exit.isSuccess(directDecode)).toBe(true)
      }

      const nativeEvent: HostProtocolEventEnvelope = {
        kind: "event",
        method: "BrowsingData.Event",
        timestamp: 1_710_000_000_000,
        traceId: "trace-browsing-data-event",
        payload: invalidPayloads[0]
      }
      const exchange: BridgeClientExchange = {
        request: () => Effect.fail(makeHostProtocolInternalError("unexpected request", "test")),
        subscribe: (method) => {
          expect(method).toBe("BrowsingData.Event")
          return Stream.make(nativeEvent)
        }
      }
      const bridgeDecode = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* BrowsingData
          return yield* Effect.exit(client.events().pipe(Stream.runHead))
        }),
        BrowsingDataSurface.bridgeClientLayer(exchange)
      )

      expect(Exit.isFailure(bridgeDecode)).toBe(true)
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

const browsingDataLayer = (client: BrowsingDataClientApi): Layer.Layer<BrowsingData> =>
  Layer.succeed(BrowsingData)(client)

const profileHandle = (partition: string): SessionProfileHandle =>
  Object.freeze({
    kind: "session-profile",
    id: makeResourceId(`session-profile:${partition}`),
    generation: 0,
    ownerScope: "workspace:1",
    state: "open"
  })

const browsingDataEvent = (profile: SessionProfileHandle) =>
  ({
    type: "browsing-data-event",
    timestamp: 1_710_000_000_000,
    phase: "cleared",
    profile,
    cleared: ["cookies"],
    unsupported: []
  }) as const
