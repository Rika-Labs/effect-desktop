import { expect, test } from "bun:test"
import { Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { SessionPermissionEvent } from "./contracts/session-permission.js"
import {
  makeSessionPermissionMemoryClient,
  makeSessionPermissionUnsupportedClient,
  SessionPermission,
  SessionPermissionCapabilityFacts,
  SessionPermissionRpcs,
  SessionPermissionSurface,
  SessionPermissionLive,
  SessionPermissionClient
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
        Layer.provide(SessionPermissionLive, Layer.succeed(SessionPermissionClient)(client))
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
        Layer.provide(SessionPermissionLive, Layer.succeed(SessionPermissionClient)(client))
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

test("SessionPermission events require decisions only for decided phase", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const baseEvent = {
        type: "session-permission-event",
        timestamp: 1710000000000,
        profile: {
          kind: "session-profile",
          id: "session-profile:workspace-1",
          generation: 0,
          ownerScope: "workspace:1",
          state: "open"
        },
        requestId: "permission-request-1",
        kind: "camera",
        origin: "https://example.test"
      } as const

      for (const event of [
        { ...baseEvent, phase: "decided" },
        { ...baseEvent, phase: "requested", decision: "grant" },
        { ...baseEvent, phase: "failed", decision: "deny" }
      ] as const) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(SessionPermissionEvent)(event))
        expect(Exit.isFailure(exit)).toBe(true)
      }

      for (const event of [
        { ...baseEvent, phase: "requested" },
        { ...baseEvent, phase: "decided", decision: "grant" },
        { ...baseEvent, phase: "failed", message: "host session permission unavailable" }
      ] as const) {
        const decoded = yield* Schema.decodeUnknownEffect(SessionPermissionEvent)(event)
        expect(decoded.phase).toBe(event.phase)
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
