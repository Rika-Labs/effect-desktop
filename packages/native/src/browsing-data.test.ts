import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceId, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  BrowsingData,
  makeBrowsingDataMemoryClient,
  makeBrowsingDataServiceLayer,
  makeBrowsingDataUnsupportedClient,
  type BrowsingDataClientApi
} from "./browsing-data.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"

test("BrowsingData clears, estimates, lists, and watches per session profile", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(
    makeBrowsingDataMemoryClient({ unsupportedTypes: ["cookies"] })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      const clear = yield* browsingData.clear(profileA, ["cache", "cookies"])
      const estimate = yield* browsingData.estimate(profileA, {
        types: ["cache", "cookies", "history"]
      })
      const otherProfile = yield* browsingData.estimate(profileB, { types: ["cache"] })
      const list = yield* browsingData.listTypes()
      const event = yield* browsingData
        .events(profileA)
        .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { clear, estimate, event, list, otherProfile }
    }).pipe(Effect.provide(makeBrowsingDataServiceLayer(client, { permissions })))
  )

  expect(result.clear).toMatchObject({ cleared: ["cache"], unsupported: ["cookies"] })
  expect(result.estimate.estimates.map((entry) => entry.type)).toEqual([
    "cache",
    "cookies",
    "history"
  ])
  expect(result.estimate.estimates.find((entry) => entry.type === "cache")?.bytes).toBe(0)
  expect(result.estimate.estimates.find((entry) => entry.type === "cookies")?.supported).toBe(false)
  expect(result.estimate.estimates.find((entry) => entry.type === "cookies")?.bytes).toBeUndefined()
  expect(result.otherProfile.estimates[0]?.bytes).toBe(1024)
  expect(result.list.types).toContain("serviceWorkers")
  expect(result.event.profile.id).toBe(profileA.id)
  expect(result.event.cleared).toEqual(["cache"])
  expect(result.event.unsupported).toEqual(["cookies"])
})

test("BrowsingData denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeBrowsingDataMemoryClient())
  let calls = 0
  const client: BrowsingDataClientApi = {
    ...baseClient,
    clear: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.clear(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* Effect.exit(browsingData.clear(profileA, ["cache"]))
    }).pipe(Effect.provide(makeBrowsingDataServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "BrowsingData.clear" })
  })
})

test("BrowsingData surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const unsupported = makeBrowsingDataUnsupportedClient()
  const failing = await Effect.runPromise(
    makeBrowsingDataMemoryClient({
      failure: { estimate: makeHostProtocolInternalError("host failed", "BrowsingData.estimate") }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* Effect.exit(browsingData.clear(profileA, ["cache"]))
    }).pipe(Effect.provide(makeBrowsingDataServiceLayer(unsupported, { permissions })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* Effect.exit(browsingData.estimate(profileA, { types: ["cache"] }))
    }).pipe(Effect.provide(makeBrowsingDataServiceLayer(failing, { permissions })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "BrowsingData.clear" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "BrowsingData.estimate" })
  })
})

test("BrowsingData rejects malformed input before client work", async () => {
  const permissions = await configuredPermissions()
  const baseClient = await Effect.runPromise(makeBrowsingDataMemoryClient())
  let calls = 0
  const client: BrowsingDataClientApi = {
    ...baseClient,
    clear: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.clear(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* Effect.exit(browsingData.clear(profileA, []))
    }).pipe(Effect.provide(makeBrowsingDataServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "BrowsingData.clear" })
  })
})

const profileA: SessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-a"),
  generation: 0,
  ownerScope: "workspace:a",
  state: "open"
}

const profileB: SessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-b"),
  generation: 0,
  ownerScope: "workspace:b",
  state: "open"
}

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "BrowsingData", methods: ["clear"] })),
      permissions.declare(P.nativeInvoke({ primitive: "BrowsingData", methods: ["estimate"] })),
      permissions.declare(P.nativeInvoke({ primitive: "BrowsingData", methods: ["listTypes"] }))
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
