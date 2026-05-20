import { expect, test } from "bun:test"
import { Effect, type Layer, ManagedRuntime } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeSessionPermissionMemoryClient,
  makeSessionPermissionServiceLayer,
  makeSessionPermissionUnsupportedClient,
  SessionPermission,
  SessionPermissionCapabilityFacts,
  SessionPermissionRpcs,
  SessionPermissionSurface
} from "./session-permission.js"

const UnsupportedMethods = ["request", "decide", "listDecisions"] as const

test("SessionPermission exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(SessionPermissionRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["SessionPermission.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`SessionPermission.${method}`)
  }
})

test("SessionPermission isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSessionPermissionMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const sessionPermission = yield* SessionPermission
          return yield* sessionPermission.isSupported()
        }),
        makeSessionPermissionServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("SessionPermission unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionPermissionUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const sessionPermission = yield* SessionPermission
          return yield* sessionPermission.isSupported()
        }),
        makeSessionPermissionServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-session-permission-unavailable")
    })
  ))

test("SessionPermission declares the 3 unsupported methods as non-callable capability facts", () => {
  const factTags = SessionPermissionCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `SessionPermission.${method}`).toSorted()
  )
  for (const fact of SessionPermissionCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("SessionPermission capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SessionPermissionSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`SessionPermission.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = SessionPermissionSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["SessionPermission.isSupported"])

      const nonCallableTags = SessionPermissionSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `SessionPermission.${method}`).toSorted()
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
