import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"
import { EventJournal } from "effect/unstable/eventlog"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import { RpcCapability } from "@effect-desktop/bridge"
import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  CommandRegistryCommandAlreadyRegisteredError,
  CommandRegistryCommandNotFoundError,
  CommandRegistryCommittedAuditFailedError,
  CommandRegistryHandlerFailureError,
  CommandRegistryInvalidInputError,
  CommandRegistryRegistrationLostError,
  CommandRegistry,
  DesktopCommands,
  makeCommandRegistry,
  type CommandRegistryApi,
  type CommandRegistryError
} from "./commands.js"
import {
  makePermissionRegistry,
  PermissionActor,
  PermissionContext,
  type NormalizedCapability,
  type PermissionRegistryApi
} from "./permission-registry.js"
import { PermissionDenied } from "./permission-interceptor.js"
import {
  makeResourceId,
  makeResourceRegistry,
  ResourceRegistry,
  type ManagedResourceHandle,
  type RegisterResourceInput,
  type ResourceId,
  type ResourceRegistryApi
} from "./resources.js"

class OpenInput extends Schema.Class<OpenInput>("CommandOpenInput")({
  path: Schema.String
}) {}

class OpenOutput extends Schema.Class<OpenOutput>("CommandOpenOutput")({
  opened: Schema.Boolean
}) {}

const commandCapability: NormalizedCapability = {
  kind: "native.invoke",
  primitive: "Command",
  methods: ["openProject"],
  audit: "always"
}

const actor = new PermissionActor({ kind: "window", id: "window-1" })
const context = new PermissionContext({ actor, traceId: "trace-1" })

test("CommandRegistry registers, invokes with validated input, checks permission, and audits", async () => {
  const rows: AuditEvent[] = []
  const { registry, permissions } = await makeTestRegistry(rows)
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  const calls: OpenInput[] = []

  const handle = await Effect.runPromise(
    registry.registerGroup(
      registration("openProject", (input) =>
        Effect.sync(() => {
          calls.push(input)
          return new OpenOutput({ opened: true })
        })
      )
    )
  )
  const output = await Effect.runPromise(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )
  const snapshots = await Effect.runPromise(registry.list())

  expect(handle.kind).toBe("command-group")
  expect(output).toEqual(new OpenOutput({ opened: true }))
  expect(calls).toEqual([new OpenInput({ path: "/tmp/project" })])
  expect(snapshots.map((snapshot) => snapshot.id)).toEqual(["openProject"])
  expect(snapshots[0]?.invocationCount).toBe(1)
  expect(snapshots[0]?.lastInvocation?.outcome).toBe("success")
  expect(snapshots[0]?.lastInvocation?.traceId).toBe("trace-1")
  expect(snapshots[0]?.lastError).toBeUndefined()
  expect(rows.map((row) => row.kind)).toContain("permission-granted")
  expect(rows.map((row) => row.kind)).toContain("command-invoked")
  expect(auditTraceIds(rows, "command-invoked")).toEqual(["trace-1"])
})

test("CommandRegistry exposes invocation events and failure state for devtools", async () => {
  const { registry, permissions } = await makeTestRegistry()
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(registry.registerGroup(registration("openProject")))
  const observed = registry.observeInvocations().pipe(Stream.take(2), Stream.runCollect)

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const observedFiber = yield* observed.pipe(Effect.forkChild({ startImmediately: true }))
      yield* registry.invoke("openProject", { path: "/tmp/project" }, context)
      const failure = yield* Effect.exit(registry.invoke("openProject", { path: 1 }, context))
      const events = yield* Fiber.join(observedFiber)
      const snapshots = yield* registry.list()
      return { events: Array.from(events), failure, snapshots }
    })
  )

  expectFailure(result.failure, CommandRegistryHandlerFailureError)
  expect(result.events.map((event) => event.outcome)).toEqual(["success", "failure"])
  expect(result.events.map((event) => event.commandId)).toEqual(["openProject", "openProject"])
  expect(result.events[1]?.errorTag).toBe("HandlerFailure")
  expect(result.snapshots[0]?.invocationCount).toBe(2)
  expect(result.snapshots[0]?.lastInvocation?.outcome).toBe("failure")
  expect(result.snapshots[0]?.lastError?.errorTag).toBe("HandlerFailure")
})

