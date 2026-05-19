import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { makePermissionRegistry, makeResourceId, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  CookieStore,
  CookieStoreCookie,
  makeCookieStoreMemoryClient,
  makeCookieStoreServiceLayer,
  makeCookieStoreUnsupportedClient,
  type CookieStoreClientApi
} from "./cookie-store.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"

test("CookieStore reads, writes, removes, and watches cookies per session profile", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeCookieStoreMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CookieStore
      yield* store.set(profileA, "https://example.test/account", cookie("token", "a"))
      yield* store.set(profileB, "https://example.test/account", cookie("token", "b"))
      const first = yield* store.get(profileA, "https://example.test/account")
      yield* store.remove(profileA, "https://example.test/account", "token")
      const afterRemove = yield* store.get(profileA, "https://example.test/account")
      const otherProfile = yield* store.get(profileB, "https://example.test/account")
      const event = yield* store
        .events(profileA)
        .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { afterRemove, event, first, otherProfile }
    }).pipe(Effect.provide(makeCookieStoreServiceLayer(client, { permissions })))
  )

  expect(result.first.cookies.map((row) => row.value)).toEqual(["a"])
  expect(result.afterRemove.cookies).toEqual([])
  expect(result.otherProfile.cookies.map((row) => row.value)).toEqual(["b"])
  expect(result.event.profile.id).toBe(profileA.id)
  expect(result.event.phase).toBe("set")
})

test("CookieStore denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeCookieStoreMemoryClient())
  let calls = 0
  const client: CookieStoreClientApi = {
    ...baseClient,
    get: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.get(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* Effect.exit(store.get(profileA, "https://example.test/account"))
    }).pipe(Effect.provide(makeCookieStoreServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "CookieStore.get" })
  })
})

test("CookieStore surfaces unsupported and host failures as typed failures", async () => {
  const permissions = await configuredPermissions()
  const unsupported = makeCookieStoreUnsupportedClient()
  const failing = await Effect.runPromise(
    makeCookieStoreMemoryClient({
      failure: { get: makeHostProtocolInternalError("host failed", "CookieStore.get") }
    })
  )

  const unsupportedExit = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* Effect.exit(store.get(profileA, "https://example.test/account"))
    }).pipe(Effect.provide(makeCookieStoreServiceLayer(unsupported, { permissions })))
  )
  const failureExit = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* Effect.exit(store.get(profileA, "https://example.test/account"))
    }).pipe(Effect.provide(makeCookieStoreServiceLayer(failing, { permissions })))
  )

  expectExitFailure(unsupportedExit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "CookieStore.get" })
  })
  expectExitFailure(failureExit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "CookieStore.get" })
  })
})

test("CookieStore rejects malformed input before client work", async () => {
  const permissions = await configuredPermissions()
  const baseClient = await Effect.runPromise(makeCookieStoreMemoryClient())
  let calls = 0
  const client: CookieStoreClientApi = {
    ...baseClient,
    set: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.set(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* Effect.exit(store.set(profileA, "file:///tmp/cookie", cookie("token", "a")))
    }).pipe(Effect.provide(makeCookieStoreServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "CookieStore.set" })
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

const cookie = (name: string, value: string): CookieStoreCookie =>
  new CookieStoreCookie({
    name,
    value,
    domain: "example.test",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  })

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "CookieStore", methods: ["get"] })),
      permissions.declare(P.nativeInvoke({ primitive: "CookieStore", methods: ["set"] })),
      permissions.declare(P.nativeInvoke({ primitive: "CookieStore", methods: ["remove"] }))
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
