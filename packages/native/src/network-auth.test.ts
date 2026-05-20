import { expect, test } from "bun:test"
import { Effect, type Layer, ManagedRuntime } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeNetworkAuthMemoryClient,
  makeNetworkAuthServiceLayer,
  makeNetworkAuthUnsupportedClient,
  NetworkAuth,
  NetworkAuthCapabilityFacts,
  NetworkAuthRpcs,
  NetworkAuthSurface
} from "./network-auth.js"

const UnsupportedMethods = ["setProxy", "handleAuth", "handleCertificate"] as const

test("NetworkAuth exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(NetworkAuthRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["NetworkAuth.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`NetworkAuth.${method}`)
  }
})

test("NetworkAuth isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeNetworkAuthMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.isSupported()
        }),
        makeNetworkAuthServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("NetworkAuth unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeNetworkAuthUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.isSupported()
        }),
        makeNetworkAuthServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-network-auth-unavailable")
    })
  ))

test("NetworkAuth declares the 3 unsupported methods as non-callable capability facts", () => {
  const factTags = NetworkAuthCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `NetworkAuth.${method}`).toSorted())
  for (const fact of NetworkAuthCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("NetworkAuth capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: NetworkAuthSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`NetworkAuth.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = NetworkAuthSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["NetworkAuth.isSupported"])

      const nonCallableTags = NetworkAuthSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `NetworkAuth.${method}`).toSorted()
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