test("CommandRegistry does not publish invocation records for invalid command ids", async () => {
  const { registry } = await makeTestRegistry()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const observedFiber = yield* registry
        .observeInvocations()
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      yield* Effect.sleep("1 millis")
      const exit = yield* Effect.exit(registry.invoke("", {}, context))
      const observed = yield* Fiber.join(observedFiber).pipe(Effect.timeoutOption("20 millis"))
      return { exit, observed }
    })
  )

  expectFailure(result.exit, CommandRegistryInvalidInputError)
  expect(Option.isNone(result.observed)).toBe(true)
})

test("CommandRegistry rejects duplicate command ids", async () => {
  const { registry } = await makeTestRegistry()

  await Effect.runPromise(registry.registerGroup(registration("openProject")))
  const exit = await Effect.runPromiseExit(registry.registerGroup(registration("openProject")))

  expectFailure(exit, CommandRegistryCommandAlreadyRegisteredError)
})

test("CommandRegistry reports missing commands as typed values", async () => {
  const { registry } = await makeTestRegistry()

  const exit = await Effect.runPromiseExit(registry.invoke("missing", {}, context))

  expectFailure(exit, CommandRegistryCommandNotFoundError)
})

test("CommandRegistry reports missing unregisters as typed values", async () => {
  const { registry } = await makeTestRegistry()

  const exit = await Effect.runPromiseExit(registry.unregister("missing"))

  expectFailure(exit, CommandRegistryCommandNotFoundError)
})

test("CommandRegistry validates input before permission and handler side effects", async () => {
  const rows: AuditEvent[] = []
  const { registry, permissions } = await makeTestRegistry(rows)
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  let handled = false

  await Effect.runPromise(
    registry.registerGroup(
      registration("openProject", () =>
        Effect.sync(() => {
          handled = true
          return new OpenOutput({ opened: true })
        })
      )
    )
  )
  const exit = await Effect.runPromiseExit(registry.invoke("openProject", { path: 1 }, context))

  expectFailure(exit, CommandRegistryHandlerFailureError)
  expect(handled).toBe(false)
  expect(rows.map((row) => row.kind)).not.toContain("permission-granted")
})

test("CommandRegistry returns PermissionDenied when capability is not declared", async () => {
  const { registry } = await makeTestRegistry()
  await Effect.runPromise(registry.registerGroup(registration("openProject")))

  const exit = await Effect.runPromiseExit(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )

  expectFailure(exit, PermissionDenied)
  const snapshots = await Effect.runPromise(registry.list())
  expect(snapshots[0]?.invocationCount).toBe(1)
  expect(snapshots[0]?.lastInvocation?.outcome).toBe("failure")
  expect(snapshots[0]?.lastError?.errorTag).toBe("PermissionDenied")
})

test("CommandRegistry wraps handler failures as typed values", async () => {
  const { registry, permissions } = await makeTestRegistry()
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(registry.registerGroup(registration("throws", () => Effect.fail("boom"))))

  const handlerExit = await Effect.runPromiseExit(
    registry.invoke("throws", { path: "/tmp/project" }, context)
  )

  expectFailure(handlerExit, CommandRegistryHandlerFailureError)
})

