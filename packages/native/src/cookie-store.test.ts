import { expect, test } from "bun:test"
import { Effect, type Layer, ManagedRuntime } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  CookieStore,
  CookieStoreCapabilityFacts,
  CookieStoreRpcs,
  CookieStoreSurface,
  makeCookieStoreMemoryClient,
  makeCookieStoreServiceLayer,
  makeCookieStoreUnsupportedClient
} from "./cookie-store.js"

const UnsupportedMethods = ["get", "set", "remove"] as const

test("CookieStore exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(CookieStoreRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["CookieStore.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`CookieStore.${method}`)
  }
})

test("CookieStore isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.isSupported()
        }),
        makeCookieStoreServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("CookieStore unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeCookieStoreUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.isSupported()
        }),
        makeCookieStoreServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-cookie-store-unavailable")
    })
  ))

test("CookieStore declares the 3 unsupported methods as non-callable capability facts", () => {
  const factTags = CookieStoreCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `CookieStore.${method}`).toSorted())
  for (const fact of CookieStoreCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("CookieStore capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: CookieStoreSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`CookieStore.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = CookieStoreSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["CookieStore.isSupported"])

      const nonCallableTags = CookieStoreSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `CookieStore.${method}`).toSorted()
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
