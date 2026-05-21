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

const SupportedMethods = ["get", "remove"] as const
const UnsupportedMethods = ["set"] as const
const Profile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-1"),
  generation: 0,
  ownerScope: "workspace:1",
  state: "open"
} satisfies SessionProfileHandle

test("CookieStore exposes get, remove, and isSupported as callable RPCs", () => {
  const callableTags = Array.from(CookieStoreRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["CookieStore.get", "CookieStore.isSupported", "CookieStore.remove"])
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

test("CookieStore remove validates input and delegates through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          yield* store.remove({
            profile: Profile,
            url: "https://example.test/account",
            name: "token"
          })
          return true
        }),
        makeCookieStoreServiceLayer(client)
      )
      expect(result).toBe(true)
      const error = yield* Effect.flip(
        client.remove({
          profile: Profile,
          url: "https://example.test/account",
          name: ""
        })
      )
      expect(error).toMatchObject({ tag: "InvalidArgument", operation: "CookieStore.remove" })
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
      const removeError = yield* Effect.flip(
        client.remove({ profile: Profile, url: "https://example.test", name: "token" })
      )
      expect(removeError.tag).toBe("Unsupported")
      expect(removeError.operation).toBe("CookieStore.remove")
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
      expect(callableFactTags).toEqual([
        "CookieStore.get",
        "CookieStore.isSupported",
        "CookieStore.remove"
      ])
      const getFact = CookieStoreSurface.schemaDocs.find((doc) => doc.tag === "CookieStore.get")
      expect(getFact?.support.status).toBe("partial")
      if (getFact?.support.status !== "partial") {
        throw new Error("CookieStore.get should be partially supported")
      }
      expect(getFact.support.reason).toBe("host-cookie-store-live-webview-required")
      const removeFact = CookieStoreSurface.schemaDocs.find(
        (doc) => doc.tag === "CookieStore.remove"
      )
      expect(removeFact?.support.status).toBe("partial")
      if (removeFact?.support.status !== "partial") {
        throw new Error("CookieStore.remove should be partially supported")
      }
      expect(removeFact.support.reason).toBe("host-cookie-store-live-webview-required")

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
