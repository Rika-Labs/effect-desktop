import {
  Cause,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Stream
} from "effect"

import {
  PermissionRegistry,
  type NormalizedCapability,
  type PermissionContext,
  type PermissionDeniedError,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "./permission-registry.js"
import {
  ResourceRegistry,
  type ResourceHandle,
  type ResourceRegistryApi,
  type StaleHandle
} from "./resources.js"

const NonEmptyString = Schema.NonEmptyString
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const StrictParseOptions = { onExcessProperty: "error" } as const

export class WorkerSpawnInput extends Schema.Class<WorkerSpawnInput>("WorkerSpawnInput")({
  script: NonEmptyString,
  ownerScope: NonEmptyString,
  capabilities: Schema.Array(Schema.Unknown)
}) {}

export class WorkerSnapshot extends Schema.Class<WorkerSnapshot>("WorkerSnapshot")({
  id: NonEmptyString,
  script: NonEmptyString,
  ownerScope: NonEmptyString,
  resourceId: NonEmptyString,
  status: Schema.Literals(["running"]),
  uptimeMs: NonNegativeInt,
  capabilities: Schema.Array(Schema.Unknown),
  lastError: Schema.optionalKey(Schema.Unknown)
}) {}

export class WorkerChannelError extends Data.TaggedError("ChannelError")<{
  readonly operation: string
  readonly field: "input" | "output" | "transport"
  readonly script: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class WorkerCapabilityNotHeldError extends Data.TaggedError("CapabilityNotHeld")<{
  readonly operation: string
  readonly script: string
  readonly kind: NormalizedCapability["kind"]
  readonly capability: NormalizedCapability
  readonly context: PermissionContext
  readonly cause: Option.Option<PermissionDeniedError | PermissionRegistryError>
}> {}

export class WorkerCrashedError extends Data.TaggedError("WorkerCrashed")<{
  readonly operation: string
  readonly script: string
  readonly resourceId: Option.Option<string>
  readonly exitCode: Option.Option<number>
  readonly signal: Option.Option<string>
  readonly lastError: Option.Option<unknown>
}> {}

export class WorkerInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class WorkerResourceBusyError extends Data.TaggedError("ResourceBusy")<{
  readonly operation: string
  readonly ownerScope: string
  readonly maxConcurrent: number
}> {}

export class WorkerStaleHandleError extends Data.TaggedError("StaleHandle")<{
  readonly operation: string
  readonly kind: string
  readonly id: string
  readonly expectedGeneration: number
  readonly actualGeneration: number
}> {}

export class WorkerUnsupportedError extends Data.TaggedError("Unsupported")<{
  readonly operation: string
  readonly script: string
  readonly reason: string
  readonly cause: Option.Option<unknown>
}> {}

export type WorkerError =
  | WorkerChannelError
  | WorkerCapabilityNotHeldError
  | WorkerCrashedError
  | WorkerInvalidArgumentError
  | WorkerResourceBusyError
  | WorkerStaleHandleError
  | WorkerUnsupportedError

export interface WorkerSpawnOptions<In, Out> {
  readonly script: string
  readonly ownerScope: string
  readonly inputSchema: Schema.Schema<In>
  readonly outputSchema: Schema.Schema<Out>
  readonly context: PermissionContext
  readonly capabilities?: readonly NormalizedCapability[]
}

export interface WorkerHandle<In, Out> {
  readonly resource: ResourceHandle<"worker", "running">
  readonly send: (message: In) => Effect.Effect<void, WorkerError, never>
  readonly messages: Stream.Stream<Out, WorkerError, never>
  readonly close: Effect.Effect<void, never, never>
}

export interface WorkerApi {
  readonly spawn: <In, Out>(
    options: WorkerSpawnOptions<In, Out>
  ) => Effect.Effect<WorkerHandle<In, Out>, WorkerError, never>
  readonly list: () => Effect.Effect<readonly WorkerSnapshot[], never, never>
}

export interface WorkerAdapter {
  readonly spawn: (
    input: WorkerAdapterSpawnInput
  ) => Effect.Effect<WorkerRuntime, WorkerError, never>
}

export interface WorkerAdapterSpawnInput {
  readonly script: string
  readonly ownerScope: string
  readonly capabilities: readonly NormalizedCapability[]
  readonly messageBufferSize: number
  readonly gracefulShutdownMs: number
}

export interface WorkerRuntime {
  readonly send: (message: unknown) => Effect.Effect<void, WorkerError, never>
  readonly messages: Stream.Stream<unknown, WorkerError, never>
  readonly exit: Effect.Effect<void, WorkerError, never>
  readonly shutdown: Effect.Effect<void, never, never>
}

export interface WorkerOptions {
  readonly adapter?: WorkerAdapter
  readonly budgets?: WorkerBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly now?: () => number
}

export interface WorkerBudgetPolicy {
  readonly maxConcurrent?: number
  readonly messageBufferSize?: number
}

const DEFAULT_WORKER_BUDGETS: Required<WorkerBudgetPolicy> = Object.freeze({
  maxConcurrent: 16,
  messageBufferSize: 1_024
})
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000

export const makeWorker = (
  registry: ResourceRegistryApi,
  permissions: PermissionRegistryApi,
  options: WorkerOptions = {}
): Effect.Effect<WorkerApi, never, never> =>
  Effect.gen(function* () {
    const adapter = options.adapter ?? BunWorkerAdapter
    const budgets = { ...DEFAULT_WORKER_BUDGETS, ...options.budgets }
    const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS
    const now = options.now ?? Date.now
    const workerBudgets = yield* Ref.make(new Map<string, number>())
    const workers = yield* Ref.make<ReadonlyMap<string, StoredWorker>>(new Map())

    return Object.freeze({
      spawn: <In, Out>(options: WorkerSpawnOptions<In, Out>) =>
        Effect.gen(function* () {
          yield* validateGracefulShutdownMs(gracefulShutdownMs, "Worker.spawn")
          const inputSchema = yield* validateChannelSchema(
            options.inputSchema,
            "inputSchema",
            "Worker.spawn"
          )
          const outputSchema = yield* validateChannelSchema(
            options.outputSchema,
            "outputSchema",
            "Worker.spawn"
          )
          const input = yield* decodeSpawnInput(
            {
              script: options.script,
              ownerScope: options.ownerScope,
              capabilities: options.capabilities ?? []
            },
            "Worker.spawn"
          )
          yield* authorizeWorkerCapabilities(permissions, input, options.context)

          const { runtime, resource } = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* reserveWorkerBudget(workerBudgets, input.ownerScope, budgets.maxConcurrent)
              const runtime = yield* adapter
                .spawn({
                  script: input.script,
                  ownerScope: input.ownerScope,
                  capabilities: options.capabilities ?? [],
                  messageBufferSize: budgets.messageBufferSize,
                  gracefulShutdownMs
                })
                .pipe(Effect.tapError(() => releaseWorkerBudget(workerBudgets, input.ownerScope)))
              let registeredResourceId: string | undefined
              const resource = yield* registry
                .register({
                  kind: "worker",
                  ownerScope: input.ownerScope,
                  state: "running",
                  dispose: runtime.shutdown.pipe(
                    Effect.andThen(removeWorker(workers, () => registeredResourceId)),
                    Effect.andThen(releaseWorkerBudget(workerBudgets, input.ownerScope))
                  )
                })
                .pipe(Effect.orDie)
              if (resource.id.length === 0) {
                yield* resource.dispose().pipe(
                  Effect.andThen(
                    Effect.fail(
                      new WorkerInvalidArgumentError({
                        operation: "Worker.spawn",
                        field: "resourceId",
                        message: "resource id must be non-empty",
                        cause: Option.none()
                      })
                    )
                  )
                )
              }
              registeredResourceId = resource.id
              yield* Ref.update(workers, (current) =>
                new Map(current).set(resource.id, {
                  id: resource.id,
                  script: input.script,
                  ownerScope: input.ownerScope,
                  resourceId: resource.id,
                  startedAt: now(),
                  capabilities: input.capabilities
                })
              )
              observeWorkerExit(runtime.exit, resource, input.script)

              return { runtime, resource }
            })
          )

          return makeHandle(
            runtime,
            resource,
            input.script,
            inputSchema as Schema.Schema<In>,
            outputSchema as Schema.Schema<Out>,
            registry
          )
        }).pipe(
          Effect.withSpan("Worker.spawn", {
            attributes: {
              script: options.script,
              ownerScope: options.ownerScope,
              capabilityCount: options.capabilities?.length ?? 0
            }
          })
        ),
      list: () =>
        Ref.get(workers).pipe(
          Effect.map((current) =>
            [...current.values()]
              .map(
                (worker) =>
                  new WorkerSnapshot({
                    id: worker.id,
                    script: worker.script,
                    ownerScope: worker.ownerScope,
                    resourceId: worker.resourceId,
                    status: "running",
                    uptimeMs: workerUptimeMs(worker.startedAt, now()),
                    capabilities: [...worker.capabilities],
                    ...(worker.lastError === undefined ? {} : { lastError: worker.lastError })
                  })
              )
              .sort((left, right) => left.id.localeCompare(right.id))
          )
        )
    } satisfies WorkerApi)
  })

