import { expect, test } from "bun:test"
import { type BridgeClientExchange } from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  makeScopedAccessGrantMemoryClient,
  makeScopedAccessGrantUnsupportedClient,
  ScopedAccessGrant,
  ScopedAccessGrantCapabilityFacts,
  ScopedAccessGrantClient,
  ScopedAccessGrantEvent,
  ScopedAccessGrantRpcs,
  ScopedAccessGrantSurface,
  ScopedAccessGrantLive
} from "./scoped-access-grant.js"

const UnsupportedMethods = ["grant", "resolve", "revoke"] as const

test("ScopedAccessGrant exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(ScopedAccessGrantRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["ScopedAccessGrant.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`ScopedAccessGrant.${method}`)
  }
})

test("ScopedAccessGrant contract module does not export unsupported operation payload schemas", async () => {
  const contractExports = Object.keys(await import("./contracts/scoped-access-grant.js"))
  for (const exportedName of [
    "ScopedAccessGrantActorKind",
    "ScopedAccessGrantActor",
    "ScopedAccessGrantScopeKind",
    "ScopedAccessGrantScope",
    "ScopedAccessGrantAccess",
    "ScopedAccessGrantGrantRequest",
    "ScopedAccessGrantGrantInput",
    "ScopedAccessGrantGrantResult",
    "ScopedAccessGrantResolveRequest",
    "ScopedAccessGrantResolveInput",
    "ScopedAccessGrantResolveResult",
    "ScopedAccessGrantRevokeRequest",
    "ScopedAccessGrantRevokeInput",
    "ScopedAccessGrantRevokeResult"
  ]) {
    expect(contractExports).not.toContain(exportedName)
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
        Layer.provide(ScopedAccessGrantLive, Layer.succeed(ScopedAccessGrantClient)(client))
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
        Layer.provide(ScopedAccessGrantLive, Layer.succeed(ScopedAccessGrantClient)(client))
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
        ScopedAccessGrantSurface.bridgeClientLayer(exchange)
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

test("ScopedAccessGrant rejects contradictory event phase states", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const payload of [
        {
          type: "scoped-access-grant-event",
          timestamp: 1_710_000_000_000,
          grantId: "grant-1",
          path: "/tmp/example.txt",
          phase: "granted",
          state: "revoked"
        },
        {
          type: "scoped-access-grant-event",
          timestamp: 1_710_000_000_000,
          grantId: "grant-1",
          phase: "resolved",
          state: "granted"
        },
        {
          type: "scoped-access-grant-event",
          timestamp: 1_710_000_000_000,
          grantId: "grant-1",
          phase: "revoked",
          state: "resolved"
        }
      ] as const) {
        const decoded = yield* Effect.exit(
          Schema.decodeUnknownEffect(ScopedAccessGrantEvent)(payload)
        )
        expect(Exit.isFailure(decoded)).toBe(true)
      }
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