test("CommandRegistry catches handler throws and defects as typed values", async () => {
  const { registry, permissions } = await makeTestRegistry()
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(
    registry.registerGroup(
      registration("syncThrow", () => {
        throw new Error("sync boom")
      })
    )
  )
  await Effect.runPromise(
    registry.registerGroup(registration("defect", () => Effect.die("defect boom")))
  )

  const syncThrowExit = await Effect.runPromiseExit(
    registry.invoke("syncThrow", { path: "/tmp/project" }, context)
  )
  const defectExit = await Effect.runPromiseExit(
    registry.invoke("defect", { path: "/tmp/project" }, context)
  )

  expectFailure(syncThrowExit, CommandRegistryHandlerFailureError)
  expectFailure(defectExit, CommandRegistryHandlerFailureError)
})

test("CommandRegistry command invocation audit uses the permission grant trace id", async () => {
  const rows: AuditEvent[] = []
  const { registry, permissions } = await makeTestRegistry(rows)
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(registry.registerGroup(registration("openProject")))

  await Effect.runPromise(registry.invoke("openProject", { path: "/tmp/project" }, context))

  expect(auditTraceIds(rows, "permission-used")).toEqual(["trace-1"])
  expect(auditTraceIds(rows, "command-invoked")).toEqual(["trace-1"])
})

test("DesktopCommands.layer registers RpcGroup commands as scoped resources", async () => {
  const rows: AuditEvent[] = []
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(
    makePermissionRegistry({ audit: memoryAudit(rows), traceId: () => "trace-1" })
  )
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  const commandRegistration = registration("openProject")

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* CommandRegistry
        const before = yield* registry.list()
        const output = yield* registry.invoke("openProject", { path: "/tmp/project" }, context)
        return { before, output }
      }).pipe(
        Effect.provide(
          DesktopCommands.layer(commandRegistration.group, commandRegistration.handlers, {
            ownerScope: "window-1"
          })
        ),
        Effect.provideService(ResourceRegistry, resources),
        Effect.provideServiceEffect(CommandRegistry, makeCommandRegistry(resources, permissions))
      )
    )
  )

  expect(result.before.map((snapshot) => snapshot.id)).toEqual(["openProject"])
  expect(result.output).toEqual(new OpenOutput({ opened: true }))
})

test("CommandRegistry rejects invalid starting clock timestamps without recording invocations", async () => {
  const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]

  for (const timestamp of invalidTimestamps) {
    const resources = await Effect.runPromise(makeResourceRegistry())
    const permissions = await Effect.runPromise(makePermissionRegistry())
    const registry = await Effect.runPromise(
      makeCommandRegistry(resources, permissions, { now: () => timestamp })
    )
    let handlerCalls = 0
    await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
    await Effect.runPromise(
      registry.registerGroup(
        registration("openProject", () =>
          Effect.sync(() => {
            handlerCalls += 1
            return new OpenOutput({ opened: true })
          })
        )
      )
    )

    const exit = await Effect.runPromiseExit(
      registry.invoke("openProject", { path: "/tmp/project" }, context)
    )
    const snapshots = await Effect.runPromise(registry.list())

    expectFailure(exit, CommandRegistryInvalidInputError)
    expect(handlerCalls).toBe(0)
    expect(snapshots[0]?.invocationCount).toBe(0)
    expect(snapshots[0]?.lastInvocation).toBeUndefined()
  }
})

