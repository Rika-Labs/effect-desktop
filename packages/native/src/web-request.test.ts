import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import {
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  WebRequest,
  makeWebRequestMemoryClient,
  makeWebRequestServiceLayer,
  makeWebRequestUnsupportedClient,
  type WebRequestClientApi
} from "./web-request.js"

test("WebRequest registers ordered observable interceptors and disposes once", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeWebRequestMemoryClient())
  let removals = 0
  const client: WebRequestClientApi = {
    ...baseClient,
    removeListener: (input) =>
      Effect.sync(() => {
        removals += 1
      }).pipe(Effect.andThen(baseClient.removeListener(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      const before = yield* webRequest.onBeforeRequest(
        profileA,
        "https://example.test/*",
        "block",
        { ownerScope: "workspace:a" }
      )
      const headers = yield* webRequest.onHeadersReceived(
        profileA,
        "https://example.test/*",
        [{ name: "x-audit", value: "1" }],
        { ownerScope: "workspace:a" }
      )
      const events = yield* webRequest.events(profileA).pipe(Stream.take(2), Stream.runCollect)
      yield* webRequest.removeListener(before.interceptor)
      yield* resources.closeScope("workspace:a")
      return { before, events: Array.from(events), headers }
    }).pipe(Effect.provide(makeWebRequestServiceLayer(client, { permissions, resources })))
  )

  expect(result.before.order).toBe(1)
  expect(result.headers.order).toBe(2)
  expect(result.events.map((event) => [event.phase, event.requestPhase, event.order])).toEqual([
    ["registered", "before-request", 1],
    ["registered", "headers-received", 2]
  ])
  expect(removals).toBe(2)
})

test("WebRequest denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeWebRequestMemoryClient())
  let calls = 0
  const client: WebRequestClientApi = {
    ...baseClient,
    onBeforeRequest: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.onBeforeRequest(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* Effect.exit(
        webRequest.onBeforeRequest(profileA, "https://example.test/*", "block")
      )
    }).pipe(Effect.provide(makeWebRequestServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "PermissionDenied",
      operation: "WebRequest.onBeforeRequest"
    })
  })
})

test("WebRequest surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const unsupported = makeWebRequestUnsupportedClient()
  const failing = await Effect.runPromise(
    makeWebRequestMemoryClient({
      failure: {
        onHeadersReceived: makeHostProtocolInternalError(
          "host failed",
          "WebRequest.onHeadersReceived"
        )
      }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* Effect.exit(
        webRequest.onBeforeRequest(profileA, "https://example.test/*", "allow")
      )
    }).pipe(Effect.provide(makeWebRequestServiceLayer(unsupported, { permissions, resources })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* Effect.exit(
        webRequest.onHeadersReceived(profileA, "https://example.test/*", [
          { name: "x-audit", value: "1" }
        ])
      )
    }).pipe(Effect.provide(makeWebRequestServiceLayer(failing, { permissions, resources })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "WebRequest.onBeforeRequest" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "WebRequest.onHeadersReceived" })
  })
})

test("WebRequest rejects malformed redirect input before client work", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeWebRequestMemoryClient())
  let calls = 0
  const client: WebRequestClientApi = {
    ...baseClient,
    onBeforeRequest: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.onBeforeRequest(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* Effect.exit(
        webRequest.onBeforeRequest(profileA, "https://example.test/*", "block", {
          redirectUrl: "https://redirect.example.test/"
        })
      )
    }).pipe(Effect.provide(makeWebRequestServiceLayer(client, { permissions, resources })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "WebRequest.onBeforeRequest" })
  })
})

const profileA: SessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-a"),
  generation: 0,
  ownerScope: "workspace:a",
  state: "open"
}

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "WebRequest", methods: ["onBeforeRequest"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "WebRequest", methods: ["onHeadersReceived"] })
      ),
      permissions.declare(P.nativeInvoke({ primitive: "WebRequest", methods: ["removeListener"] }))
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
