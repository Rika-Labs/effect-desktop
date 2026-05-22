import { expect, test } from "bun:test"
import { makeResourceId } from "@orika/core"
import { Effect, type Layer, ManagedRuntime } from "effect"

import {
  BrowsingData,
  BrowsingDataCapabilityFacts,
  BrowsingDataRpcs,
  BrowsingDataSurface,
  makeBrowsingDataMemoryClient,
  makeBrowsingDataServiceLayer,
  makeBrowsingDataUnsupportedClient
} from "./browsing-data.js"
import { makeNativeCapabilityManifest } from "./capabilities.js"
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
        makeBrowsingDataServiceLayer(client)
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
        makeBrowsingDataServiceLayer(client)
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
        makeBrowsingDataServiceLayer(client)
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
        makeBrowsingDataServiceLayer(client)
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
