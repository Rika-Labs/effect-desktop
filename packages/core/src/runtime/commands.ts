import {
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream
} from "effect"
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc"

import { rpcCapability } from "@effect-desktop/bridge"

import { AuditEvent, emitAuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  PermissionRegistry,
  NormalizedCapability as NormalizedCapabilitySchema,
  type NormalizedCapability,
  type PermissionContext,
  type PermissionRegistryApi
} from "./permission-registry.js"
import {
  makePermissionInterceptorLayer,
  PermissionDenied,
  PermissionInterceptor
} from "./permission-interceptor.js"
import {
  ResourceRegistry,
  type ResourceHandle,
  type ResourceId,
  type ResourceRegistryApi,
  type ScopeId
} from "./resources.js"
import type { DesktopRpcRegistrationGroup as RpcGroupWithRequests } from "./desktop-rpc-registry.js"

const NonEmptyString = Schema.NonEmptyString
// eslint-disable-next-line no-control-regex -- Intentionally matches control chars to reject them.
const CommandIdString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\x00-\x1f\x7f]+$/))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export class CommandRegistryInvalidInputError extends Data.TaggedError("InvalidInput")<{
  readonly operation: string
  readonly commandId: Option.Option<string>
  readonly field: string
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
  readonly cause: unknown
}> {}

export class CommandRegistryCommittedAuditFailedError extends Data.TaggedError(
  "CommandCommittedAuditFailed"
)<{
  readonly operation: string
  readonly commandId: string
  readonly cause: CommandRegistryAuditFailedError
}> {}

export type CommandRegistryError =
  | CommandRegistryInvalidInputError
  | CommandRegistryCommandNotFoundError
  | CommandRegistryCommandAlreadyRegisteredError
  | CommandRegistryRegistrationLostError
  | CommandRegistryHandlerFailureError
  | CommandRegistryAuditFailedError
  | CommandRegistryCommittedAuditFailedError
  | PermissionDenied

export interface CommandGroupRegistration<Group extends RpcGroup.Any & RpcGroupWithRequests, E, R> {
  readonly group: Group
  readonly handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<Group>>, E, R>
  readonly ownerScope: ScopeId
}

