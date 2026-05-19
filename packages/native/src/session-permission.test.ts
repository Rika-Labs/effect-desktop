import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceId, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  makeSessionPermissionMemoryClient,
  makeSessionPermissionServiceLayer,
  makeSessionPermissionUnsupportedClient,
  SessionPermission,
  type SessionPermissionClientApi
} from "./session-permission.js"

test("SessionPermission requests, decides, logs, and replays decisions per session profile", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeSessionPermissionMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sessionPermission = yield* SessionPermission
      const request = yield* sessionPermission.request(profileA, "camera", "https://example.test", {
        requestId: "permission-request-1"
      })
      const decision = yield* sessionPermission.decide(
        profileA,
        request.requestId,
        "camera",
        "https://example.test",
        "grant"
      )
      const decisions = yield* sessionPermission.listDecisions(profileA)
      const otherProfile = yield* sessionPermission.listDecisions(profileB)
      const events = yield* sessionPermission
        .events(profileA)
        .pipe(Stream.take(2), Stream.runCollect)
      return { decision, decisions, events: Array.from(events), otherProfile, request }
    }).pipe(Effect.provide(makeSessionPermissionServiceLayer(client, { permissions })))
  )

  expect(result.request).toMatchObject({ requestId: "permission-request-1", status: "pending" })
  expect(result.decision).toMatchObject({
    requestId: "permission-request-1",
    kind: "camera",
    origin: "https://example.test",
    decision: "grant"
  })
  expect(result.decisions.decisions.map((record) => record.requestId)).toEqual([
    "permission-request-1"
  ])
  expect(result.otherProfile.decisions).toEqual([])
  expect(result.events.map((event) => event.phase)).toEqual(["requested", "decided"])
})

test("SessionPermission denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeSessionPermissionMemoryClient())
  let calls = 0
  const client: SessionPermissionClientApi = {
    ...baseClient,
    request: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.request(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const sessionPermission = yield* SessionPermission
      return yield* Effect.exit(
        sessionPermission.request(profileA, "camera", "https://example.test")
      )
    }).pipe(Effect.provide(makeSessionPermissionServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "SessionPermission.request" })
  })
})

test("SessionPermission surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const unsupported = makeSessionPermissionUnsupportedClient()
  const failing = await Effect.runPromise(
    makeSessionPermissionMemoryClient({
      failure: {
        listDecisions: makeHostProtocolInternalError(
          "host failed",
          "SessionPermission.listDecisions"
        )
      }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const sessionPermission = yield* SessionPermission
      return yield* Effect.exit(
        sessionPermission.request(profileA, "camera", "https://example.test")
      )
    }).pipe(Effect.provide(makeSessionPermissionServiceLayer(unsupported, { permissions })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const sessionPermission = yield* SessionPermission
      return yield* Effect.exit(sessionPermission.listDecisions(profileA))
    }).pipe(Effect.provide(makeSessionPermissionServiceLayer(failing, { permissions })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "SessionPermission.request" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "SessionPermission.listDecisions" })
  })
})

test("SessionPermission rejects malformed input before client work", async () => {
  const permissions = await configuredPermissions()
  const baseClient = await Effect.runPromise(makeSessionPermissionMemoryClient())
  let calls = 0
  const client: SessionPermissionClientApi = {
    ...baseClient,
    request: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.request(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const sessionPermission = yield* SessionPermission
      return yield* Effect.exit(
        sessionPermission.request(profileA, "camera", "https://example.test/path")
      )
    }).pipe(Effect.provide(makeSessionPermissionServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "SessionPermission.request" })
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
      permissions.declare(P.nativeInvoke({ primitive: "SessionPermission", methods: ["request"] })),
      permissions.declare(P.nativeInvoke({ primitive: "SessionPermission", methods: ["decide"] })),
      permissions.declare(
        P.nativeInvoke({ primitive: "SessionPermission", methods: ["listDecisions"] })
      )
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
