import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import {
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  WebRequest,
  makeWebRequestMemoryClient,
  makeWebRequestServiceLayer,
  makeWebRequestUnsupportedClient,
  type WebRequestClientApi
} from "./web-request.js"

test("WebRequest registers ordered observable interceptors and disposes once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeWebRequestMemoryClient()
      let removals = 0
      const client: WebRequestClientApi = {
        ...baseClient,
        removeListener: (input) =>
          Effect.sync(() => {
            removals += 1
          }).pipe(Effect.andThen(baseClient.removeListener(input)))
      }

      const result = yield* runScoped(
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
        }),
        makeWebRequestServiceLayer(client, { permissions, resources })
      )

      expect(result.before.order).toBe(1)
      expect(result.headers.order).toBe(2)
      expect(result.events.map((event) => [event.phase, event.requestPhase, event.order])).toEqual([
        ["registered", "before-request", 1],
        ["registered", "headers-received", 2]
      ])
      expect(removals).toBe(2)
    })
  ))

test("WebRequest denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeWebRequestMemoryClient()
      let calls = 0
      const client: WebRequestClientApi = {
        ...baseClient,
        onBeforeRequest: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.onBeforeRequest(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const webRequest = yield* WebRequest
          return yield* Effect.exit(
            webRequest.onBeforeRequest(profileA, "https://example.test/*", "block")
          )
        }),
        makeWebRequestServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "WebRequest.onBeforeRequest"
        })
      })
    })
  ))

test("WebRequest surfaces unsupported and host failures as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const unsupported = makeWebRequestUnsupportedClient()
      const failing = yield* makeWebRequestMemoryClient({
        failure: {
          onHeadersReceived: makeHostProtocolInternalError(
            "host failed",
            "WebRequest.onHeadersReceived"
          )
        }
      })

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const webRequest = yield* WebRequest
          return yield* Effect.exit(
            webRequest.onBeforeRequest(profileA, "https://example.test/*", "allow")
          )
        }),
        makeWebRequestServiceLayer(unsupported, { permissions, resources })
      )
      const failureExit = yield* runScoped(
        Effect.gen(function* () {
          const webRequest = yield* WebRequest
          return yield* Effect.exit(
            webRequest.onHeadersReceived(profileA, "https://example.test/*", [
              { name: "x-audit", value: "1" }
            ])
          )
        }),
        makeWebRequestServiceLayer(failing, { permissions, resources })
      )

      expectExitFailure(unsupportedExit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "WebRequest.onBeforeRequest" })
      })
      expectExitFailure(failureExit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "WebRequest.onHeadersReceived" })
      })
    })
  ))

test("WebRequest rejects malformed redirect input before client work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeWebRequestMemoryClient()
      let calls = 0
      const client: WebRequestClientApi = {
        ...baseClient,
        onBeforeRequest: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.onBeforeRequest(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const webRequest = yield* WebRequest
          return yield* Effect.exit(
            webRequest.onBeforeRequest(profileA, "https://example.test/*", "block", {
              redirectUrl: "https://redirect.example.test/"
            })
          )
        }),
        makeWebRequestServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "WebRequest.onBeforeRequest"
        })
      })
    })
  ))

const profileA: SessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-a"),
  generation: 0,
  ownerScope: "workspace:a",
  state: "open"
}

const configuredPermissions = () =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "WebRequest", methods: ["onBeforeRequest"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "WebRequest", methods: ["onHeadersReceived"] })
      ),
      permissions.declare(P.nativeInvoke({ primitive: "WebRequest", methods: ["removeListener"] }))
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