export class Worker extends Context.Service<Worker, WorkerApi>()("Worker") {}

export const WorkerLive = Layer.effect(
  Worker,
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    const permissions = yield* PermissionRegistry
    return yield* makeWorker(registry, permissions)
  })
)

export const WorkerLayer = (
  options: WorkerOptions = {}
): Layer.Layer<Worker, never, ResourceRegistry | PermissionRegistry> =>
  Layer.effect(
    Worker,
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      const permissions = yield* PermissionRegistry
      return yield* makeWorker(registry, permissions, options)
    })
  )

const makeHandle = <In, Out>(
  runtime: WorkerRuntime,
  resource: ResourceHandle<"worker", "running">,
  script: string,
  inputSchema: Schema.Schema<In>,
  outputSchema: Schema.Schema<Out>,
  registry: ResourceRegistryApi
): WorkerHandle<In, Out> => {
  const messages = runtime.messages.pipe(
    Stream.mapError((error) => attachWorkerResourceId(error, resource.id)),
    Stream.mapEffect((message) => decodeOutput(message, outputSchema, script))
  )

  return Object.freeze({
    resource,
    send: (message: In) =>
      Effect.gen(function* () {
        const decoded = yield* decodeInput(message, inputSchema, script)
        yield* assertWorkerHandleFresh(registry, resource, "Worker.send")
        yield* runtime.send(decoded)
      }).pipe(Effect.withSpan("Worker.send", { attributes: { script, resourceId: resource.id } })),
    messages,
    close: resource.dispose()
  })
}