test("CommandRegistry rejects invalid completion clock timestamps without malformed records", async () => {
  const timestamps = [100, Number.NaN]
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(
    makeCommandRegistry(resources, permissions, {
      now: () => timestamps.shift() ?? Number.NaN
    })
  )
  let handlerCalls = 0
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(
    registry.registerGroup(
      registration("openProject", () =>
        Effect.sync(() => {
          handlerCalls += 1
          return new OpenOutput({ opened: true })
        })
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )
  const snapshots = await Effect.runPromise(registry.list())

  expectFailure(exit, CommandRegistryInvalidInputError)
  expect(handlerCalls).toBe(1)
  expect(snapshots[0]?.invocationCount).toBe(0)
  expect(snapshots[0]?.lastInvocation).toBeUndefined()
})

test("CommandRegistry distinguishes committed handler runs from post-handler audit failures", async () => {
  const rows: AuditEvent[] = []
  const audit = failingCommandInvokedAudit(rows)
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(
    makePermissionRegistry({ audit, traceId: () => "trace-1", nextToken: () => "grant-1" })
  )
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions, { audit }))
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  let handlerCalls = 0
  await Effect.runPromise(
    registry.registerGroup(
      registration("openProject", () =>
        Effect.sync(() => {
          handlerCalls += 1
          return new OpenOutput({ opened: true })
        })
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )
  const snapshots = await Effect.runPromise(registry.list())

  expectFailure(exit, CommandRegistryCommittedAuditFailedError)
  expect(handlerCalls).toBe(1)
  expect(rows.map((row) => row.kind)).toContain("command-registered")
  expect(rows.map((row) => row.kind)).not.toContain("command-invoked")
  expect(snapshots[0]?.invocationCount).toBe(1)
  expect(snapshots[0]?.lastInvocation?.outcome).toBe("committed-audit-failure")
  expect(snapshots[0]?.lastError?.errorTag).toBe("CommandCommittedAuditFailed")
})

test("CommandRegistry accepts empty trace ids in context and falls back in invocation history", async () => {
  const rows: AuditEvent[] = []
  const { registry, permissions } = await makeTestRegistry(rows)
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(registry.registerGroup(registration("openProject")))

  const contextWithEmptyTrace = { actor, traceId: "" } as PermissionContext
  await Effect.runPromise(
    registry.invoke("openProject", { path: "/tmp/project" }, contextWithEmptyTrace)
  )
  const snapshots = await Effect.runPromise(registry.list())

  expect(snapshots[0]?.lastInvocation?.traceId).toBe("command:openProject")
  expect(auditTraceIds(rows, "command-invoked")).toEqual(["command:openProject"])
})

test("CommandRegistry unregisters commands when the owner scope closes", async () => {
  const { registry, resources } = await makeTestRegistry()
  await Effect.runPromise(resources.declareScope("app"))
  await Effect.runPromise(resources.declareScope("window-1", "app"))
  await Effect.runPromise(registry.registerGroup(registration("openProject")))

  await Effect.runPromise(resources.closeScope("window-1"))
  const exit = await Effect.runPromiseExit(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )

  expectFailure(exit, CommandRegistryCommandNotFoundError)
})

test("CommandRegistry rolls back a reserved command when registration is interrupted", async () => {
  const started = await Effect.runPromise(Deferred.make<void>())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(
    makeCommandRegistry(
      {
        ...resources,
        register: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          })
      },
      permissions
    )
  )

  const snapshots = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* registry
        .registerGroup(registration("openProject"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      return yield* registry.list()
    })
  )

  expect(snapshots).toEqual([])
})

test("CommandRegistry does not invoke commands before resource registration commits", async () => {
  const registerStarted = await Effect.runPromise(Deferred.make<void>())
  const allowRegister = await Effect.runPromise(Deferred.make<void>())
  const resources = stalledRegisterResourceRegistry(registerStarted, allowRegister)
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* permissions.declare(commandCapability, { source: "test" })
      const registerFiber = yield* registry
        .registerGroup(registration("openProject"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(registerStarted)
      const pendingList = yield* registry.list()
      const pendingInvoke = yield* Effect.exit(
        registry.invoke("openProject", { path: "/tmp/project" }, context)
      )
      yield* Deferred.succeed(allowRegister, undefined)
      const handle = yield* Fiber.join(registerFiber)
      const committedList = yield* registry.list()
      const committedInvoke = yield* registry.invoke(
        "openProject",
        { path: "/tmp/project" },
        context
      )
      return { pendingList, pendingInvoke, handle, committedList, committedInvoke }
    })
  )

  expect(result.pendingList).toEqual([])
  expectFailure(result.pendingInvoke, CommandRegistryCommandNotFoundError)
  expect(result.handle.kind).toBe("command-group")
  expect(result.committedList.map((snapshot) => snapshot.id)).toEqual(["openProject"])
  expect(result.committedInvoke).toEqual(new OpenOutput({ opened: true }))
})

