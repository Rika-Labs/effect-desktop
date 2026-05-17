import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { type AuditEvent, makePermissionRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  makeScopedAccessGrantMemoryClient,
  makeScopedAccessGrantServiceLayer,
  makeScopedAccessGrantUnsupportedClient,
  ScopedAccessGrant,
  type ScopedAccessGrantClientApi
} from "./scoped-access-grant.js"
import {
  ScopedAccessGrantActor,
  ScopedAccessGrantGrantInput,
  ScopedAccessGrantGrantRequest,
  ScopedAccessGrantResolveRequest,
  ScopedAccessGrantResolveResult,
  ScopedAccessGrantRevokeRequest,
  ScopedAccessGrantScope
} from "./contracts/scoped-access-grant.js"

test("ScopedAccessGrant grants, resolves, revokes, emits events, and audits use", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const client = await Effect.runPromise(
    makeScopedAccessGrantMemoryClient({ nextGrantId: () => "grant-1" })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      const granted = yield* service.grant(grantRequest())
      const resolved = yield* service.resolve(
        new ScopedAccessGrantResolveRequest({ grantId: granted.grantId })
      )
      const revoked = yield* service.revoke(
        new ScopedAccessGrantRevokeRequest({ grantId: granted.grantId })
      )
      const event = yield* service.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { event, granted, resolved, revoked }
    }).pipe(
      Effect.provide(
        makeScopedAccessGrantServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextGrantId: () => "grant-1",
          nextTraceId: () => "trace-grant"
        })
      )
    )
  )

  expect(result.granted).toMatchObject({ grantId: "grant-1", state: "granted" })
  expect(result.resolved).toMatchObject({ grantId: "grant-1", revalidated: true })
  expect(result.revoked).toMatchObject({ grantId: "grant-1", revoked: true })
  expect(result.event.phase).toBe("granted")
  expect(rows.some((row) => row.source === "ScopedAccessGrant.grant")).toBe(true)
  expect(rows.some((row) => row.source === "ScopedAccessGrant.resolve")).toBe(true)
  expect(rows.some((row) => row.source === "ScopedAccessGrant.revoke")).toBe(true)
})

test("ScopedAccessGrant denies grant before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeScopedAccessGrantMemoryClient())
  let calls = 0
  const client: ScopedAccessGrantClientApi = {
    ...baseClient,
    grant: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.grant(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* Effect.exit(service.grant(grantRequest()))
    }).pipe(Effect.provide(makeScopedAccessGrantServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "ScopedAccessGrant.grant" })
  })
})

test("ScopedAccessGrant does not resolve a grant unless the host revalidates it", async () => {
  const permissions = await configuredPermissions([])
  const baseClient = await Effect.runPromise(makeScopedAccessGrantMemoryClient())
  const client: ScopedAccessGrantClientApi = {
    ...baseClient,
    resolve: (input) =>
      baseClient.resolve(input).pipe(
        Effect.map(
          (result) =>
            new ScopedAccessGrantResolveResult({
              grantId: result.grantId,
              scope: result.scope,
              state: result.state,
              revalidated: false
            })
        )
      )
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      const granted = yield* service.grant(grantRequest())
      return yield* Effect.exit(
        service.resolve(new ScopedAccessGrantResolveRequest({ grantId: granted.grantId }))
      )
    }).pipe(
      Effect.provide(
        makeScopedAccessGrantServiceLayer(client, {
          permissions,
          nextGrantId: () => "grant-1"
        })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "ScopedAccessGrant.resolve" })
  })
})

test("ScopedAccessGrant can resolve a persisted grant after service restart when host revalidates", async () => {
  const permissions = await configuredPermissions([])
  const baseClient = await Effect.runPromise(makeScopedAccessGrantMemoryClient())
  const client: ScopedAccessGrantClientApi = {
    ...baseClient,
    resolve: (input) =>
      Effect.succeed(
        new ScopedAccessGrantResolveResult({
          grantId: input.grantId,
          scope: grantScope(),
          state: "resolved",
          revalidated: true
        })
      )
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* service.resolve(new ScopedAccessGrantResolveRequest({ grantId: "persisted-1" }))
    }).pipe(
      Effect.provide(
        makeScopedAccessGrantServiceLayer(client, {
          permissions
        })
      )
    )
  )

  expect(result).toMatchObject({ grantId: "persisted-1", revalidated: true })
})

test("ScopedAccessGrant rejects invalid input before client side effects", async () => {
  const permissions = await configuredPermissions([])
  const baseClient = await Effect.runPromise(makeScopedAccessGrantMemoryClient())
  let calls = 0
  const client: ScopedAccessGrantClientApi = {
    ...baseClient,
    grant: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.grant(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* Effect.exit(
        service.grant(
          new ScopedAccessGrantGrantRequest({
            actor: actor(),
            scope: new ScopedAccessGrantScope({
              path: "relative/path",
              kind: "directory",
              access: "read"
            })
          })
        )
      )
    }).pipe(Effect.provide(makeScopedAccessGrantServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "ScopedAccessGrant.grant" })
  })
})

test("ScopedAccessGrant surfaces injected host failures as typed failures", async () => {
  const permissions = await configuredPermissions([])
  const failure = makeHostProtocolInternalError("host unavailable", "ScopedAccessGrant.grant")
  const client = await Effect.runPromise(
    makeScopedAccessGrantMemoryClient({ failure: { grant: failure } })
  )

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* Effect.exit(service.grant(grantRequest()))
    }).pipe(Effect.provide(makeScopedAccessGrantServiceLayer(client, { permissions })))
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "ScopedAccessGrant.grant" })
  })
})

test("ScopedAccessGrant unsupported client validates then fails closed", async () => {
  const client = makeScopedAccessGrantUnsupportedClient()
  const support = await Effect.runPromise(client.isSupported())
  const exit = await Effect.runPromise(Effect.exit(client.grant(grantInput())))

  expect(support).toMatchObject({ supported: false, reason: "host-adapter-unimplemented" })
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "ScopedAccessGrant.grant" })
  })
})

const configuredPermissions = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "ScopedAccessGrant", methods: ["grant"] })),
      permissions.declare(P.nativeInvoke({ primitive: "ScopedAccessGrant", methods: ["resolve"] })),
      permissions.declare(P.nativeInvoke({ primitive: "ScopedAccessGrant", methods: ["revoke"] })),
      permissions.declare(P.filesystemRead({ roots: ["/workspace/app"] })),
      permissions.declare(P.filesystemWrite({ roots: ["/workspace/app"] }))
    ])
  )
  rows.length = 0
  return permissions
}

const memoryAudit = (rows: AuditEvent[]) => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const actor = () => new ScopedAccessGrantActor({ kind: "workspace", id: "workspace-1" })

const grantScope = () =>
  new ScopedAccessGrantScope({
    path: "/workspace/app",
    kind: "directory",
    access: "read-write"
  })

const grantRequest = () =>
  new ScopedAccessGrantGrantRequest({
    actor: actor(),
    scope: grantScope()
  })

const grantInput = () =>
  new ScopedAccessGrantGrantInput({
    actor: actor(),
    scope: grantScope()
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
