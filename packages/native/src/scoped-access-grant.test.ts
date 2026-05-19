import { expect, test } from "bun:test"
import { type BridgeClientExchange, makeHostProtocolInternalError } from "@effect-desktop/bridge"
import { type AuditEvent, makePermissionRegistry, P } from "@effect-desktop/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Option, Stream } from "effect"

import {
  makeScopedAccessGrantBridgeClientLayer,
  makeScopedAccessGrantMemoryClient,
  makeScopedAccessGrantServiceLayer,
  makeScopedAccessGrantUnsupportedClient,
  ScopedAccessGrant,
  ScopedAccessGrantClient,
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

test("ScopedAccessGrant grants, resolves, revokes, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeScopedAccessGrantMemoryClient({ nextGrantId: () => "grant-1" })

      const result = yield* runScoped(
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
        }),
        makeScopedAccessGrantServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextGrantId: () => "grant-1",
          nextTraceId: () => "trace-grant"
        })
      )

      expect(result.granted).toMatchObject({ grantId: "grant-1", state: "granted" })
      expect(result.resolved).toMatchObject({ grantId: "grant-1", revalidated: true })
      expect(result.revoked).toMatchObject({ grantId: "grant-1", revoked: true })
      expect(result.event.phase).toBe("granted")
      expect(rows.some((row) => row.source === "ScopedAccessGrant.grant")).toBe(true)
      expect(rows.some((row) => row.source === "ScopedAccessGrant.resolve")).toBe(true)
      expect(rows.some((row) => row.source === "ScopedAccessGrant.revoke")).toBe(true)
    })
  ))

test("ScopedAccessGrant denies grant before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const baseClient = yield* makeScopedAccessGrantMemoryClient()
      let calls = 0
      const client: ScopedAccessGrantClientApi = {
        ...baseClient,
        grant: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.grant(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* Effect.exit(service.grant(grantRequest()))
        }),
        makeScopedAccessGrantServiceLayer(client, { permissions })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "ScopedAccessGrant.grant"
        })
      })
    })
  ))

test("ScopedAccessGrant does not resolve a grant unless the host revalidates it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const baseClient = yield* makeScopedAccessGrantMemoryClient()
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

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          const granted = yield* service.grant(grantRequest())
          return yield* Effect.exit(
            service.resolve(new ScopedAccessGrantResolveRequest({ grantId: granted.grantId }))
          )
        }),
        makeScopedAccessGrantServiceLayer(client, {
          permissions,
          nextGrantId: () => "grant-1"
        })
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "ScopedAccessGrant.resolve" })
      })
    })
  ))

test("ScopedAccessGrant can resolve a persisted grant after service restart when host revalidates", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const baseClient = yield* makeScopedAccessGrantMemoryClient()
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

      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* service.resolve(
            new ScopedAccessGrantResolveRequest({ grantId: "persisted-1" })
          )
        }),
        makeScopedAccessGrantServiceLayer(client, { permissions })
      )

      expect(result).toMatchObject({ grantId: "persisted-1", revalidated: true })
    })
  ))

test("ScopedAccessGrant rejects invalid input before client side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const baseClient = yield* makeScopedAccessGrantMemoryClient()
      let calls = 0
      const client: ScopedAccessGrantClientApi = {
        ...baseClient,
        grant: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.grant(input)))
      }

      const exit = yield* runScoped(
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
        }),
        makeScopedAccessGrantServiceLayer(client, { permissions })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "ScopedAccessGrant.grant"
        })
      })
    })
  ))

test("ScopedAccessGrant surfaces injected host failures as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const failure = makeHostProtocolInternalError("host unavailable", "ScopedAccessGrant.grant")
      const client = yield* makeScopedAccessGrantMemoryClient({ failure: { grant: failure } })

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* ScopedAccessGrant
          return yield* Effect.exit(service.grant(grantRequest()))
        }),
        makeScopedAccessGrantServiceLayer(client, { permissions })
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Internal", operation: "ScopedAccessGrant.grant" })
      })
    })
  ))

test("ScopedAccessGrant unsupported client validates then fails closed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeScopedAccessGrantUnsupportedClient()
      const support = yield* client.isSupported()
      const exit = yield* Effect.exit(client.grant(grantInput()))

      expect(support).toMatchObject({ supported: false, reason: "host-adapter-unimplemented" })
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "Unsupported", operation: "ScopedAccessGrant.grant" })
      })
    })
  ))

test("ScopedAccessGrant bridge client fails event stream as unsupported before subscribing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ScopedAccessGrantClient
          return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        makeScopedAccessGrantBridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "ScopedAccessGrant.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "ScopedAccessGrant", methods: ["grant"] })),
      permissions.declare(P.nativeInvoke({ primitive: "ScopedAccessGrant", methods: ["resolve"] })),
      permissions.declare(P.nativeInvoke({ primitive: "ScopedAccessGrant", methods: ["revoke"] })),
      permissions.declare(P.filesystemRead({ roots: ["/workspace/app"] })),
      permissions.declare(P.filesystemWrite({ roots: ["/workspace/app"] }))
    ])
    rows.length = 0
    return permissions
  })

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