const assertWorkerHandleFresh = (
  registry: ResourceRegistryApi,
  resource: ResourceHandle<"worker", "running">,
  operation: string
): Effect.Effect<void, WorkerStaleHandleError, never> =>
  registry.assertFresh(resource).pipe(
    Effect.asVoid,
    Effect.mapError((error) => makeWorkerStaleHandleError(error, operation))
  )

const makeWorkerStaleHandleError = (
  error: StaleHandle,
  operation: string
): WorkerStaleHandleError =>
  new WorkerStaleHandleError({
    operation,
    kind: error.kind,
    id: error.id,
    expectedGeneration: error.expectedGeneration,
    actualGeneration: error.actualGeneration
  })

const attachWorkerResourceId = (error: WorkerError, resourceId: string): WorkerError => {
  if (error._tag !== "WorkerCrashed") {
    return error
  }

  return new WorkerCrashedError({
    operation: error.operation,
    script: error.script,
    resourceId: Option.some(resourceId),
    exitCode: error.exitCode,
    signal: error.signal,
    lastError: error.lastError
  })
}

const observeWorkerExit = (
  exit: Effect.Effect<void, WorkerError, never>,
  resource: ResourceHandle<"worker", "running">,
  script: string
): void => {
  Effect.runFork(
    exit.pipe(
      Effect.exit,
      Effect.flatMap((result) =>
        resource.dispose().pipe(
          Effect.andThen(
            Exit.isFailure(result)
              ? Effect.logWarning("Worker.exit observer failed", {
                  script,
                  reason: formatWorkerExitFailure(result)
                })
              : Effect.void
          )
        )
      )
    )
  )
}

interface StoredWorker {
  readonly id: string
  readonly script: string
  readonly ownerScope: string
  readonly resourceId: string
  readonly startedAt: number
  readonly capabilities: readonly unknown[]
  readonly lastError?: unknown
}

const workerUptimeMs = (startedAt: number, currentTimestamp: number): number => {
  if (!Number.isFinite(startedAt) || !Number.isFinite(currentTimestamp)) {
    return 0
  }

  const uptimeMs = Math.floor(currentTimestamp - startedAt)
  return Number.isSafeInteger(uptimeMs) && uptimeMs >= 0 ? uptimeMs : 0
}

const removeWorker = (
  workers: Ref.Ref<ReadonlyMap<string, StoredWorker>>,
  id: () => string | undefined
): Effect.Effect<void, never, never> =>
  Ref.update(workers, (current) => {
    const resourceId = id()
    if (resourceId === undefined || !current.has(resourceId)) {
      return current
    }

    const next = new Map(current)
    next.delete(resourceId)
    return next
  })