export class CommandInvocationRecord extends Schema.Class<CommandInvocationRecord>(
  "CommandInvocationRecord"
)({
  commandId: Schema.String,
  actor: Schema.Unknown,
  traceId: NonEmptyString,
  outcome: Schema.Literals(["success", "failure", "committed-audit-failure"]),
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
  readonly registerGroup: <Group extends RpcGroup.Any & RpcGroupWithRequests, E, R>(
    registration: CommandGroupRegistration<Group, E, R>
  ) => Effect.Effect<ResourceHandle<"command-group", "registered">, CommandRegistryError | E, R>
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
  readonly audit?: AuditEventsApi
  readonly now?: () => number
}

interface StoredCommand {
  readonly id: string
  readonly capability: NormalizedCapability
  readonly ownerScope: ScopeId
  readonly resourceId: ResourceId
  readonly resourceGeneration: number
  readonly registrationToken: symbol
  readonly committed: boolean
  readonly invoke: (
    input: unknown,
    context: PermissionContext
  ) => Effect.Effect<unknown, unknown, never>
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
      registerGroup: (registration) =>
        registerCommandGroup(
          commands,
          resources,
          permissions,
          remove,
          options.audit,
          now,
          registration
        ).pipe(Effect.withSpan("CommandRegistry.registerGroup")),
      unregister: (id) =>
        Effect.gen(function* () {
          const decodedId = yield* decodeCommandId(id, "CommandRegistry.unregister")
          const command = yield* remove(decodedId)

          if (command === undefined) {
            return yield* Effect.fail(
              new CommandRegistryCommandNotFoundError({
                operation: "CommandRegistry.unregister",
                commandId: decodedId
              })
            )
          }

          yield* resources.dispose(command.resourceId)
          yield* auditCommand(options.audit, "command-unregistered", decodedId, "unregistered", now)
        }).pipe(Effect.withSpan("CommandRegistry.unregister")),
      invoke: (id, input, context) =>
        invokeCommand(commands, invocations, options.audit, now, id, input, context),
      list: () =>
        Ref.get(commands).pipe(
          Effect.map((current) =>
            [...current.values()]
              .filter((command) => command.committed)
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

export const DesktopCommands = Object.freeze({
  layer: <Group extends RpcGroup.Any & RpcGroupWithRequests, E, R>(
    group: Group,
    handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<Group>>, E, R>,
    options: { readonly ownerScope?: ScopeId } = {}
  ): Layer.Layer<never, CommandRegistryError | E, CommandRegistry | ResourceRegistry | R> =>
    Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.gen(function* () {
          const registry = yield* CommandRegistry
          return yield* registry.registerGroup({
            group,
            handlers,
            ownerScope: options.ownerScope ?? "app"
          })
        }),
        (handle) =>
          Effect.gen(function* () {
            const resources = yield* ResourceRegistry
            yield* resources.dispose(handle.id)
          })
      )
    )
})

const invokeCommand = (
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  invocations: PubSub.PubSub<CommandInvocationRecord>,
  audit: AuditEventsApi | undefined,
  now: () => number,
  id: string,
  input: unknown,
  context: PermissionContext
): Effect.Effect<unknown, CommandRegistryError, never> => {
  let invocationStart:
    | {
        readonly decodedId: string
        readonly startedAt: number
      }
    | undefined

  return Effect.gen(function* () {
    const decodedId = yield* decodeCommandId(id, "CommandRegistry.invoke")
    const startedAt = yield* readCommandTimestamp(
      now,
      "CommandRegistry.invoke",
      decodedId,
      "startedAt"
    )
    invocationStart = { decodedId, startedAt }
    const command = yield* getCommand(commands, decodedId, "CommandRegistry.invoke")
    const output = yield* invokeCommandRpc(command, input, context)
    yield* auditCommand(
      audit,
      "command-invoked",
      decodedId,
      "success",
      now,
      commandTraceId(context, decodedId)
    ).pipe(
      Effect.mapError((error) => {
        if (error instanceof CommandRegistryInvalidInputError) {
          return error
        }

        return new CommandRegistryCommittedAuditFailedError({
          operation: "CommandRegistry.invoke",
          commandId: decodedId,
          cause: error
        })
      })
    )
    return { decodedId, output, startedAt }
  }).pipe(
    Effect.tap(({ decodedId, startedAt }) =>
      recordCommandInvocation(commands, invocations, now, startedAt, decodedId, context, "success")
    ),
    Effect.tapError((error: CommandRegistryError) =>
      Effect.gen(function* () {
        const start =
          invocationStart ??
          (yield* decodeCommandId(id, "CommandRegistry.invoke").pipe(
            Effect.flatMap((decodedId) =>
              readCommandTimestamp(now, "CommandRegistry.invoke", decodedId, "startedAt").pipe(
                Effect.map((startedAt) => ({ decodedId, startedAt }))
              )
            )
          ))

        yield* recordCommandInvocation(
          commands,
          invocations,
          now,
          start.startedAt,
          start.decodedId,
          context,
          error instanceof CommandRegistryCommittedAuditFailedError
            ? "committed-audit-failure"
            : "failure",
          errorTag(error)
        )
      })
    ),
    Effect.map(({ output }) => output),
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
  outcome: "success" | "failure" | "committed-audit-failure",
  errorTag?: string
): Effect.Effect<void, CommandRegistryInvalidInputError, never> =>
  Effect.gen(function* () {
    const timestamp = yield* readCommandTimestamp(
      now,
      "CommandRegistry.invoke",
      commandId,
      "timestamp"
    )
    const traceId =
      context.traceId === undefined || context.traceId.length === 0
        ? fallbackTraceId(commandId)
        : context.traceId
    const record = new CommandInvocationRecord({
      commandId,
      actor: context.actor,
      traceId,
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
        ...(outcome === "success" ? {} : { lastError: record })
      })
      return next
    })
    yield* PubSub.publish(invocations, record)
  })

const fallbackTraceId = (commandId: string): string =>
  commandId.length === 0 ? "command:unknown" : `command:${commandId}`

const errorTag = (error: CommandRegistryError): string =>
  "_tag" in error && typeof error._tag === "string" ? error._tag : "UnknownError"

const readCommandTimestamp = (
  now: () => number,
  operation: string,
  commandId: string,
  field: string
): Effect.Effect<number, CommandRegistryInvalidInputError, never> =>
  Effect.sync(now).pipe(
    Effect.flatMap((timestamp) =>
      Number.isSafeInteger(timestamp) && timestamp >= 0
        ? Effect.succeed(timestamp)
        : Effect.fail(
            new CommandRegistryInvalidInputError({
              operation,
              commandId: Option.some(commandId),
              field,
              message: "command clock must return a finite non-negative safe integer",
              cause: Option.some(timestamp)
            })
          )
    ),
    Effect.catchDefect((cause) =>
      Effect.fail(
        new CommandRegistryInvalidInputError({
          operation,
          commandId: Option.some(commandId),
          field,
          message: "command clock failed while reading a timestamp",
          cause: Option.some(cause)
        })
      )
    )
  )

const registerCommandGroup = <Group extends RpcGroup.Any & RpcGroupWithRequests, E, R>(
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  resources: ResourceRegistryApi,
  permissions: PermissionRegistryApi,
  remove: (
    id: string,
    resourceId?: ResourceId,
    resourceGeneration?: number,
    registrationToken?: symbol
  ) => Effect.Effect<StoredCommand | undefined, never, never>,
  audit: AuditEventsApi | undefined,
  now: () => number,
  registration: CommandGroupRegistration<Group, E, R>
): Effect.Effect<ResourceHandle<"command-group", "registered">, CommandRegistryError | E, R> => {
  let reservedIds: readonly string[] = []
  let reservedToken: symbol | undefined
  let handle: ResourceHandle<"command-group", "registered"> | undefined
  let commandScope: Scope.Scope | undefined
  let completed = false

  const rollback = Effect.suspend(() => {
    if (completed || reservedIds.length === 0) {
      return Effect.void
    }

    const closeCommandScope =
      commandScope === undefined ? Effect.void : Scope.close(commandScope, Exit.void)
    return (
      handle === undefined
        ? Effect.forEach(reservedIds, (id) =>
            remove(id, undefined, undefined, reservedToken).pipe(Effect.asVoid)
          ).pipe(Effect.asVoid)
        : resources.dispose(handle.id)
    ).pipe(Effect.andThen(closeCommandScope))
  })

  return Effect.gen(function* () {
    const registrationToken = Symbol("command-group")
    reservedToken = registrationToken
    // RpcGroupWithRequests is the metadata view we need for enumeration; RpcTest needs the full group.
    const rpcGroup = registration.group as unknown as RpcGroup.RpcGroup<RpcGroup.Rpcs<Group>>
    const scope = yield* Scope.make()
    commandScope = scope
    const client = yield* RpcTest.makeClient(rpcGroup.middleware(PermissionInterceptor)).pipe(
      Effect.provide(registration.handlers),
      Effect.provide(makePermissionInterceptorLayer()),
      Effect.provideService(PermissionRegistry, permissions),
      Scope.provide(scope)
    )
    const prepared = yield* prepareCommandGroup(registration, client, registrationToken)
    reservedIds = prepared.map((command) => command.id)
    const resourceId = commandGroupResourceId(reservedIds)
    let registeredResourceId = resourceId
    let registeredResourceGeneration = 0

    const reserved = yield* Ref.modify(commands, (current) => {
      if (prepared.some((command) => current.has(command.id))) {
        return [false, current] as const
      }

      const next = new Map(current)
      for (const command of prepared) {
        next.set(command.id, {
          ...command,
          resourceId,
          resourceGeneration: registeredResourceGeneration
        })
      }
      return [true, next] as const
    })

    if (!reserved) {
      completed = true
      return yield* Effect.fail(
        new CommandRegistryCommandAlreadyRegisteredError({
          operation: "CommandRegistry.registerGroup",
          commandId: reservedIds.find((id) => id.length > 0) ?? "unknown"
        })
      )
    }

    const registeredHandle = yield* resources
      .register({
        kind: "command-group",
        id: resourceId,
        ownerScope: registration.ownerScope,
        state: "registered",
        dispose: Effect.suspend(() =>
          Effect.forEach(reservedIds, (id) =>
            remove(id, registeredResourceId, registeredResourceGeneration, registrationToken)
          ).pipe(Effect.asVoid, Effect.andThen(Scope.close(scope, Exit.void)))
        )
      })
      .pipe(Effect.orDie)
    handle = registeredHandle
    registeredResourceId = registeredHandle.id
    registeredResourceGeneration = registeredHandle.generation
    const committed = yield* Ref.modify(commands, (current) => {
      const next = new Map(current)
      for (const id of reservedIds) {
        const command = current.get(id)
        if (command === undefined || command.registrationToken !== registrationToken) {
          return [false, current] as const
        }
        next.set(id, {
          ...command,
          committed: true,
          resourceId: registeredHandle.id,
          resourceGeneration: registeredHandle.generation
        })
      }
      return [true, next] as const
    })
    if (!committed) {
      return yield* Effect.fail(
        new CommandRegistryRegistrationLostError({
          operation: "CommandRegistry.registerGroup",
          commandId: reservedIds[0] ?? "unknown",
          resourceId: registeredHandle.id
        })
      )
    }

    yield* Effect.forEach(reservedIds, (id) =>
      auditCommand(audit, "command-registered", id, "registered", now)
    )
    completed = true
    return registeredHandle
  }).pipe(Effect.ensuring(rollback)) as Effect.Effect<
    ResourceHandle<"command-group", "registered">,
    CommandRegistryError | E,
    R
  >
}

const getCommand = (
  commands: Ref.Ref<ReadonlyMap<string, StoredCommand>>,
  id: string,
  operation: string
): Effect.Effect<StoredCommand, CommandRegistryCommandNotFoundError, never> =>
  Effect.gen(function* () {
    const current = yield* Ref.get(commands)
    const command = current.get(id)
    if (command === undefined || !command.committed) {
      return yield* Effect.fail(
        new CommandRegistryCommandNotFoundError({ operation, commandId: id })
      )
    }

    return command
  })

type DynamicRpcClient = Readonly<
  Record<
    string,
    (
      input: unknown,
      options?: { readonly headers?: Readonly<Record<string, string>> }
    ) => Effect.Effect<unknown, unknown, never>
  >
>

const prepareCommandGroup = <Group extends RpcGroup.Any & RpcGroupWithRequests, E, R>(
  registration: CommandGroupRegistration<Group, E, R>,
  client: unknown,
  registrationToken: symbol
): Effect.Effect<readonly StoredCommand[], CommandRegistryInvalidInputError, never> =>
  Effect.gen(function* () {
    // RpcTest generates one method per RPC tag; dynamic command dispatch is the string boundary.
    const dynamicClient = client as DynamicRpcClient
    const commands: StoredCommand[] = []
    for (const rpc of registration.group.requests.values()) {
      const id = yield* decodeCommandId(rpc._tag, "CommandRegistry.registerGroup")
      const capability = yield* decodeCommandCapability(rpc)
      const invoke = dynamicClient[rpc._tag]
      if (invoke === undefined) {
        return yield* Effect.fail(
          new CommandRegistryInvalidInputError({
            operation: "CommandRegistry.registerGroup",
            commandId: Option.some(id),
            field: "handler",
            message: "command RPC client is missing a generated endpoint",
            cause: Option.some(rpc._tag)
          })
        )
      }

      commands.push({
        id,
        capability,
        ownerScope: registration.ownerScope,
        resourceId: commandResourceId(id),
        resourceGeneration: 0,
        registrationToken,
        committed: false,
        invoke: (input, context) => invoke(input, { headers: commandHeaders(context) }),
        invocationCount: 0
      })
    }
    return commands
  })

const decodeCommandCapability = (
  rpc: Rpc.Any
): Effect.Effect<NormalizedCapability, CommandRegistryInvalidInputError, never> => {
  const capability = rpcCapability(rpc)
  if (Option.isNone(capability) || capability.value.kind === "none") {
    return Effect.fail(
      new CommandRegistryInvalidInputError({
        operation: "CommandRegistry.registerGroup",
        commandId: Option.some(rpc._tag),
        field: "capability",
        message: "command RPC must declare a concrete capability",
        cause: Option.none()
      })
    )
  }

  return Schema.decodeUnknownEffect(NormalizedCapabilitySchema)(capability.value).pipe(
    Effect.mapError(
      (cause) =>
        new CommandRegistryInvalidInputError({
          operation: "CommandRegistry.registerGroup",
          commandId: Option.some(rpc._tag),
          field: "capability",
          message: "command RPC capability failed schema validation",
          cause: Option.some(cause)
        })
    )
  )
}

const commandHeaders = (context: PermissionContext): Readonly<Record<string, string>> => ({
  "x-effect-desktop-actor-kind": context.actor.kind,
  "x-effect-desktop-actor-id": context.actor.id,
  ...(context.traceId === undefined || context.traceId.length === 0
    ? {}
    : { "x-effect-desktop-trace-id": context.traceId })
})

const invokeCommandRpc = (
  command: StoredCommand,
  input: unknown,
  context: PermissionContext
): Effect.Effect<unknown, CommandRegistryHandlerFailureError | PermissionDenied, never> =>
  command.invoke(input, context).pipe(
    Effect.mapError((cause) =>
      cause instanceof PermissionDenied ? cause : handlerFailure(command.id, cause)
    ),
    Effect.catchDefect((cause) => Effect.fail(handlerFailure(command.id, cause)))
  )

const commandTraceId = (context: PermissionContext, commandId: string): string =>
  context.traceId === undefined || context.traceId.length === 0
    ? fallbackTraceId(commandId)
    : context.traceId

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

const commandGroupResourceId = (ids: readonly string[]): ResourceId =>
  `command-group:${ids.join(",")}` as ResourceId

const auditCommand = (
  audit: AuditEventsApi | undefined,
  kind: "command-registered" | "command-unregistered" | "command-invoked",
  commandId: string,
  outcome: string,
  now: () => number,
  traceId: string = `command:${commandId}`
): Effect.Effect<
  void,
  CommandRegistryAuditFailedError | CommandRegistryInvalidInputError,
  never
> =>
  audit === undefined
    ? Effect.void
    : Effect.gen(function* () {
        const timestamp = yield* readCommandTimestamp(
          now,
          "CommandRegistry.audit",
          commandId,
          "timestamp"
        )

        yield* emitAuditEvent(
          audit,
          new AuditEvent({
            kind,
            source: "CommandRegistry",
            traceId,
            outcome,
            timestamp,
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
      })
