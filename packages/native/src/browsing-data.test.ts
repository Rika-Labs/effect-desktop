import { expect, test } from "bun:test"
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

const UnsupportedMethods = ["clear", "estimate", "listTypes"] as const

test("BrowsingData exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(BrowsingDataRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["BrowsingData.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`BrowsingData.${method}`)
  }
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

test("BrowsingData declares the 3 unsupported methods as non-callable capability facts", () => {
  const factTags = BrowsingDataCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `BrowsingData.${method}`).toSorted())
  for (const fact of BrowsingDataCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("BrowsingData capability facts surface in the manifest and stay non-callable", () =>
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
      expect(callableFactTags).toEqual(["BrowsingData.isSupported"])

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
