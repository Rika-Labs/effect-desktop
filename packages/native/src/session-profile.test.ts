import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { SessionProfileEvent } from "./contracts/session-profile.js"
import {
  makeSessionProfileMemoryClient,
  makeSessionProfileUnsupportedClient,
  SessionProfile,
  SessionProfileCapabilityFacts,
  type SessionProfileClientApi,
  SessionProfileRpcs,
  SessionProfileSurface
} from "./session-profile.js"

const CallableMethods = ["fromPartition", "destroy", "list", "isSupported"] as const

test("SessionProfile public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("session-profile.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "SessionProfileServiceApi",
        "class SessionProfileClient",
        "SessionProfileLive",
        "makeSessionProfileClientLayer",
        "makeSessionProfileServiceLayer",
        "makeSessionProfileBridgeClientLayer",
        "makeSessionProfileService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("SessionProfile exposes profile lifecycle methods as callable RPCs", () => {
  const callableTags = Array.from(SessionProfileRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(
    CallableMethods.map((method) => `SessionProfile.${method}`).toSorted()
  )
})

test("SessionProfile no longer declares profile lifecycle methods as capability facts", () => {
  expect(SessionProfileCapabilityFacts).toHaveLength(0)
})

test("SessionProfile lifecycle methods surface in the manifest as callable supported RPCs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SessionProfileSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of CallableMethods) {
        const fact = byTag.get(`SessionProfile.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("supported")
      }

      const callableTags = SessionProfileSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual(
        CallableMethods.map((method) => `SessionProfile.${method}`).toSorted()
      )

      const nonCallableTags = SessionProfileSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual([])
    })
  ))

test("SessionProfile memory client creates, lists, and destroys partition handles", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSessionProfileMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          const profile = yield* service.fromPartition({
            partition: "workspace-1",
            ownerScope: "workspace:1"
          })
          const sameProfile = yield* service.fromPartition({
            partition: "workspace-1",
            ownerScope: "workspace:1"
          })
          const beforeDestroy = yield* service.list()
          yield* service.destroy(profile)
          const afterDestroy = yield* service.list()
          return { afterDestroy, beforeDestroy, profile, sameProfile }
        }),
        sessionProfileLayer(client)
      )

      expect(result.profile).toMatchObject({
        kind: "session-profile",
        id: "session-profile:workspace-1",
        generation: 0,
        ownerScope: "workspace:1",
        state: "open"
      })
      expect(result.sameProfile).toEqual(result.profile)
      expect(result.beforeDestroy.profiles).toEqual([result.profile])
      expect(result.afterDestroy.profiles).toEqual([])
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
        sessionProfileLayer(client)
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
        sessionProfileLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-session-profile-routing-unavailable")
    })
  ))

test("SessionProfile unsupported client fails lifecycle methods as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSessionProfileUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* Effect.exit(service.fromPartition({ partition: "workspace-1" }))
        }),
        sessionProfileLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-session-profile-routing-unavailable",
          operation: "SessionProfile.fromPartition"
        })
      })
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
        sessionProfileLayer(client)
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

test("SessionProfile contracts reject inconsistent event phase payloads", () => {
  const profile = profileHandle()
  const invalidPayloads = [
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "opened",
      message: "host failed"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "closed",
      profile,
      partition: "workspace-1",
      message: "closed with failure"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      profile,
      partition: "workspace-1",
      message: "host failed"
    }
  ] as const

  for (const payload of invalidPayloads) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(SessionProfileEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "opened",
      profile,
      partition: "workspace-1"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "closed",
      profile,
      partition: "workspace-1"
    },
    {
      type: "session-profile-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(SessionProfileEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

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
          const service = yield* SessionProfile
          return yield* service.events().pipe(Stream.runCollect)
        }),
        SessionProfileSurface.bridgeClientLayer(exchange)
      )

      expect(Array.from(collected)).toEqual([])
      expect(subscriptions).toEqual(["SessionProfile.Event"])
    })
  ))

test("SessionProfile bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("SessionProfile test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "session-profile-event-trace",
              payload: {
                type: "session-profile-event",
                timestamp: 1_710_000_000_000,
                phase: "opened",
                message: "host failed"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* SessionProfile
          return yield* Effect.exit(
            service.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        SessionProfileSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
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

const sessionProfileLayer = (client: SessionProfileClientApi): Layer.Layer<SessionProfile> =>
  Layer.succeed(SessionProfile)(client)

const profileHandle = () =>
  ({
    kind: "session-profile",
    id: "session-profile:workspace-1",
    generation: 0,
    ownerScope: "workspace:1",
    state: "open"
  }) as const

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