const formatWorkerExitFailure = (exit: Exit.Exit<void, WorkerError>): string => {
  if (!Exit.isFailure(exit)) {
    return "success"
  }

  const failure = exit.cause.reasons.find(Cause.isFailReason)
  if (failure === undefined) {
    return String(exit.cause)
  }

  return `${failure.error._tag}: ${failure.error.operation}`
}

const decodeSpawnInput = (
  input: unknown,
  operation: string
): Effect.Effect<WorkerSpawnInput, WorkerInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(WorkerSpawnInput)(input, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new WorkerInvalidArgumentError({
          operation,
          field: "payload",
          message: String(error),
          cause: Option.some(error)
        })
    )
  )

const validateGracefulShutdownMs = (
  value: number,
  operation: string
): Effect.Effect<void, WorkerInvalidArgumentError, never> =>
  Number.isSafeInteger(value) && value >= 0
    ? Effect.void
    : Effect.fail(
        new WorkerInvalidArgumentError({
          operation,
          field: "gracefulShutdownMs",
          message: "must be a non-negative safe integer",
          cause: Option.none()
        })
      )

const validateChannelSchema = (
  schema: unknown,
  field: "inputSchema" | "outputSchema",
  operation: string
): Effect.Effect<Schema.Schema<unknown>, WorkerInvalidArgumentError, never> =>
  isEffectSchema(schema)
    ? Effect.succeed(schema)
    : Effect.fail(
        new WorkerInvalidArgumentError({
          operation,
          field,
          message: "must be an Effect schema",
          cause: Option.none()
        })
      )

const isEffectSchema = (schema: unknown): schema is Schema.Schema<unknown> =>
  (typeof schema === "object" || typeof schema === "function") && schema !== null && "ast" in schema

const decodeInput = <In>(
  input: unknown,
  schema: Schema.Schema<In>,
  script: string
): Effect.Effect<In, WorkerChannelError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new WorkerChannelError({
          operation: "Worker.send",
          field: "input",
          script,
          message: String(error),
          cause: Option.some(error)
        })
    )
  ) as Effect.Effect<In, WorkerChannelError, never>

const decodeOutput = <Out>(
  input: unknown,
  schema: Schema.Schema<Out>,
  script: string
): Effect.Effect<Out, WorkerChannelError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new WorkerChannelError({
          operation: "Worker.messages",
          field: "output",
          script,
          message: String(error),
          cause: Option.some(error)
        })
    )
  ) as Effect.Effect<Out, WorkerChannelError, never>

const authorizeWorkerCapabilities = (
  permissions: PermissionRegistryApi,
  input: WorkerSpawnInput,
  context: PermissionContext
): Effect.Effect<void, WorkerCapabilityNotHeldError, never> =>
  Effect.forEach(
    input.capabilities,
    (capability) =>
      permissions
        .check(capability as NormalizedCapability, context, {
          source: `worker:${input.script}`
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new WorkerCapabilityNotHeldError({
                operation: "Worker.spawn",
                script: input.script,
                kind: (capability as NormalizedCapability).kind,
                capability: capability as NormalizedCapability,
                context,
                cause: Option.some(error)
              })
          )
        ),
    { discard: true }
  )

const reserveWorkerBudget = (
  workerBudgets: Ref.Ref<Map<string, number>>,
  ownerScope: string,
  maxConcurrent: number
): Effect.Effect<void, WorkerResourceBusyError, never> =>
  Effect.gen(function* () {
    const reserved = yield* Ref.modify(workerBudgets, (current) => {
      const runningWorkers = current.get(ownerScope) ?? 0
      if (runningWorkers >= maxConcurrent) {
        return [false, current] as const
      }
      const next = new Map(current)
      next.set(ownerScope, runningWorkers + 1)
      return [true, next] as const
    })

    if (!reserved) {
      return yield* Effect.fail(
        new WorkerResourceBusyError({
          operation: "Worker.spawn",
          ownerScope,
          maxConcurrent
        })
      )
    }
  })

const releaseWorkerBudget = (
  workerBudgets: Ref.Ref<Map<string, number>>,
  ownerScope: string
): Effect.Effect<void, never, never> =>
  Ref.update(workerBudgets, (current) => {
    const runningWorkers = current.get(ownerScope) ?? 0
    const next = new Map(current)
    if (runningWorkers <= 1) {
      next.delete(ownerScope)
    } else {
      next.set(ownerScope, runningWorkers - 1)
    }
    return next
  })

