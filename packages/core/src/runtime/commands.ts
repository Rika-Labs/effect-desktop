import { Context, Data, Effect, Option, Ref, Schema } from "effect"

import { AuditEvent, emitAuditEvent } from "./audit-events.js"
import type { EventLogError, EventLogStore } from "./event-log.js"
import {
  PermissionRegistry,
  type NormalizedCapability,
  type PermissionContext,
  type PermissionRegistryError,
  type PermissionRegistryApi
} from "./permission-registry.js"
import {
  ResourceRegistry,
  type ResourceHandle,
  type ResourceId,
  type ResourceRegistryApi,
  type ScopeId
} from "./resources.js"

const NonEmptyString = Schema.NonEmptyString
const StrictParseOptions = { onExcessProperty: "error" } as const

export class CommandRegistryInvalidInputError extends Data.TaggedError("InvalidInput")<{
  readonly operation: string
  readonly commandId: Option.Option<string>
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class CommandRegistryInvalidOutputError extends Data.TaggedError("InvalidOutput")<{
  readonly operation: string
  readonly commandId: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class CommandRegistryCommandNotFoundError extends Data.TaggedError("CommandNotFound")<{
  readonly operation: string
  readonly commandId: string
}> {}

export class CommandRegistryCommandAlreadyRegisteredError extends Data.TaggedError(
  "CommandAlreadyRegistered"
)<{
  readonly operation: string
  readonly commandId: string
}> {}

export class CommandRegistryRegistrationLostError extends Data.TaggedError("RegistrationLost")<{
  readonly operation: string
  readonly commandId: string
  readonly resourceId: ResourceId
}> {}

export class CommandRegistryHandlerFailureError extends Data.TaggedError("HandlerFailure")<{
  readonly operation: string
  readonly commandId: string
  readonly cause: unknown
}> {}

export class CommandRegistryAuditFailedError extends Data.TaggedError("CommandAuditFailed")<{
  readonly operation: string
  readonly commandId: string
  readonly cause: EventLogError
}> {}

export type CommandRegistryError =
  | CommandRegistryInvalidInputError
  | CommandRegistryInvalidOutputError
  | CommandRegistryCommandNotFoundError
  | CommandRegistryCommandAlreadyRegisteredError
  | CommandRegistryRegistrationLostError
  | CommandRegistryHandlerFailureError
  | CommandRegistryAuditFailedError
  | PermissionRegistryError

export interface CommandRegistration<I, O> {
  readonly id: string
  readonly inputSchema: Schema.Schema<I>
  readonly outputSchema: Schema.Schema<O>
  readonly capability: NormalizedCapability
  readonly ownerScope: ScopeId
  readonly handler: (input: I) => Effect.Effect<O, unknown, never>
}

export class CommandSnapshot extends Schema.Class<CommandSnapshot>("CommandSnapshot")({
  id: NonEmptyString,
  capability: Schema.Unknown,
  ownerScope: NonEmptyString
}) {}

export interface CommandRegistryApi {
  readonly register: <I, O>(
    registration: CommandRegistration<I, O>
  ) => Effect.Effect<ResourceHandle<"command", "registered">, CommandRegistryError, never>
  readonly unregister: (id: string) => Effect.Effect<void, CommandRegistryError, never>
  readonly invoke: (
    id: string,
    input: unknown,
    context: PermissionContext
  ) => Effect.Effect<unknown, CommandRegistryError, never>
  readonly list: () => Effect.Effect<readonly CommandSnapshot[], never, never>
}

export interface CommandRegistryOptions {
  readonly audit?: EventLogStore
  readonly now?: () => number
}

interface StoredCommand {
  readonly id: string
  readonly inputSchema: Schema.Schema<unknown>
  readonly outputSchema: Schema.Schema<unknown>
  readonly capability: NormalizedCapability
  readonly ownerScope: ScopeId
  readonly resourceId: ResourceId
  readonly handler: (input: unknown) => Effect.Effect<unknown, unknown, never>
}

export const makeCommandRegistry = (
  resources: ResourceRegistryApi,
  permissions: PermissionRegistryApi,
  options: CommandRegistryOptions = {}
): Effect.Effect<CommandRegistryApi, never, never> =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyMap<string, StoredCommand>>(new Map())
    const now = options.now ?? Date.now

    const remove = (
      id: string,
      resourceId?: ResourceId
    ): Effect.Effect<StoredCommand | undefined, never, never> =>
      Ref.modify(commands, (current) => {
        const command = current.get(id)
        if (command === undefined) {
          return [undefined, current] as const
        }
        if (resourceId !== undefined && command.resourceId !== resourceId) {
          return [undefined, current] as const
        }

        const next = new Map(current)
        next.delete(id)
        return [command, next] as const
      })

    return Object.freeze({
      register: (registration) =>
        registerCommand(commands, resources, remove, options.audit, now, registration).pipe(
          Effect.withSpan("CommandRegistry.register")
        ),
      unregister: (id) =>
        Effect.gen(function* () {
          const decodedId = yield* decodeCommandId(id, "CommandRegistry.unregister")
          const command = yield* remove(decodedId)

          if (command !== undefined) {
            yield* resources.dispose(command.resourceId)
            yield* auditCommand(
              options.audit,
              "command-unregistered",
              decodedId,
              "unregistered",
              now
            )
          }
        }).pipe(Effect.withSpan("CommandRegistry.unregister")),
      invoke: (id, input, context) =>
        Effect.gen(function* () {
          const decodedId = yield* decodeCommandId(id, "CommandRegistry.invoke")
          const command = yield* getCommand(commands, decodedId, "CommandRegistry.invoke")
          const decodedInput = yield* decodeCommandInput(command, input)
          const grant = yield* permissions.check(command.capability, context, {
            source: `command:${decodedId}`
          })
          const output = yield* permissions.use(grant, invokeCommandHandler(command, decodedInput))
          const decodedOutput = yield* decodeCommandOutput(command, output)
          yield* auditCommand(
            options.audit,
            "command-invoked",
            decodedId,
            "success",
            now,
            grant.traceId
          )
          return decodedOutput
        }).pipe(Effect.withSpan("CommandRegistry.invoke", { attributes: { commandId: id } })),
      list: () =>
        Ref.get(commands).pipe(
          Effect.map((current) =>
            [...current.values()]
              .map(
                (command) =>
                  new CommandSnapshot({
                    id: command.id,
                    capability: command.capability,
                    ownerScope: command.ownerScope
                  })
              )
              .sort((left, right) => left.id.localeCompare(right.id))
          )
        )
    } satisfies CommandRegistryApi)
  })

