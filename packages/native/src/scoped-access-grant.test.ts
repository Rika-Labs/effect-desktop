import { expect, test } from "bun:test"
import { type BridgeClientExchange } from "@orika/bridge"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeScopedAccessGrantBridgeClientLayer,
  makeScopedAccessGrantMemoryClient,
  makeScopedAccessGrantServiceLayer,
  makeScopedAccessGrantUnsupportedClient,
  ScopedAccessGrant,
  ScopedAccessGrantCapabilityFacts,
  ScopedAccessGrantClient,
  ScopedAccessGrantRpcs,
  ScopedAccessGrantSurface
} from "./scoped-access-grant.js"

const UnsupportedMethods = ["grant", "resolve", "revoke"] as const

test("ScopedAccessGrant exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(ScopedAccessGrantRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["ScopedAccessGrant.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`ScopedAccessGrant.${method}`)
  }
})

test("ScopedAccessGrant declares grant/resolve/revoke as non-callable capability facts", () => {
  const factTags = ScopedAccessGrantCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `ScopedAccessGrant.${method}`).toSorted()
  )
  for (const fact of ScopedAccessGrantCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("ScopedAccessGrant capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: ScopedAccessGrantSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`ScopedAccessGrant.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = ScopedAccessGrantSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableTags).toEqual(["ScopedAccessGrant.isSupported"])

      const nonCallableTags = ScopedAccessGrantSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `ScopedAccessGrant.${method}`).toSorted()
      )
    })
  ))

test("ScopedAccessGrant isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeScopedAccessGrantMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* service.isSupported()
        }),
        makeScopedAccessGrantServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("ScopedAccessGrant unsupported client reports the host-adapter-unimplemented reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeScopedAccessGrantUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* service.isSupported()
        }),
        makeScopedAccessGrantServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("ScopedAccessGrant bridge client fails event stream as unsupported before subscribing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ScopedAccessGrantClient
          return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        makeScopedAccessGrantBridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "ScopedAccessGrant.Event"
        })
      })
      expect(subscriptions).toEqual([])
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

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
