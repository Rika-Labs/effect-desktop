import { expect, test } from "bun:test"
import { type BridgeClientExchange, makeHostProtocolInternalError } from "@effect-desktop/bridge"
import {
  type AuditEvent,
  makePermissionRegistry,
  makeResourceRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  FocusedApplicationContext,
  FocusedApplicationContextCapabilityFacts,
  FocusedApplicationContextClient,
  FocusedApplicationContextRpcs,
  FocusedApplicationContextSurface,
  makeFocusedApplicationContextBridgeClientLayer,
  makeFocusedApplicationContextMemoryClient,
  makeFocusedApplicationContextServiceLayer,
  makeFocusedApplicationContextUnsupportedClient,
  type FocusedApplicationContextClientApi
} from "./focused-application-context.js"
import {
  FocusedApplicationContextActor,
  FocusedApplicationContextSnapshotRequest
} from "./contracts/focused-application-context.js"

const UnsupportedMethods = ["watch", "stopWatching"] as const

test("FocusedApplicationContext exposes only snapshot and isSupported as callable RPCs", () => {
  const callableTags = Array.from(FocusedApplicationContextRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "FocusedApplicationContext.isSupported",
    "FocusedApplicationContext.snapshot"
  ])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`FocusedApplicationContext.${method}`)
  }
})

test("FocusedApplicationContext declares watch and stopWatching as non-callable capability facts", () => {
  const factTags = FocusedApplicationContextCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    UnsupportedMethods.map((method) => `FocusedApplicationContext.${method}`).toSorted()
  )
  for (const fact of FocusedApplicationContextCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("FocusedApplicationContext capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: FocusedApplicationContextSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`FocusedApplicationContext.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = FocusedApplicationContextSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual([
        "FocusedApplicationContext.isSupported",
        "FocusedApplicationContext.snapshot"
      ])

      const nonCallableTags = FocusedApplicationContextSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `FocusedApplicationContext.${method}`).toSorted()
      )
    })
  ))

test("FocusedApplicationContext snapshots expose focused surface metadata only", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const client = yield* makeFocusedApplicationContextMemoryClient()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* context.snapshot(
            new FocusedApplicationContextSnapshotRequest({ actor: actor() })
          )
        }),
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )

      expect(result.application.applicationId).toBe("memory-app")
      expect(result.window?.title).toBe("Memory Window")
      expect(rows.some((row) => row.source === "FocusedApplicationContext.snapshot")).toBe(true)
    })
  ))

test("FocusedApplicationContext denies before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeFocusedApplicationContextMemoryClient()
      let calls = 0
      const client: FocusedApplicationContextClientApi = {
        ...baseClient,
        snapshot: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.snapshot(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
          )
        }),
        makeFocusedApplicationContextServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext surfaces injected host failure and audits failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const resources = yield* makeResourceRegistry()
      const failure = makeHostProtocolInternalError(
        "host failed",
        "FocusedApplicationContext.snapshot"
      )
      const client = yield* makeFocusedApplicationContextMemoryClient({
        failure: { snapshot: failure }
      })

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
          )
        }),
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Internal",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
      expect(rows.some((row) => row.outcome === "failed")).toBe(true)
    })
  ))

test("FocusedApplicationContext rejects malformed input before client calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const resources = yield* makeResourceRegistry()
      const baseClient = yield* makeFocusedApplicationContextMemoryClient()
      let calls = 0
      const client: FocusedApplicationContextClientApi = {
        ...baseClient,
        snapshot: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.snapshot(input)))
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(context.snapshot({ actor: actor(), traceId: "\0" }))
        }),
        makeFocusedApplicationContextServiceLayer(client, { permissions, resources })
      )

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "InvalidArgument",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext unsupported client fails through public service layer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      const resources = yield* makeResourceRegistry()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* FocusedApplicationContext
          return yield* Effect.exit(
            context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
          )
        }),
        makeFocusedApplicationContextServiceLayer(
          makeFocusedApplicationContextUnsupportedClient(),
          {
            permissions,
            resources
          }
        )
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          operation: "FocusedApplicationContext.snapshot"
        })
      })
    })
  ))

test("FocusedApplicationContext bridge client fails event stream as unsupported before subscribing", () =>
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
          const client = yield* FocusedApplicationContextClient
          return yield* Effect.exit(client.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        makeFocusedApplicationContextBridgeClientLayer(exchange)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-adapter-unimplemented",
          operation: "FocusedApplicationContext.Event"
        })
      })
      expect(subscriptions).toEqual([])
    })
  ))

const configuredPermissions = (rows: AuditEvent[]) =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    yield* permissions.declare(
      P.nativeInvoke({ primitive: "FocusedApplicationContext", methods: ["snapshot"] })
    )
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

const actor = () => new FocusedApplicationContextActor({ kind: "workspace", id: "workspace-1" })

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
