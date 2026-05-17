import { expect, test } from "bun:test"
import { makeHostProtocolInternalError } from "@effect-desktop/bridge"
import {
  type AuditEvent,
  makePermissionRegistry,
  makeResourceRegistry,
  P,
  ResourceInvalidArgumentError,
  type ResourceRegistryApi
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  FocusedApplicationContext,
  makeFocusedApplicationContextMemoryClient,
  makeFocusedApplicationContextServiceLayer,
  makeFocusedApplicationContextUnsupportedClient,
  type FocusedApplicationContextClientApi
} from "./focused-application-context.js"
import {
  FocusedApplicationContextActor,
  FocusedApplicationContextSnapshotRequest,
  FocusedApplicationContextStopWatchingRequest,
  FocusedApplicationContextWatchRequest
} from "./contracts/focused-application-context.js"

test("FocusedApplicationContext snapshots expose focused surface metadata only", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const resources = await Effect.runPromise(makeResourceRegistry())
  const client = await Effect.runPromise(makeFocusedApplicationContextMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      return yield* context.snapshot(
        new FocusedApplicationContextSnapshotRequest({ actor: actor() })
      )
    }).pipe(
      Effect.provide(
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )
    )
  )

  expect(result.application.applicationId).toBe("memory-app")
  expect(result.window?.title).toBe("Memory Window")
  expect(rows.some((row) => row.source === "FocusedApplicationContext.snapshot")).toBe(true)
})

test("FocusedApplicationContext denies before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeFocusedApplicationContextMemoryClient())
  let calls = 0
  const client: FocusedApplicationContextClientApi = {
    ...baseClient,
    snapshot: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.snapshot(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      return yield* Effect.exit(
        context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
      )
    }).pipe(
      Effect.provide(makeFocusedApplicationContextServiceLayer(client, { permissions, resources }))
    )
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "PermissionDenied",
      operation: "FocusedApplicationContext.snapshot"
    })
  })
})

test("FocusedApplicationContext surfaces injected host failure and audits failure", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const resources = await Effect.runPromise(makeResourceRegistry())
  const failure = makeHostProtocolInternalError("host failed", "FocusedApplicationContext.snapshot")
  const client = await Effect.runPromise(
    makeFocusedApplicationContextMemoryClient({ failure: { snapshot: failure } })
  )

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      return yield* Effect.exit(
        context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
      )
    }).pipe(
      Effect.provide(
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "FocusedApplicationContext.snapshot"
    })
  })
  expect(rows.some((row) => row.outcome === "failed")).toBe(true)
})

test("FocusedApplicationContext watches focus through substitutable events", async () => {
  const permissions = await configuredPermissions([])
  const resources = await Effect.runPromise(makeResourceRegistry())
  const client = await Effect.runPromise(
    makeFocusedApplicationContextMemoryClient({ nextWatchId: () => "watch-1" })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      const watch = yield* context.watch(
        new FocusedApplicationContextWatchRequest({ actor: actor() })
      )
      const event = yield* context.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { event, watch }
    }).pipe(
      Effect.provide(
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          nextWatchId: () => "watch-1",
          resources
        })
      )
    )
  )

  expect(result.watch).toMatchObject({ watchId: "watch-1", active: true })
  expect(result.event).toMatchObject({ phase: "watch-started", watchId: "watch-1" })
})

test("FocusedApplicationContext releases watches when their resource scope closes", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const resources = await Effect.runPromise(makeResourceRegistry())
  const client = await Effect.runPromise(makeFocusedApplicationContextMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      const watch = yield* context.watch(
        new FocusedApplicationContextWatchRequest({
          actor: actor(),
          ownerScope: "scope-focused-app",
          watchId: "watch-resource"
        })
      )
      const beforeClose = yield* resources.list()
      yield* resources.closeScope("scope-focused-app")
      const afterClose = yield* resources.list()
      const stopAfterCleanup = yield* client.stopWatching({
        actor: actor(),
        watchId: "watch-resource"
      })
      return { afterClose, beforeClose, stopAfterCleanup, watch }
    }).pipe(
      Effect.provide(
        makeFocusedApplicationContextServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          resources
        })
      )
    )
  )

  expect(result.watch.watchId).toBe("watch-resource")
  expect(result.beforeClose.entries).toHaveLength(1)
  expect(result.afterClose.entries).toHaveLength(0)
  expect(result.stopAfterCleanup.stopped).toBe(false)
  expect(rows.some((row) => JSON.stringify(row.details).includes("released-by-scope"))).toBe(true)
})

