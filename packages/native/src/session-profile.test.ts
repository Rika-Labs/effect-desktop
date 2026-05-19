import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  makeSessionProfileMemoryClient,
  makeSessionProfileServiceLayer,
  makeSessionProfileUnsupportedClient,
  SessionProfile,
  type SessionProfileClientApi
} from "./session-profile.js"

test("SessionProfile creates scoped partition handles and releases them through ResourceRegistry", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeSessionProfileMemoryClient())
  let destroyed = 0
  const client: SessionProfileClientApi = {
    ...baseClient,
    destroy: (input) =>
      Effect.sync(() => {
        destroyed += 1
      }).pipe(Effect.andThen(baseClient.destroy(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      const opened = yield* profiles.fromPartition("workspace-1", { ownerScope: "workspace:1" })
      const again = yield* profiles.fromPartition("workspace-1", { ownerScope: "workspace:1" })
      const listed = yield* profiles.list()
      const event = yield* profiles.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      yield* resources.closeScope("workspace:1")
      return { again, event, listed, opened }
    }).pipe(Effect.provide(makeSessionProfileServiceLayer(client, { permissions, resources })))
  )

  expect(result.opened).toEqual(result.again)
  expect(result.opened.kind).toBe("session-profile")
  expect(result.opened.ownerScope).toBe("workspace:1")
  expect(result.listed.profiles).toHaveLength(1)
  expect(result.event.phase).toBe("opened")
  expect(destroyed).toBe(1)
})

test("SessionProfile denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeSessionProfileMemoryClient())
  let calls = 0
  const client: SessionProfileClientApi = {
    ...baseClient,
    fromPartition: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.fromPartition(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* Effect.exit(profiles.fromPartition("workspace-1"))
    }).pipe(Effect.provide(makeSessionProfileServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "PermissionDenied",
      operation: "SessionProfile.fromPartition"
    })
  })
})

test("SessionProfile explicit destroy does not run cleanup twice", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeSessionProfileMemoryClient())
  let destroyed = 0
  const client: SessionProfileClientApi = {
    ...baseClient,
    destroy: (input) =>
      Effect.sync(() => {
        destroyed += 1
      }).pipe(Effect.andThen(baseClient.destroy(input)))
  }

  await Effect.runPromise(
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      const opened = yield* profiles.fromPartition("workspace-1", { ownerScope: "workspace:1" })
      yield* profiles.destroy(opened)
      yield* resources.closeScope("workspace:1")
    }).pipe(Effect.provide(makeSessionProfileServiceLayer(client, { permissions, resources })))
  )

  expect(destroyed).toBe(1)
})

test("SessionProfile surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const unsupported = makeSessionProfileUnsupportedClient()
  const hostFailure = await Effect.runPromise(
    makeSessionProfileMemoryClient({
      failure: {
        fromPartition: makeHostProtocolInternalError("host failed", "SessionProfile.fromPartition")
      }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* Effect.exit(profiles.fromPartition("workspace-1"))
    }).pipe(Effect.provide(makeSessionProfileServiceLayer(unsupported, { permissions, resources })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* Effect.exit(profiles.fromPartition("workspace-2"))
    }).pipe(Effect.provide(makeSessionProfileServiceLayer(hostFailure, { permissions, resources })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "SessionProfile.fromPartition" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "SessionProfile.fromPartition" })
  })
})

test("SessionProfile rejects malformed partition before client work", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeSessionProfileMemoryClient())
  let calls = 0
  const client: SessionProfileClientApi = {
    ...baseClient,
    fromPartition: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.fromPartition(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* Effect.exit(profiles.fromPartition(""))
    }).pipe(Effect.provide(makeSessionProfileServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "SessionProfile.fromPartition"
    })
  })
})

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "SessionProfile", methods: ["fromPartition"] })
      ),
      permissions.declare(P.nativeInvoke({ primitive: "SessionProfile", methods: ["destroy"] })),
      permissions.declare(P.nativeInvoke({ primitive: "SessionProfile", methods: ["list"] }))
    ])
  )
  return permissions
}

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
