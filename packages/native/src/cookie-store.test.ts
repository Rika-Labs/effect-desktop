import { expect, test } from "bun:test"
import { makeResourceId } from "@effect-desktop/core"
import { Effect, type Layer, ManagedRuntime } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  CookieStore,
  CookieStoreCapabilityFacts,
  CookieStoreRpcs,
  CookieStoreSurface,
  makeCookieStoreMemoryClient,
  makeCookieStoreServiceLayer,
  makeCookieStoreUnsupportedClient
} from "./cookie-store.js"

const SupportedMethods = ["get"] as const
const UnsupportedMethods = ["set", "remove"] as const
const Profile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-1"),
  generation: 0,
  ownerScope: "workspace:1",
  state: "open"
} satisfies SessionProfileHandle

test("CookieStore exposes get and isSupported as callable RPCs", () => {
  const callableTags = Array.from(CookieStoreRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["CookieStore.get", "CookieStore.isSupported"])
  for (const method of SupportedMethods) {
    expect(callableTags).toContain(`CookieStore.${method}`)
  }
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

test("CookieStore get validates input and returns a typed result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.get({
            profile: Profile,
            url: "https://example.test/account",
            name: "token"
          })
        }),
        makeCookieStoreServiceLayer(client)
      )
      expect(result.cookies).toEqual([])
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
      const error = yield* Effect.flip(
        client.get({ profile: Profile, url: "https://example.test" })
      )
      expect(error.tag).toBe("Unsupported")
      expect(error.operation).toBe("CookieStore.get")
    })
  ))

test("CookieStore declares unsupported methods as non-callable capability facts", () => {
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
        .toSorted()
      expect(callableFactTags).toEqual(["CookieStore.get", "CookieStore.isSupported"])
      const getFact = CookieStoreSurface.schemaDocs.find((doc) => doc.tag === "CookieStore.get")
      expect(getFact?.support.status).toBe("partial")
      if (getFact?.support.status !== "partial") {
        throw new Error("CookieStore.get should be partially supported")
      }
      expect(getFact.support.reason).toBe("host-cookie-store-live-webview-required")

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