export class CommandRegistry extends Context.Service<CommandRegistry, CommandRegistryApi>()(
  "CommandRegistry",
  {
    make: Effect.gen(function* () {
      const resources = yield* ResourceRegistry
      const permissions = yield* PermissionRegistry
      return yield* makeCommandRegistry(resources, permissions)
    })
  }
) {}

const registerCommand = <I, O>(
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  resources: ResourceRegistryApi,
  remove: (
    id: string,
    resourceId?: ResourceId
  ) => Effect.Effect<StoredCommand | undefined, never, never>,
  audit: EventLogStore | undefined,
  now: () => number,
  registration: CommandRegistration<I, O>
): Effect.Effect<ResourceHandle<"command", "registered">, CommandRegistryError, never> => {
  let reservedId: string | undefined
  let handle: ResourceHandle<"command", "registered"> | undefined
  let completed = false

  const rollback = Effect.suspend(() => {
    if (completed || reservedId === undefined) {
      return Effect.void
    }

    return handle === undefined
      ? remove(reservedId).pipe(Effect.asVoid)
      : resources.dispose(handle.id)
  })

  return Effect.gen(function* () {
    const decodedId = yield* decodeCommandId(registration.id, "CommandRegistry.register")
    reservedId = decodedId
    const resourceId = commandResourceId(decodedId)
    let registeredResourceId = resourceId
    const stored: StoredCommand = {
      id: decodedId,
      inputSchema: registration.inputSchema as Schema.Schema<unknown>,
      outputSchema: registration.outputSchema as Schema.Schema<unknown>,
      capability: registration.capability,
      ownerScope: registration.ownerScope,
      resourceId,
      handler: registration.handler as (input: unknown) => Effect.Effect<unknown, unknown, never>
    }

    const reserved = yield* Ref.modify(commands, (current) => {
      if (current.has(decodedId)) {
        return [false, current] as const
      }

      const next = new Map(current)
      next.set(decodedId, stored)
      return [true, next] as const
    })

    if (!reserved) {
      completed = true
      return yield* Effect.fail(
        new CommandRegistryCommandAlreadyRegisteredError({
          operation: "CommandRegistry.register",
          commandId: decodedId
        })
      )
    }

    const registeredHandle = yield* resources.register({
      kind: "command",
      id: resourceId,
      ownerScope: registration.ownerScope,
      state: "registered",
      dispose: Effect.suspend(() => remove(decodedId, registeredResourceId).pipe(Effect.asVoid))
    })
    handle = registeredHandle
    registeredResourceId = registeredHandle.id
    const committed = yield* Ref.modify(commands, (current) => {
      const command = current.get(decodedId)
      if (command === undefined || command.resourceId === registeredHandle.id) {
        return [command !== undefined, current] as const
      }

      const next = new Map(current)
      next.set(decodedId, { ...command, resourceId: registeredHandle.id })
      return [true, next] as const
    })
    if (!committed) {
      return yield* Effect.fail(
        new CommandRegistryRegistrationLostError({
          operation: "CommandRegistry.register",
          commandId: decodedId,
          resourceId: registeredHandle.id
        })
      )
    }

    yield* auditCommand(audit, "command-registered", decodedId, "registered", now)
    completed = true
    return registeredHandle
  }).pipe(Effect.ensuring(rollback))
}