test("CommandRegistry resource cleanup does not remove a newer registration", async () => {
  const disposeStarted = await Effect.runPromise(Deferred.make<void>())
  const allowDispose = await Effect.runPromise(Deferred.make<void>())
  const resources = delayedCleanupResourceRegistry(disposeStarted, allowDispose)
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions))

  await Effect.runPromise(registry.registerGroup(registration("openProject")))
  const snapshots = await Effect.runPromise(
    Effect.gen(function* () {
      const unregisterFiber = yield* registry
        .unregister("openProject")
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(disposeStarted)
      yield* registry.registerGroup(registration("openProject"))
      yield* Deferred.succeed(allowDispose, undefined)
      yield* Fiber.join(unregisterFiber)
      return yield* registry.list()
    })
  )

  expect(snapshots.map((snapshot) => snapshot.id)).toEqual(["openProject"])
})

test("CommandRegistry fails registration when the reservation is removed before commit", async () => {
  const registerStarted = await Effect.runPromise(Deferred.make<void>())
  const allowRegister = await Effect.runPromise(Deferred.make<void>())
  const resources = stalledRegisterResourceRegistry(registerStarted, allowRegister)
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions))

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const registerFiber = yield* registry
        .registerGroup(registration("openProject"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(registerStarted)
      yield* registry.unregister("openProject")
      yield* Deferred.succeed(allowRegister, undefined)
      return yield* Fiber.join(registerFiber)
    })
  )
  const snapshots = await Effect.runPromise(registry.list())

  expectFailure(exit, CommandRegistryRegistrationLostError)
  expect(snapshots).toEqual([])
})

test("CommandRegistry fails registration when its reservation was replaced before commit", async () => {
  const firstRegisterStarted = await Effect.runPromise(Deferred.make<void>())
  const allowFirstRegister = await Effect.runPromise(Deferred.make<void>())
  const resources = firstRegisterStalledResourceRegistry(firstRegisterStarted, allowFirstRegister)
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions))

  const { firstExit, snapshots } = await Effect.runPromise(
    Effect.gen(function* () {
      const firstRegister = yield* registry
        .registerGroup(registration("openProject"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(firstRegisterStarted)
      yield* registry.unregister("openProject")
      yield* registry.registerGroup(registration("openProject"))
      yield* Deferred.succeed(allowFirstRegister, undefined)
      const firstExit = yield* Fiber.await(firstRegister)
      const snapshots = yield* registry.list()
      return { firstExit, snapshots }
    })
  )

  expectFailure(firstExit, CommandRegistryRegistrationLostError)
  expect(snapshots.map((snapshot) => snapshot.id)).toEqual(["openProject"])
})

test("CommandRegistry interrupted registration rollback does not remove a replacement", async () => {
  const firstRegisterStarted = await Effect.runPromise(Deferred.make<void>())
  const allowFirstRegister = await Effect.runPromise(Deferred.make<void>())
  const resources = firstRegisterStalledResourceRegistry(firstRegisterStarted, allowFirstRegister)
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions))

  const snapshots = await Effect.runPromise(
    Effect.gen(function* () {
      const firstRegister = yield* registry
        .registerGroup(registration("openProject"))
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(firstRegisterStarted)
      yield* registry.unregister("openProject")
      yield* registry.registerGroup(registration("openProject"))
      yield* Fiber.interrupt(firstRegister)
      return yield* registry.list()
    })
  )

  await Effect.runPromise(Deferred.succeed(allowFirstRegister, undefined))

  expect(snapshots.map((snapshot) => snapshot.id)).toEqual(["openProject"])
})

