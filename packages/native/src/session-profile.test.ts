import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Option, Stream } from "effect"

import {
  makeSessionProfileMemoryClient,
  makeSessionProfileServiceLayer,
  makeSessionProfileUnsupportedClient,
  SessionProfile,
  type SessionProfileClientApi
} from "./session-profile.js"

test("SessionProfile creates scoped partition handles and releases them through ResourceRegistry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeSessionProfileMemoryClient()
      let destroyed = 0
      const client: SessionProfileClientApi = {
        ...baseClient,
        destroy: (input) =>
          Effect.sync(() => {
            destroyed += 1
          }).pipe(Effect.andThen(baseClient.destroy(input)))
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const profiles = yield* SessionProfile
          const opened = yield* profiles.fromPartition("workspace-1", { ownerScope: "workspace:1" })
          const again = yield* profiles.fromPartition("workspace-1", { ownerScope: "workspace:1" })
          const listed = yield* profiles.list()
          const event = yield* profiles.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          yield* resources.closeScope("workspace:1")
          return { again, event, listed, opened }
        }),
        makeSessionProfileServiceLayer(client, { permissions, resources })
      )

      expect(result.opened).toEqual(result.again)
      expect(result.opened.kind).toBe("session-profile")
      expect(result.opened.ownerScope).toBe("workspace:1")
      expect(result.listed.profiles).toHaveLength(1)
      expect(result.event.phase).toBe("opened")
      expect(destroyed).toBe(1)
    })
  ))

test("SessionProfile denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeSessionProfileMemoryClient()
      let calls = 0
      const client: SessionProfileClientApi = {
        ...baseClient,
        fromPartition: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.fromPartition(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const profiles = yield* SessionProfile
          return yield* Effect.exit(profiles.fromPartition("workspace-1"))
        }),
        makeSessionProfileServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "SessionProfile.fromPartition"
        })
      })
    })
  ))

test("SessionProfile explicit destroy does not run cleanup twice", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeSessionProfileMemoryClient()
      let destroyed = 0
      const client: SessionProfileClientApi = {
        ...baseClient,
        destroy: (input) =>
          Effect.sync(() => {
            destroyed += 1
          }).pipe(Effect.andThen(baseClient.destroy(input)))
      }

      yield* runScoped(
        Effect.gen(function* () {
          const profiles = yield* SessionProfile
          const opened = yield* profiles.fromPartition("workspace-1", { ownerScope: "workspace:1" })
          yield* profiles.destroy(opened)
          yield* resources.closeScope("workspace:1")
        }),
        makeSessionProfileServiceLayer(client, { permissions, resources })
      )

      expect(destroyed).toBe(1)
    })
  ))

test("SessionProfile surfaces unsupported and host failures as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const unsupported = makeSessionProfileUnsupportedClient()
      const hostFailure = yield* makeSessionProfileMemoryClient({
        failure: {
          fromPartition: makeHostProtocolInternalError(
            "host failed",
            "SessionProfile.fromPartition"
          )
        }
      })

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const profiles = yield* SessionProfile
          return yield* Effect.exit(profiles.fromPartition("workspace-1"))
        }),
        makeSessionProfileServiceLayer(unsupported, { permissions, resources })
      )
      const failureExit = yield* runScoped(
        Effect.gen(function* () {
          const profiles = yield* SessionProfile
          return yield* Effect.exit(profiles.fromPartition("workspace-2"))
        }),
        makeSessionProfileServiceLayer(hostFailure, { permissions, resources })
      )

      expectExitFailure(unsupportedExit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "SessionProfile.fromPartition"
        })
      })
      expectExitFailure(failureExit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "SessionProfile.fromPartition" })
      })
    })
  ))

test("SessionProfile rejects malformed partition before client work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeSessionProfileMemoryClient()
      let calls = 0
      const client: SessionProfileClientApi = {
        ...baseClient,
        fromPartition: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.fromPartition(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const profiles = yield* SessionProfile
          return yield* Effect.exit(profiles.fromPartition(""))
        }),
        makeSessionProfileServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "SessionProfile.fromPartition"
        })
      })
    })
  ))

const configuredPermissions = () =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "SessionProfile", methods: ["fromPartition"] })
      ),
      permissions.declare(P.nativeInvoke({ primitive: "SessionProfile", methods: ["destroy"] })),
      permissions.declare(P.nativeInvoke({ primitive: "SessionProfile", methods: ["list"] }))
    ])
    return permissions
  })

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
