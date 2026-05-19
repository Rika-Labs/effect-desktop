import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceId, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  makeNetworkAuthMemoryClient,
  makeNetworkAuthServiceLayer,
  makeNetworkAuthUnsupportedClient,
  NetworkAuth,
  type NetworkAuthClientApi
} from "./network-auth.js"

test("NetworkAuth sets proxy, handles auth, accepts certificates, and emits events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const client = yield* makeNetworkAuthMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          const proxy = yield* networkAuth.setProxy(profileA, "fixed", {
            server: "http://proxy.example.test:8080",
            bypass: ["localhost"]
          })
          const auth = yield* networkAuth.handleAuth(
            profileA,
            "auth-request-1",
            "https://example.test",
            "allow",
            { username: "user", password: "secret" }
          )
          const cert = yield* networkAuth.handleCertificate(
            profileA,
            "cert-request-1",
            "https://example.test",
            fingerprint,
            "allow"
          )
          const events = yield* networkAuth.events(profileA).pipe(Stream.take(3), Stream.runCollect)
          return { auth, cert, events: Array.from(events), proxy }
        }),
        makeNetworkAuthServiceLayer(client, { permissions })
      )

      expect(result.proxy).toMatchObject({
        mode: "fixed",
        server: "http://proxy.example.test:8080",
        bypass: ["localhost"]
      })
      expect(result.auth).toMatchObject({ kind: "http-auth", decision: "allow" })
      expect(result.cert).toMatchObject({ kind: "certificate", decision: "allow" })
      expect(result.events.map((event) => event.phase)).toEqual([
        "proxy-updated",
        "auth-decided",
        "certificate-decided"
      ])
    })
  ))

test("NetworkAuth denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeNetworkAuthMemoryClient()
      let calls = 0
      const client: NetworkAuthClientApi = {
        ...baseClient,
        setProxy: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.setProxy(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(networkAuth.setProxy(profileA, "system"))
        }),
        makeNetworkAuthServiceLayer(client, { permissions })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "PermissionDenied", operation: "NetworkAuth.setProxy" })
      })
    })
  ))

test("NetworkAuth surfaces unsupported and host failures as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const unsupported = makeNetworkAuthUnsupportedClient()
      const failing = yield* makeNetworkAuthMemoryClient({
        failure: {
          handleAuth: makeHostProtocolInternalError("host failed", "NetworkAuth.handleAuth")
        }
      })

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(networkAuth.setProxy(profileA, "system"))
        }),
        makeNetworkAuthServiceLayer(unsupported, { permissions })
      )
      const failureExit = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(
            networkAuth.handleAuth(profileA, "auth-request-1", "https://example.test", "deny")
          )
        }),
        makeNetworkAuthServiceLayer(failing, { permissions })
      )

      expectExitFailure(unsupportedExit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "NetworkAuth.setProxy" })
      })
      expectExitFailure(failureExit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "NetworkAuth.handleAuth" })
      })
    })
  ))

test("NetworkAuth rejects malformed proxy input before client work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const baseClient = yield* makeNetworkAuthMemoryClient()
      let calls = 0
      const client: NetworkAuthClientApi = {
        ...baseClient,
        setProxy: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.setProxy(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(networkAuth.setProxy(profileA, "fixed"))
        }),
        makeNetworkAuthServiceLayer(client, { permissions })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "NetworkAuth.setProxy" })
      })
    })
  ))

test("NetworkAuth denies certificate decisions as typed security failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions()
      const client = yield* makeNetworkAuthMemoryClient()

      const denied = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(
            networkAuth.handleCertificate(
              profileA,
              "cert-request-1",
              "https://example.test",
              fingerprint,
              "deny"
            )
          )
        }),
        makeNetworkAuthServiceLayer(client, { permissions })
      )
      const malformed = yield* runScoped(
        Effect.gen(function* () {
          const networkAuth = yield* NetworkAuth
          return yield* Effect.exit(
            networkAuth.handleCertificate(
              profileA,
              "cert-request-2",
              "https://example.test",
              "sha256:nothex",
              "allow"
            )
          )
        }),
        makeNetworkAuthServiceLayer(client, { permissions })
      )

      expectExitFailure(denied, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "NetworkAuth.handleCertificate"
        })
      })
      expectExitFailure(malformed, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "NetworkAuth.handleCertificate"
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

const fingerprint = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const configuredPermissions = () =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "NetworkAuth", methods: ["setProxy"] })),
      permissions.declare(P.nativeInvoke({ primitive: "NetworkAuth", methods: ["handleAuth"] })),
      permissions.declare(
        P.nativeInvoke({ primitive: "NetworkAuth", methods: ["handleCertificate"] })
      )
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