test("CommandRegistry rejects control characters in command ids", async () => {
  const rows: AuditEvent[] = []
  const { registry } = await makeTestRegistry(rows)

  const nulExit = await Effect.runPromiseExit(
    registry.registerGroup(registration("open\u0000Project"))
  )
  const newlineExit = await Effect.runPromiseExit(
    registry.registerGroup(registration("open\nProject"))
  )
  const tabExit = await Effect.runPromiseExit(registry.registerGroup(registration("open\tProject")))
  const crExit = await Effect.runPromiseExit(registry.registerGroup(registration("open\rProject")))
  const delExit = await Effect.runPromiseExit(
    registry.registerGroup(registration("open\x7fProject"))
  )
  const fineExit = await Effect.runPromiseExit(registry.registerGroup(registration("openProject")))

  expectFailure(nulExit, CommandRegistryInvalidInputError)
  expectFailure(newlineExit, CommandRegistryInvalidInputError)
  expectFailure(tabExit, CommandRegistryInvalidInputError)
  expectFailure(crExit, CommandRegistryInvalidInputError)
  expectFailure(delExit, CommandRegistryInvalidInputError)
  expect(Exit.isSuccess(fineExit)).toBe(true)

  expect(rows.filter((r) => r.kind === "command-registered")).toHaveLength(1)
})

type OpenHandler = (input: OpenInput) => Effect.Effect<OpenOutput, unknown, never>

const registration = (
  id: string,
  handler: OpenHandler = () => Effect.succeed(new OpenOutput({ opened: true }))
) => {
  const tag = id
  const Command = Rpc.make(tag, {
    payload: OpenInput,
    success: OpenOutput,
    error: Schema.Unknown
  }).pipe(RpcCapability(commandCapability))
  const group = RpcGroup.make(Command)

  return {
    group,
    ownerScope: "window-1",
    handlers: group.toLayer(Effect.succeed({ [tag]: handler }))
  }
}

const makeTestRegistry = async (
  rows: AuditEvent[] = []
): Promise<{
  readonly registry: CommandRegistryApi
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
}> => {
  const audit = memoryAudit(rows)
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(
    makePermissionRegistry({ audit, traceId: () => "trace-1", nextToken: () => "grant-1" })
  )
  const registry = await Effect.runPromise(makeCommandRegistry(resources, permissions, { audit }))
  return { registry, permissions, resources }
}

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.empty
})

const failingCommandInvokedAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    event.kind === "command-invoked"
      ? Effect.fail(
          new EventJournal.EventJournalError({
            method: "EventJournal.write",
            cause: new Error("journal full")
          })
        )
      : Effect.sync(() => {
          rows.push(event)
        }),
  observe: () => Stream.empty
})

const delayedCleanupResourceRegistry = (
  disposeStarted: Deferred.Deferred<void>,
  allowDispose: Deferred.Deferred<void>
): ResourceRegistryApi => {
  const cleanupById = new Map<ResourceId, Effect.Effect<void, never, never>>()
  const generationById = new Map<ResourceId, number>()
  let generated = 0

  return {
    register: (input) =>
      Effect.sync(() => {
        const id =
          input.id !== undefined && !cleanupById.has(input.id)
            ? input.id
            : makeResourceId(`generated-${++generated}`)
        cleanupById.set(id, input.dispose ?? Effect.void)
        const generation = generationById.get(id) ?? 0

        return {
          kind: input.kind,
          id,
          generation,
          ownerScope: input.ownerScope,
          state: input.state,
          dispose: () => Effect.void
        }
      }),
    get: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed({ entries: [] }),
    dispose: (id) =>
      Effect.gen(function* () {
        const cleanup = cleanupById.get(id)
        cleanupById.delete(id)
        generationById.set(id, (generationById.get(id) ?? 0) + 1)
        yield* Deferred.succeed(disposeStarted, undefined)
        yield* Deferred.await(allowDispose)
        if (cleanup !== undefined) {
          yield* cleanup
        }
      }),
    observe: () => Stream.empty,
    observeLifecycle: () => Stream.empty,
    declareScope: () => Effect.void,
    closeScope: () => Effect.void,
    share: () => Effect.die("unused"),
    assertFresh: () => Effect.die("unused"),
    close: () => Effect.void
  }
}

