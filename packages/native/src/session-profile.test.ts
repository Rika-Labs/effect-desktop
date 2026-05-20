import { expect, test } from "bun:test"
import { type BridgeClientExchange } from "@effect-desktop/bridge"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeSessionProfileBridgeClientLayer,
  makeSessionProfileMemoryClient,
  makeSessionProfileServiceLayer,
  makeSessionProfileUnsupportedClient,
  SessionProfile,
  SessionProfileCapabilityFacts,
  SessionProfileClient,
  SessionProfileRpcs,
  SessionProfileSurface
} from "./session-profile.js"

const UnsupportedMethods = ["fromPartition", "destroy", "list"] as const

test("SessionProfile exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(SessionProfileRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["SessionProfile.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`SessionProfile.${method}`)
  }
})

test("SessionProfile declares fromPartition/destroy/list as non-callable capability facts", () => {
  const factTags = SessionProfileCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `SessionProfile.${method}`).toSorted()
  )
  for (const fact of SessionProfileCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("SessionProfile capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SessionProfileSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`SessionProfile.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = SessionProfileSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableTags).toEqual(["SessionProfile.isSupported"])

      const nonCallableTags = SessionProfileSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `SessionProfile.${method}`).toSorted()
      )
    })
  ))

test("SessionProfile isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSessionProfileMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* service.isSupported()
        }),
        makeSessionProfileServiceLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("SessionProfile unsupported client reports the host-routing-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionProfileUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* service.isSupported()
        }),
        makeSessionProfileServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-session-profile-routing-unavailable")
    })
  ))

test("SessionProfile unsupported client fails the event stream as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionProfileUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* Effect.exit(service.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        makeSessionProfileServiceLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-session-profile-routing-unavailable",
          operation: "SessionProfile.Event"
        })
      })
    })
  ))

test("SessionProfile bridge client subscribes to the host event channel", () =>
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

      const collected = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* SessionProfileClient
          return yield* client.events().pipe(Stream.runCollect)
        }),
        makeSessionProfileBridgeClientLayer(exchange)
      )

      expect(Array.from(collected)).toEqual([])
      expect(subscriptions).toEqual(["SessionProfile.Event"])
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
