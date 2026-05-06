import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema, Stream } from "effect"

import { EventLogEntry, type EventLogStore } from "./event-log.js"
import {
  CommandRegistryCommandAlreadyRegisteredError,
  CommandRegistryCommandNotFoundError,
  CommandRegistryHandlerFailureError,
  CommandRegistryInvalidInputError,
  CommandRegistryInvalidOutputError,
  makeCommandRegistry,
  type CommandRegistryApi,
  type CommandRegistryError
} from "./commands.js"
import {
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  type NormalizedCapability,
  type PermissionRegistryApi
} from "./permission-registry.js"
import { makePermissionRegistry } from "./permission-registry.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

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
  const rows: EventLogEntry[] = []
  const { registry, permissions } = await makeTestRegistry(rows)
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  const calls: OpenInput[] = []

  const handle = await Effect.runPromise(
    registry.register({
      id: "openProject",
      inputSchema: OpenInput,
      outputSchema: OpenOutput,
      capability: commandCapability,
      ownerScope: "window-1",
      handler: (input) =>
        Effect.sync(() => {
          calls.push(input)
          return new OpenOutput({ opened: true })
        })
    })
  )
  const output = await Effect.runPromise(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )
  const snapshots = await Effect.runPromise(registry.list())

  expect(handle.kind).toBe("command")
  expect(output).toEqual(new OpenOutput({ opened: true }))
  expect(calls).toEqual([new OpenInput({ path: "/tmp/project" })])
  expect(snapshots.map((snapshot) => snapshot.id)).toEqual(["openProject"])
  expect(rows.map((row) => row.type)).toContain("audit/permission-granted")
  expect(rows.map((row) => row.type)).toContain("audit/command-invoked")
})

test("CommandRegistry rejects duplicate command ids", async () => {
  const { registry } = await makeTestRegistry()

  await Effect.runPromise(registry.register(registration("openProject")))
  const exit = await Effect.runPromiseExit(registry.register(registration("openProject")))

  expectFailure(exit, CommandRegistryCommandAlreadyRegisteredError)
})

test("CommandRegistry reports missing commands as typed values", async () => {
  const { registry } = await makeTestRegistry()

  const exit = await Effect.runPromiseExit(registry.invoke("missing", {}, context))

  expectFailure(exit, CommandRegistryCommandNotFoundError)
})

test("CommandRegistry validates input before permission and handler side effects", async () => {
  const rows: EventLogEntry[] = []
  const { registry, permissions } = await makeTestRegistry(rows)
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  let handled = false

  await Effect.runPromise(
    registry.register({
      ...registration("openProject"),
      handler: () =>
        Effect.sync(() => {
          handled = true
          return new OpenOutput({ opened: true })
        })
    })
  )
  const exit = await Effect.runPromiseExit(registry.invoke("openProject", { path: 1 }, context))

  expectFailure(exit, CommandRegistryInvalidInputError)
  expect(handled).toBe(false)
  expect(rows.map((row) => row.type)).not.toContain("audit/permission-granted")
})

test("CommandRegistry returns PermissionDenied when capability is not declared", async () => {
  const { registry } = await makeTestRegistry()
  await Effect.runPromise(registry.register(registration("openProject")))

  const exit = await Effect.runPromiseExit(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )

  expectFailure(exit, PermissionDeniedError)
})

test("CommandRegistry wraps handler and output failures as typed values", async () => {
  const { registry, permissions } = await makeTestRegistry()
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(
    registry.register({
      ...registration("throws"),
      handler: () => Effect.fail("boom")
    })
  )
  await Effect.runPromise(
    registry.register({
      ...registration("badOutput"),
      handler: () => Effect.succeed({ opened: 1 } as unknown as OpenOutput)
    })
  )

  const handlerExit = await Effect.runPromiseExit(
    registry.invoke("throws", { path: "/tmp/project" }, context)
  )
  const outputExit = await Effect.runPromiseExit(
    registry.invoke("badOutput", { path: "/tmp/project" }, context)
  )

  expectFailure(handlerExit, CommandRegistryHandlerFailureError)
  expectFailure(outputExit, CommandRegistryInvalidOutputError)
})

test("CommandRegistry unregisters commands when the owner scope closes", async () => {
  const { registry, resources } = await makeTestRegistry()
  await Effect.runPromise(resources.declareScope("app"))
  await Effect.runPromise(resources.declareScope("window-1", "app"))
  await Effect.runPromise(registry.register(registration("openProject")))

  await Effect.runPromise(resources.closeScope("window-1"))
  const exit = await Effect.runPromiseExit(
    registry.invoke("openProject", { path: "/tmp/project" }, context)
  )

  expectFailure(exit, CommandRegistryCommandNotFoundError)
})

const registration = (id: string) => ({
  id,
  inputSchema: OpenInput,
  outputSchema: OpenOutput,
  capability: commandCapability,
  ownerScope: "window-1",
  handler: () => Effect.succeed(new OpenOutput({ opened: true }))
})

const makeTestRegistry = async (
  rows: EventLogEntry[] = []
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

const memoryAudit = (rows: EventLogEntry[]): EventLogStore => ({
  append: (event, options) =>
    Effect.sync(() => {
      rows.push(
        new EventLogEntry({
          id: rows.length + 1,
          type: event.type,
          payload: event.payload,
          source: options?.source ?? "test",
          timestampMs: rows.length + 1
        })
      )
      return rows.length
    }),
  query: () => Effect.succeed(rows),
  subscribe: () => Stream.empty,
  close: () => Effect.void
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