const stalledRegisterResourceRegistry = (
  registerStarted: Deferred.Deferred<void>,
  allowRegister: Deferred.Deferred<void>
): ResourceRegistryApi => {
  const cleanupById = new Map<ResourceId, Effect.Effect<void, never, never>>()

  return {
    register: (input) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(registerStarted, undefined)
        yield* Deferred.await(allowRegister)
        const id = input.id ?? makeResourceId("generated-1")
        cleanupById.set(id, input.dispose ?? Effect.void)

        return {
          kind: input.kind,
          id,
          generation: 0,
          ownerScope: input.ownerScope,
          state: input.state,
          dispose: () => Effect.void
        }
      }),
    get: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed({ entries: [] }),
    dispose: (id) =>
      Effect.gen(function* () {
        const cleanup = cleanupById.get(id)
        cleanupById.delete(id)
        if (cleanup !== undefined) {
          yield* cleanup
        }
      }),
    observe: () => Stream.empty,
    observeLifecycle: () => Stream.empty,
    declareScope: () => Effect.void,
    closeScope: () => Effect.void,
    share: () => Effect.die("unused"),
    assertFresh: () => Effect.die("unused"),
    close: () => Effect.void
  }
}

const firstRegisterStalledResourceRegistry = (
  firstRegisterStarted: Deferred.Deferred<void>,
  allowFirstRegister: Deferred.Deferred<void>
): ResourceRegistryApi => {
  const cleanupById = new Map<ResourceId, Effect.Effect<void, never, never>>()
  const generationById = new Map<ResourceId, number>()
  let registerCount = 0

  const registerNow = <Kind extends string, State extends string>(
    input: RegisterResourceInput<Kind, State>
  ): Effect.Effect<ManagedResourceHandle<Kind, State>, never, never> =>
    Effect.sync(() => {
      const id = input.id ?? makeResourceId("generated-1")
      const generation = generationById.get(id) ?? 0
      cleanupById.set(id, input.dispose ?? Effect.void)

      return {
        kind: input.kind,
        id,
        generation,
        ownerScope: input.ownerScope,
        state: input.state,
        dispose: () => Effect.void
      }
    })

  return {
    register: (input) =>
      Effect.gen(function* () {
        registerCount += 1
        if (registerCount === 1) {
          yield* Deferred.succeed(firstRegisterStarted, undefined)
          yield* Deferred.await(allowFirstRegister)
        }

        return yield* registerNow(input)
      }),
    get: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed({ entries: [] }),
    dispose: (id) =>
      Effect.gen(function* () {
        const cleanup = cleanupById.get(id)
        cleanupById.delete(id)
        generationById.set(id, (generationById.get(id) ?? 0) + 1)
        if (cleanup !== undefined) {
          yield* cleanup
        }
      }),
    observe: () => Stream.empty,
    observeLifecycle: () => Stream.empty,
    declareScope: () => Effect.void,
    closeScope: () => Effect.void,
    share: () => Effect.die("unused"),
    assertFresh: () => Effect.die("unused"),
    close: () => Effect.void
  }
}

const auditTraceIds = (rows: readonly AuditEvent[], kind: string): readonly string[] =>
  rows.flatMap((row) => {
    if (row.kind !== kind) {
      return []
    }

    return typeof row.traceId === "string" ? [row.traceId] : []
  })

const expectFailure = (
  exit: Exit.Exit<unknown, CommandRegistryError>,
  errorType: abstract new (...args: never[]) => unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail?.error).toBeInstanceOf(errorType)
  }
}
