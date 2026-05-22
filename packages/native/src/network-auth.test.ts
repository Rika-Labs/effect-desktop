import { expect, test } from "bun:test"
import { makeResourceId, P } from "@orika/core"
import { Effect, type Layer, ManagedRuntime } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  makeNetworkAuthMemoryClient,
  makeNetworkAuthServiceLayer,
  makeNetworkAuthUnsupportedClient,
  NetworkAuth,
  NetworkAuthCapabilityFacts,
  NetworkAuthRpcs,
  NetworkAuthSurface
} from "./network-auth.js"

const UnsupportedMethods = ["handleAuth", "handleCertificate"] as const
const SupportedMethods = ["setProxy"] as const
const UnsupportedSupport = {
  status: "unsupported",
  reason: "host-network-auth-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-network-auth-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-network-auth-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-network-auth-unavailable" }
  ]
} as const
const Profile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-1"),
  generation: 0,
  ownerScope: "workspace:1",
  state: "open"
} satisfies SessionProfileHandle

test("NetworkAuth exposes isSupported and setProxy as callable RPCs", () => {
  const callableTags = Array.from(NetworkAuthRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["NetworkAuth.isSupported", "NetworkAuth.setProxy"])
  for (const method of SupportedMethods) {
    expect(callableTags).toContain(`NetworkAuth.${method}`)
  }
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

test("NetworkAuth setProxy returns the stored proxy policy through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeNetworkAuthMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* networkAuth.setProxy({
            profile: Profile,
            mode: "fixed",
            server: "http://proxy.example.test:8080"
          })
        }),
        makeNetworkAuthServiceLayer(client)
      )
      expect(result).toEqual({
        profile: Profile,
        mode: "fixed",
        server: "http://proxy.example.test:8080",
        bypass: []
      })
    })
  ))

test("NetworkAuth declares the 2 unsupported methods as non-callable capability facts", () => {
  const factTags = NetworkAuthCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `NetworkAuth.${method}`).toSorted())
  for (const fact of NetworkAuthCapabilityFacts) {
    expect(fact.support).toEqual(UnsupportedSupport)
  }
})

test("NetworkAuth exposes setProxy as the selected permission and keeps isSupported unprivileged", () => {
  expect(NetworkAuthSurface.permissions.setProxy).toEqual(
    P.nativeInvoke({ primitive: "NetworkAuth", methods: ["setProxy"] })
  )
  expect("isSupported" in NetworkAuthSurface.permissions).toBe(false)
  expect(NetworkAuthSurface.permissions.all).toContainEqual(
    P.nativeInvoke({ primitive: "NetworkAuth", methods: ["setProxy"] })
  )
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
        expect(fact?.support).toEqual(UnsupportedSupport)
      }

      const callableFactTags = NetworkAuthSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["NetworkAuth.isSupported", "NetworkAuth.setProxy"])

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