test("FocusedApplicationContext rejects malformed input before client calls", async () => {
  const permissions = await configuredPermissions([])
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeFocusedApplicationContextMemoryClient())
  let calls = 0
  const client: FocusedApplicationContextClientApi = {
    ...baseClient,
    snapshot: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.snapshot(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      return yield* Effect.exit(context.snapshot({ actor: actor(), traceId: "\0" }))
    }).pipe(
      Effect.provide(makeFocusedApplicationContextServiceLayer(client, { permissions, resources }))
    )
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "InvalidArgument",
      operation: "FocusedApplicationContext.snapshot"
    })
  })
})

test("FocusedApplicationContext unsupported client fails through public service layer", async () => {
  const permissions = await configuredPermissions([])
  const resources = await Effect.runPromise(makeResourceRegistry())
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      return yield* Effect.exit(
        context.snapshot(new FocusedApplicationContextSnapshotRequest({ actor: actor() }))
      )
    }).pipe(
      Effect.provide(
        makeFocusedApplicationContextServiceLayer(
          makeFocusedApplicationContextUnsupportedClient(),
          {
            permissions,
            resources
          }
        )
      )
    )
  )

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Unsupported",
      operation: "FocusedApplicationContext.snapshot"
    })
  })
})

test("FocusedApplicationContext stopWatching is permissioned and idempotent", async () => {
  const permissions = await configuredPermissions([])
  const resources = await Effect.runPromise(makeResourceRegistry())
  const client = await Effect.runPromise(makeFocusedApplicationContextMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      yield* context.watch(
        new FocusedApplicationContextWatchRequest({ actor: actor(), watchId: "watch-stop" })
      )
      const first = yield* context.stopWatching(
        new FocusedApplicationContextStopWatchingRequest({ actor: actor(), watchId: "watch-stop" })
      )
      const second = yield* context.stopWatching(
        new FocusedApplicationContextStopWatchingRequest({ actor: actor(), watchId: "watch-stop" })
      )
      return { first, second }
    }).pipe(
      Effect.provide(makeFocusedApplicationContextServiceLayer(client, { permissions, resources }))
    )
  )

  expect(result.first).toMatchObject({ watchId: "watch-stop", stopped: true })
  expect(result.second).toMatchObject({ watchId: "watch-stop", stopped: false })
})

test("FocusedApplicationContext does not start host watch when resource registration fails", async () => {
  const permissions = await configuredPermissions([])
  const baseResources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(makeFocusedApplicationContextMemoryClient())
  let watchCalls = 0
  const resources: ResourceRegistryApi = {
    ...baseResources,
    register: () =>
      Effect.fail(
        new ResourceInvalidArgumentError({
          operation: "ResourceRegistry.register",
          field: "id",
          message: "registration unavailable"
        })
      )
  }
  const client: FocusedApplicationContextClientApi = {
    ...baseClient,
    watch: (input) =>
      Effect.sync(() => {
        watchCalls += 1
      }).pipe(Effect.andThen(baseClient.watch(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      return yield* Effect.exit(
        context.watch(
          new FocusedApplicationContextWatchRequest({ actor: actor(), watchId: "watch-register" })
        )
      )
    }).pipe(
      Effect.provide(makeFocusedApplicationContextServiceLayer(client, { permissions, resources }))
    )
  )

  expect(watchCalls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "FocusedApplicationContext.watch"
    })
  })
})

test("FocusedApplicationContext disposes registered watch when host watch fails", async () => {
  const permissions = await configuredPermissions([])
  const resources = await Effect.runPromise(makeResourceRegistry())
  const failure = makeHostProtocolInternalError("host failed", "FocusedApplicationContext.watch")
  const client = await Effect.runPromise(
    makeFocusedApplicationContextMemoryClient({ failure: { watch: failure } })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* FocusedApplicationContext
      const exit = yield* Effect.exit(
        context.watch(
          new FocusedApplicationContextWatchRequest({ actor: actor(), watchId: "watch-fails" })
        )
      )
      const resourcesAfterFailure = yield* resources.list()
      return { exit, resourcesAfterFailure }
    }).pipe(
      Effect.provide(makeFocusedApplicationContextServiceLayer(client, { permissions, resources }))
    )
  )

  expect(result.resourcesAfterFailure.entries).toHaveLength(0)
  expectExitFailure(result.exit, (error) => {
    expect(error).toMatchObject({
      tag: "Internal",
      operation: "FocusedApplicationContext.watch"
    })
  })
})

const configuredPermissions = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    Effect.all([
      permissions.declare(
        P.nativeInvoke({ primitive: "FocusedApplicationContext", methods: ["snapshot"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "FocusedApplicationContext", methods: ["watch"] })
      ),
      permissions.declare(
        P.nativeInvoke({ primitive: "FocusedApplicationContext", methods: ["stopWatching"] })
      )
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

const actor = () => new FocusedApplicationContextActor({ kind: "workspace", id: "workspace-1" })

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