const getCommand = (
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  id: string,
  operation: string
): Effect.Effect<StoredCommand, CommandRegistryCommandNotFoundError, never> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(commands)
    const command = current.get(id)
    if (command === undefined) {
      return yield* Effect.fail(
        new CommandRegistryCommandNotFoundError({ operation, commandId: id })
      )
    }

    return command
  })

const decodeCommandInput = (
  command: StoredCommand,
  input: unknown
): Effect.Effect<unknown, CommandRegistryInvalidInputError, never> =>
  Schema.decodeUnknownEffect(command.inputSchema)(input, StrictParseOptions).pipe(
    Effect.mapError(
      (cause) =>
        new CommandRegistryInvalidInputError({
          operation: "CommandRegistry.invoke",
          commandId: Option.some(command.id),
          field: "input",
          message: "command input failed schema validation",
          cause: Option.some(cause)
        })
    )
  ) as Effect.Effect<unknown, CommandRegistryInvalidInputError, never>

const decodeCommandOutput = (
  command: StoredCommand,
  output: unknown
): Effect.Effect<unknown, CommandRegistryInvalidOutputError, never> =>
  Schema.decodeUnknownEffect(command.outputSchema)(output, StrictParseOptions).pipe(
    Effect.mapError(
      (cause) =>
        new CommandRegistryInvalidOutputError({
          operation: "CommandRegistry.invoke",
          commandId: command.id,
          message: "command output failed schema validation",
          cause: Option.some(cause)
        })
    )
  ) as Effect.Effect<unknown, CommandRegistryInvalidOutputError, never>

const invokeCommandHandler = (
  command: StoredCommand,
  input: unknown
): Effect.Effect<unknown, CommandRegistryHandlerFailureError, never> =>
  Effect.try({
    try: () => command.handler(input),
    catch: (cause) => handlerFailure(command.id, cause)
  }).pipe(
    Effect.flatMap((effect) =>
      effect.pipe(
        Effect.mapError((cause) => handlerFailure(command.id, cause)),
        Effect.catchDefect((cause) => Effect.fail(handlerFailure(command.id, cause)))
      )
    )
  )

const handlerFailure = (commandId: string, cause: unknown): CommandRegistryHandlerFailureError =>
  new CommandRegistryHandlerFailureError({
    operation: "CommandRegistry.invoke",
    commandId,
    cause
  })

const decodeCommandId = (
  id: string,
  operation: string
): Effect.Effect<string, CommandRegistryInvalidInputError, never> =>
  Schema.decodeUnknownEffect(NonEmptyString)(id).pipe(
    Effect.mapError(
      (cause) =>
        new CommandRegistryInvalidInputError({
          operation,
          commandId: Option.none(),
          field: "id",
          message: "command id must be a non-empty string",
          cause: Option.some(cause)
        })
    )
  )

const commandResourceId = (id: string): ResourceId => `command:${id}` as ResourceId

const auditCommand = (
  audit: EventLogStore | undefined,
  kind: "command-registered" | "command-unregistered" | "command-invoked",
  commandId: string,
  outcome: string,
  now: () => number,
  traceId: string = `command:${commandId}`
): Effect.Effect<void, CommandRegistryAuditFailedError, never> =>
  emitAuditEvent(
    audit,
    new AuditEvent({
      kind,
      source: "CommandRegistry",
      traceId,
      outcome,
      timestamp: now(),
      details: { commandId }
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new CommandRegistryAuditFailedError({
          operation: "CommandRegistry.audit",
          commandId,
          cause
        })
    )
  )
