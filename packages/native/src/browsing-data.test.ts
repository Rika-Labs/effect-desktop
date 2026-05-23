import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolEventEnvelope,
  makeHostProtocolInternalError
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Effect, Exit, Layer, ManagedRuntime, Schema, Stream } from "effect"

import {
  BrowsingData,
  BrowsingDataCapabilityFacts,
  BrowsingDataClient,
  BrowsingDataRpcs,
  BrowsingDataSurface,
  makeBrowsingDataMemoryClient,
  makeBrowsingDataUnsupportedClient,
  BrowsingDataLive
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

test("BrowsingData exposes clear, listTypes, and isSupported as callable RPCs", () => {
  const callableTags = Array.from(BrowsingDataRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "BrowsingData.clear",
    "BrowsingData.isSupported",
    "BrowsingData.listTypes"
  ])
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
        Layer.provide(BrowsingDataLive, Layer.succeed(BrowsingDataClient)(client))
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
        Layer.provide(BrowsingDataLive, Layer.succeed(BrowsingDataClient)(client))
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
        Layer.provide(BrowsingDataLive, Layer.succeed(BrowsingDataClient)(client))
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
        Layer.provide(BrowsingDataLive, Layer.succeed(BrowsingDataClient)(client))
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-browsing-data-unavailable")
    })
  ))

test("BrowsingData keeps estimate as a non-callable capability fact", () => {
  const factTags = BrowsingDataCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `BrowsingData.${method}`).toSorted())
  for (const fact of BrowsingDataCapabilityFacts) {
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
          const client = yield* BrowsingDataClient
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
