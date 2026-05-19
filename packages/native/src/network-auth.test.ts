import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceId, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  makeNetworkAuthMemoryClient,
  makeNetworkAuthServiceLayer,
  makeNetworkAuthUnsupportedClient,
  NetworkAuth,
  type NetworkAuthClientApi
} from "./network-auth.js"

test("NetworkAuth sets proxy, handles auth, accepts certificates, and emits events", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeNetworkAuthMemoryClient())

  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(client, { permissions })))
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

test("NetworkAuth denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeNetworkAuthMemoryClient())
  let calls = 0
  const client: NetworkAuthClientApi = {
    ...baseClient,
    setProxy: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.setProxy(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* Effect.exit(networkAuth.setProxy(profileA, "system"))
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "NetworkAuth.setProxy" })
  })
})

test("NetworkAuth surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const unsupported = makeNetworkAuthUnsupportedClient()
  const failing = await Effect.runPromise(
    makeNetworkAuthMemoryClient({
      failure: {
        handleAuth: makeHostProtocolInternalError("host failed", "NetworkAuth.handleAuth")
      }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* Effect.exit(networkAuth.setProxy(profileA, "system"))
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(unsupported, { permissions })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* Effect.exit(
        networkAuth.handleAuth(profileA, "auth-request-1", "https://example.test", "deny")
      )
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(failing, { permissions })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "NetworkAuth.setProxy" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "NetworkAuth.handleAuth" })
  })
})

test("NetworkAuth rejects malformed proxy input before client work", async () => {
  const permissions = await configuredPermissions()
  const baseClient = await Effect.runPromise(makeNetworkAuthMemoryClient())
  let calls = 0
  const client: NetworkAuthClientApi = {
    ...baseClient,
    setProxy: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.setProxy(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* Effect.exit(networkAuth.setProxy(profileA, "fixed"))
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "NetworkAuth.setProxy" })
  })
})

test("NetworkAuth denies certificate decisions as typed security failures", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeNetworkAuthMemoryClient())

  const denied = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(client, { permissions })))
  )
  const malformed = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeNetworkAuthServiceLayer(client, { permissions })))
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

const profileA: SessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-a"),
  generation: 0,
  ownerScope: "workspace:a",
  state: "open"
}

const fingerprint = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "NetworkAuth", methods: ["setProxy"] })),
      permissions.declare(P.nativeInvoke({ primitive: "NetworkAuth", methods: ["handleAuth"] })),
      permissions.declare(
        P.nativeInvoke({ primitive: "NetworkAuth", methods: ["handleCertificate"] })
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
