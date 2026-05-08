import { Context, Data, Effect, Option, PubSub, Ref, Schema, Stream } from "effect"

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
// eslint-disable-next-line no-control-regex -- Intentionally matches control chars to reject them.
const CommandIdString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\x00-\x1f\x7f]+$/))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
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

export class CommandInvocationRecord extends Schema.Class<CommandInvocationRecord>(
  "CommandInvocationRecord"
)({
  commandId: Schema.String,
  actor: Schema.Unknown,
  traceId: NonEmptyString,
  outcome: Schema.Literals(["success", "failure"]),
  timestamp: NonNegativeInt,
  durationMs: NonNegativeInt,
  errorTag: Schema.optionalKey(NonEmptyString)
}) {}

export class CommandSnapshot extends Schema.Class<CommandSnapshot>("CommandSnapshot")({
  id: NonEmptyString,
  capability: Schema.Unknown,
  ownerScope: NonEmptyString,
  invocationCount: NonNegativeInt,
  lastInvocation: Schema.optionalKey(CommandInvocationRecord),
  lastError: Schema.optionalKey(CommandInvocationRecord)
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
  readonly observeInvocations: () => Stream.Stream<CommandInvocationRecord, never, never>
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
  readonly resourceGeneration: number
  readonly registrationToken: symbol
  readonly handler: (input: unknown) => Effect.Effect<unknown, unknown, never>
  readonly invocationCount: number
  readonly lastInvocation?: CommandInvocationRecord
  readonly lastError?: CommandInvocationRecord
}

export const makeCommandRegistry = (
  resources: ResourceRegistryApi,
  permissions: PermissionRegistryApi,
  options: CommandRegistryOptions = {}
): Effect.Effect<CommandRegistryApi, never, never> =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyMap<string, StoredCommand>>(new Map())
    const invocations = yield* PubSub.sliding<CommandInvocationRecord>({ capacity: 1024 })
    const now = options.now ?? Date.now

    const remove = (
      id: string,
      resourceId?: ResourceId,
      resourceGeneration?: number,
      registrationToken?: symbol
    ): Effect.Effect<StoredCommand | undefined, never, never> =>
      Ref.modify(commands, (current) => {
        const command = current.get(id)
        if (command === undefined) {
          return [undefined, current] as const
        }
        if (registrationToken !== undefined && command.registrationToken !== registrationToken) {
          return [undefined, current] as const
        }
        if (
          resourceId !== undefined &&
          (command.resourceId !== resourceId || command.resourceGeneration !== resourceGeneration)
        ) {
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
        invokeCommand(commands, invocations, permissions, options.audit, now, id, input, context),
      list: () =>
        Ref.get(commands).pipe(
          Effect.map((current) =>
            [...current.values()]
              .map(
                (command) =>
                  new CommandSnapshot({
                    id: command.id,
                    capability: command.capability,
                    ownerScope: command.ownerScope,
                    invocationCount: command.invocationCount,
                    ...(command.lastInvocation === undefined
                      ? {}
                      : { lastInvocation: command.lastInvocation }),
                    ...(command.lastError === undefined ? {} : { lastError: command.lastError })
                  })
              )
              .sort((left, right) => left.id.localeCompare(right.id))
          )
        ),
      observeInvocations: () => Stream.fromPubSub(invocations)
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

const invokeCommand = (
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  invocations: PubSub.PubSub<CommandInvocationRecord>,
  permissions: PermissionRegistryApi,
  audit: EventLogStore | undefined,
  now: () => number,
  id: string,
  input: unknown,
  context: PermissionContext
): Effect.Effect<unknown, CommandRegistryError, never> => {
  const startedAt = now()

  return Effect.gen(function* () {
    const decodedId = yield* decodeCommandId(id, "CommandRegistry.invoke")
    const command = yield* getCommand(commands, decodedId, "CommandRegistry.invoke")
    const decodedInput = yield* decodeCommandInput(command, input)
    const grant = yield* permissions.check(command.capability, context, {
      source: `command:${decodedId}`
    })
    const output = yield* permissions.use(grant, invokeCommandHandler(command, decodedInput))
    const decodedOutput = yield* decodeCommandOutput(command, output)
    yield* auditCommand(audit, "command-invoked", decodedId, "success", now, grant.traceId)
    return decodedOutput
  }).pipe(
    Effect.tap(() =>
      recordCommandInvocation(commands, invocations, now, startedAt, id, context, "success")
    ),
    Effect.tapError((error: CommandRegistryError) =>
      recordCommandInvocation(
        commands,
        invocations,
        now,
        startedAt,
        id,
        context,
        "failure",
        errorTag(error)
      )
    ),
    Effect.withSpan("CommandRegistry.invoke", { attributes: { commandId: id } })
  )
}

const recordCommandInvocation = (
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  invocations: PubSub.PubSub<CommandInvocationRecord>,
  now: () => number,
  startedAt: number,
  commandId: string,
  context: PermissionContext,
  outcome: "success" | "failure",
  errorTag?: string
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = now()
    const record = new CommandInvocationRecord({
      commandId,
      actor: context.actor,
      traceId: context.traceId ?? fallbackTraceId(commandId),
      outcome,
      timestamp,
      durationMs: Math.max(0, timestamp - startedAt),
      ...(errorTag === undefined ? {} : { errorTag })
    })

    yield* Ref.update(commands, (current) => {
      const command = current.get(commandId)
      if (command === undefined) {
        return current
      }

      const next = new Map(current)
      next.set(commandId, {
        ...command,
        invocationCount: command.invocationCount + 1,
        lastInvocation: record,
        ...(outcome === "failure" ? { lastError: record } : {})
      })
      return next
    })
    yield* PubSub.publish(invocations, record)
  })

const fallbackTraceId = (commandId: string): string =>
  commandId.length === 0 ? "command:unknown" : `command:${commandId}`

const errorTag = (error: CommandRegistryError): string =>
  "_tag" in error && typeof error._tag === "string" ? error._tag : "PermissionRegistryError"

const registerCommand = <I, O>(
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  resources: ResourceRegistryApi,
  remove: (
    id: string,
    resourceId?: ResourceId,
    resourceGeneration?: number,
    registrationToken?: symbol
  ) => Effect.Effect<StoredCommand | undefined, never, never>,
  audit: EventLogStore | undefined,
  now: () => number,
  registration: CommandRegistration<I, O>
): Effect.Effect<ResourceHandle<"command", "registered">, CommandRegistryError, never> => {
  let reservedId: string | undefined
  let reservedToken: symbol | undefined
  let handle: ResourceHandle<"command", "registered"> | undefined
  let completed = false

  const rollback = Effect.suspend(() => {
    if (completed || reservedId === undefined) {
      return Effect.void
    }

    return handle === undefined
      ? remove(reservedId, undefined, undefined, reservedToken).pipe(Effect.asVoid)
      : resources.dispose(handle.id)
  })

  return Effect.gen(function* () {
    const decodedId = yield* decodeCommandId(registration.id, "CommandRegistry.register")
    reservedId = decodedId
    const resourceId = commandResourceId(decodedId)
    let registeredResourceId = resourceId
    let registeredResourceGeneration = 0
    const registrationToken = Symbol(decodedId)
    reservedToken = registrationToken
    const stored: StoredCommand = {
      id: decodedId,
      inputSchema: registration.inputSchema as Schema.Schema<unknown>,
      outputSchema: registration.outputSchema as Schema.Schema<unknown>,
      capability: registration.capability,
      ownerScope: registration.ownerScope,
      resourceId,
      resourceGeneration: registeredResourceGeneration,
      registrationToken,
      handler: registration.handler as (input: unknown) => Effect.Effect<unknown, unknown, never>,
      invocationCount: 0
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
      dispose: Effect.suspend(() =>
        remove(
          decodedId,
          registeredResourceId,
          registeredResourceGeneration,
          registrationToken
        ).pipe(Effect.asVoid)
      )
    })
    handle = registeredHandle
    registeredResourceId = registeredHandle.id
    registeredResourceGeneration = registeredHandle.generation
    const committed = yield* Ref.modify(commands, (current) => {
      const command = current.get(decodedId)
      if (
        command === undefined ||
        command.registrationToken !== registrationToken ||
        (command.resourceId === registeredHandle.id &&
          command.resourceGeneration === registeredHandle.generation)
      ) {
        return [command !== undefined && command.registrationToken === registrationToken, current]
      }

      const next = new Map(current)
      next.set(decodedId, {
        ...command,
        resourceId: registeredHandle.id,
        resourceGeneration: registeredHandle.generation
      })
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
  Schema.decodeUnknownEffect(CommandIdString)(id).pipe(
    Effect.mapError(
      (cause) =>
        new CommandRegistryInvalidInputError({
          operation,
          commandId: Option.none(),
          field: "id",
          message: "command id must be a printable non-empty string",
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