export const BunWorkerAdapter: WorkerAdapter = Object.freeze({
  spawn: (input: WorkerAdapterSpawnInput) =>
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<unknown, WorkerError | Cause.Done>(input.messageBufferSize)
      const exit = yield* Deferred.make<void, WorkerError>()
      const worker = yield* Effect.try({
        try: () => new globalThis.Worker(input.script),
        catch: (cause) =>
          new WorkerUnsupportedError({
            operation: "Worker.spawn",
            script: input.script,
            reason: "Bun Worker construction failed",
            cause: Option.some(cause)
          })
      })

      const resourceId = Option.none<string>()
      const onMessage = (event: MessageEvent): void => {
        Effect.runFork(Queue.offer(queue, event.data))
      }
      const onError = (event: ErrorEvent): void => {
        const error = new WorkerCrashedError({
          operation: "Worker.messages",
          script: input.script,
          resourceId,
          exitCode: Option.none(),
          signal: Option.none(),
          lastError: Option.some(event.error ?? event.message)
        })
        Effect.runFork(
          Queue.fail(queue, error).pipe(Effect.andThen(Deferred.fail(exit, error)), Effect.asVoid)
        )
      }
      const onMessageError = (event: MessageEvent): void => {
        const error = new WorkerChannelError({
          operation: "Worker.messages",
          field: "transport",
          script: input.script,
          message: "worker message could not be deserialized",
          cause: Option.some(event.data)
        })
        Effect.runFork(
          Queue.fail(queue, error).pipe(Effect.andThen(Deferred.fail(exit, error)), Effect.asVoid)
        )
      }
      const onClose = (event: Event): void => {
        const exitCode = "code" in event && typeof event.code === "number" ? event.code : 0
        if (exitCode === 0) {
          Effect.runFork(Queue.end(queue).pipe(Effect.andThen(Deferred.succeed(exit, undefined))))
          return
        }
        const error = new WorkerCrashedError({
          operation: "Worker.messages",
          script: input.script,
          resourceId,
          exitCode: Option.some(exitCode),
          signal: Option.none(),
          lastError: Option.none()
        })
        Effect.runFork(
          Queue.fail(queue, error).pipe(Effect.andThen(Deferred.fail(exit, error)), Effect.asVoid)
        )
      }

      worker.addEventListener("message", onMessage)
      worker.addEventListener("error", onError)
      worker.addEventListener("messageerror", onMessageError)
      worker.addEventListener("close", onClose)

      return {
        send: (message: unknown) =>
          Effect.try({
            try: () => worker.postMessage(message),
            catch: (cause) =>
              new WorkerChannelError({
                operation: "Worker.send",
                field: "transport",
                script: input.script,
                message: "worker postMessage failed",
                cause: Option.some(cause)
              })
          }),
        messages: Stream.fromQueue(queue),
        exit: Deferred.await(exit),
        shutdown: Effect.gen(function* () {
          const warnShutdownFailure = (phase: string, cause: unknown) =>
            Effect.logWarning("Worker.shutdown failed", {
              script: input.script,
              phase,
              reason: String(cause)
            })

          yield* Effect.try({
            try: () => worker.postMessage({ _tag: "Shutdown" }),
            catch: (cause) => cause
          }).pipe(Effect.catch((cause) => warnShutdownFailure("postMessage", cause)))
          const gracefulExit = yield* Effect.timeoutOption(
            Deferred.await(exit),
            `${input.gracefulShutdownMs} millis`
          )
          if (Option.isNone(gracefulExit)) {
            yield* Effect.try({
              try: () => worker.terminate(),
              catch: (cause) => cause
            }).pipe(Effect.catch((cause) => warnShutdownFailure("terminate", cause)))
          }
          yield* cleanupWorkerListeners(worker, onMessage, onError, onMessageError, onClose).pipe(
            Effect.catchDefect((cause) => warnShutdownFailure("removeListeners", cause))
          )
          yield* Queue.shutdown(queue).pipe(
            Effect.catch((cause) => warnShutdownFailure("queueShutdown", cause)),
            Effect.catchDefect((cause) => warnShutdownFailure("queueShutdown", cause))
          )
        }) as Effect.Effect<void, never, never>
      } satisfies WorkerRuntime
    })
})

const cleanupWorkerListeners = (
  worker: globalThis.Worker,
  onMessage: (event: MessageEvent) => void,
  onError: (event: ErrorEvent) => void,
  onMessageError: (event: MessageEvent) => void,
  onClose: (event: Event) => void
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    worker.removeEventListener("message", onMessage)
    worker.removeEventListener("error", onError)
    worker.removeEventListener("messageerror", onMessageError)
    worker.removeEventListener("close", onClose)
  })
