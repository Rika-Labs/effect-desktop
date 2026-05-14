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
  RcMap,
  Ref,
  Schema,
  Semaphore,
  Scope,
  Stream
} from "effect"
import * as EffectWorker from "effect/unstable/workers/Worker"
import {
  WorkerError as EffectWorkerError,
  WorkerReceiveError
} from "effect/unstable/workers/WorkerError"

import { holdScopedExecutionPermit } from "./execution-budgets.js"
import {
  PermissionRegistry,
  type NormalizedCapability,
  type PermissionContext,
  type PermissionDeniedError,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "./permission-registry.js"
import {
  disabledExecutionInspectorCollector,
  ExecutionEvent,
  type ExecutionInspectorCollectorApi
} from "./inspector-events.js"
import {
  ResourceRegistry,
  type ManagedResourceHandle,
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
  readonly inputSchema: Schema.Decoder<In, never>
  readonly outputSchema: Schema.Decoder<Out, never>
  readonly context: PermissionContext
  readonly capabilities?: readonly NormalizedCapability[]
}

export interface WorkerHandle<In, Out> {
  readonly resource: ManagedResourceHandle<"worker", "running">
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
  readonly inspector?: ExecutionInspectorCollectorApi
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
    const inspector = options.inspector ?? disabledExecutionInspectorCollector
    const now = options.now ?? Date.now
    const workerBudgetScope = yield* Scope.make()
    const workerBudgets = yield* RcMap.make({
      lookup: (_ownerScope: string) => Semaphore.make(budgets.maxConcurrent)
    }).pipe(Scope.provide(workerBudgetScope))
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
          const startedAt = safeWorkerTimestamp(now)
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "worker",
              status: "start",
              operation: "Worker.spawn",
              script: input.script,
              ownerScope: input.ownerScope,
              timestamp: startedAt
            })
          )

          const { runtime, resource } = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const workerScope = yield* Scope.make()
              yield* holdScopedExecutionPermit({
                budgets: workerBudgets,
                scope: workerScope,
                ownerScope: input.ownerScope,
                maxConcurrent: budgets.maxConcurrent,
                onBusy: (ownerScope, maxConcurrent) =>
                  new WorkerResourceBusyError({
                    operation: "Worker.spawn",
                    ownerScope,
                    maxConcurrent
                  })
              }).pipe(Effect.tapError(() => Scope.close(workerScope, Exit.void)))
              const runtime = yield* adapter
                .spawn({
                  script: input.script,
                  ownerScope: input.ownerScope,
                  capabilities: options.capabilities ?? [],
                  messageBufferSize: budgets.messageBufferSize,
                  gracefulShutdownMs
                })
                .pipe(Effect.tapError(() => Scope.close(workerScope, Exit.void)))
              let registeredResourceId: string | undefined
              const disposalOrigin = yield* Ref.make<WorkerDisposalOrigin>("running")
              const resource = yield* registry
                .register({
                  kind: "worker",
                  ownerScope: input.ownerScope,
                  state: "running",
                  dispose: disposeWorkerRuntime(
                    runtime,
                    workerScope,
                    workers,
                    () => registeredResourceId,
                    disposalOrigin
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
                  startedAt,
                  capabilities: input.capabilities
                })
              )
              yield* inspector.publish(
                new ExecutionEvent({
                  kind: "worker",
                  status: "success",
                  operation: "Worker.spawn",
                  script: input.script,
                  ownerScope: input.ownerScope,
                  resourceId: resource.id,
                  timestamp: startedAt
                })
              )
              yield* observeWorkerExit(
                runtime.exit,
                resource,
                input.script,
                workerScope,
                disposalOrigin,
                inspector,
                now
              ).pipe(Scope.provide(workerScope))

              return { runtime, resource }
            })
          )

          return makeHandle(runtime, resource, input.script, inputSchema, outputSchema, registry)
        }).pipe(
          Effect.tapError((error) =>
            inspector.publish(
              new ExecutionEvent({
                kind: "worker",
                status: "failure",
                operation: "Worker.spawn",
                script: options.script,
                ownerScope: options.ownerScope,
                errorTag: error._tag,
                message: error.message,
                timestamp: safeWorkerTimestamp(now)
              })
            )
          ),
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
  resource: ManagedResourceHandle<"worker", "running">,
  script: string,
  inputSchema: Schema.Decoder<In, never>,
  outputSchema: Schema.Decoder<Out, never>,
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
  resource: ManagedResourceHandle<"worker", "running">,
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
  resource: ManagedResourceHandle<"worker", "running">,
  script: string,
  workerScope: Scope.Closeable,
  disposalOrigin: Ref.Ref<WorkerDisposalOrigin>,
  inspector: ExecutionInspectorCollectorApi,
  now: () => number
): Effect.Effect<void, never, Scope.Scope> =>
  exit.pipe(
    Effect.exit,
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        const origin = yield* claimWorkerObserverDisposal(disposalOrigin)
        if (origin !== "registry") {
          yield* resource.dispose()
        }
        if (Exit.isFailure(result)) {
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "worker",
              status: "failure",
              operation: "Worker.exit",
              script,
              resourceId: resource.id,
              message: formatWorkerExitFailure(result),
              timestamp: safeWorkerTimestamp(now)
            })
          )
          yield* Effect.logWarning("Worker.exit observer failed", {
            script,
            reason: formatWorkerExitFailure(result)
          })
        } else {
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "worker",
              status: "cleanup",
              operation: "Worker.exit",
              script,
              resourceId: resource.id,
              timestamp: safeWorkerTimestamp(now)
            })
          )
        }
        if (origin !== "registry") {
          yield* Scope.close(workerScope, Exit.void)
        }
      })
    ),
    Effect.forkScoped({ startImmediately: true }),
    Effect.asVoid
  )

const disposeWorkerRuntime = (
  runtime: WorkerRuntime,
  workerScope: Scope.Closeable,
  workers: Ref.Ref<ReadonlyMap<string, StoredWorker>>,
  resourceId: () => string | undefined,
  disposalOrigin: Ref.Ref<WorkerDisposalOrigin>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const origin = yield* claimWorkerRegistryDisposal(disposalOrigin)
    if (origin !== "observer") {
      yield* runtime.shutdown
    }
    yield* removeWorker(workers, resourceId)
    if (origin !== "observer") {
      yield* Scope.close(workerScope, Exit.void)
    }
  })

type WorkerDisposalOrigin = "running" | "observer" | "registry"

const claimWorkerObserverDisposal = (
  origin: Ref.Ref<WorkerDisposalOrigin>
): Effect.Effect<WorkerDisposalOrigin, never, never> =>
  Ref.modify(origin, (current) =>
    current === "running" ? (["observer", "observer"] as const) : ([current, current] as const)
  )

const claimWorkerRegistryDisposal = (
  origin: Ref.Ref<WorkerDisposalOrigin>
): Effect.Effect<WorkerDisposalOrigin, never, never> =>
  Ref.modify(origin, (current) =>
    current === "running" ? (["registry", "registry"] as const) : ([current, current] as const)
  )

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

const safeWorkerTimestamp = (now: () => number): number => {
  const timestamp = now()
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : Date.now()
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

const validateChannelSchema = <A>(
  schema: Schema.Decoder<A, never>,
  field: "inputSchema" | "outputSchema",
  operation: string
): Effect.Effect<Schema.Decoder<A, never>, WorkerInvalidArgumentError, never> =>
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

const isEffectSchema = <A>(schema: unknown): schema is Schema.Decoder<A, never> =>
  (typeof schema === "object" || typeof schema === "function") && schema !== null && "ast" in schema

const decodeInput = <In>(
  input: unknown,
  schema: Schema.Decoder<In, never>,
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
  )

const decodeOutput = <Out>(
  input: unknown,
  schema: Schema.Decoder<Out, never>,
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
  )

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

export const BunWorkerAdapter: WorkerAdapter = Object.freeze({
  spawn: (input: WorkerAdapterSpawnInput) =>
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<unknown, WorkerError | Cause.Done>(input.messageBufferSize)
      const exit = yield* Deferred.make<void, WorkerError>()
      const started = yield* Deferred.make<void, WorkerError>()
      const workerScope = yield* Scope.make()
      const shutdownRequested = { current: false }
      const platform = makeBunWorkerPlatform(input, queue, exit, shutdownRequested)
      const effectWorker = yield* platform.spawn(0).pipe(
        Effect.provideService(EffectWorker.Spawner, () => new globalThis.Worker(input.script)),
        Effect.mapError((error) =>
          makeWorkerUnsupportedError(input, "Effect worker platform failed", error)
        )
      )
      const runWorker = effectWorker.run(
        (message) => Queue.offer(queue, message).pipe(Effect.asVoid),
        { onSpawn: Deferred.succeed(started, undefined) }
      )
      yield* runWorker.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void
          }
          const error = makeWorkerUnsupportedError(
            input,
            "Effect worker runtime failed",
            Cause.squash(cause)
          )
          Queue.failCauseUnsafe(queue, Cause.fail(error))
          Deferred.doneUnsafe(exit, Effect.fail(error))
          return Deferred.fail(started, error).pipe(Effect.asVoid)
        }),
        Effect.forkScoped({ startImmediately: true }),
        Scope.provide(workerScope)
      )
      yield* Deferred.await(started).pipe(
        Effect.tapError(() => Scope.close(workerScope, Exit.void))
      )

      return {
        send: (message: unknown) =>
          effectWorker
            .send(message)
            .pipe(Effect.mapError((error) => mapEffectWorkerSendError(input, error))),
        messages: Stream.fromQueue(queue),
        exit: Deferred.await(exit),
        shutdown: Scope.close(workerScope, Exit.void).pipe(Effect.asVoid)
      } satisfies WorkerRuntime
    })
})

interface BunWorkerPort {
  readonly worker: globalThis.Worker
  readonly postMessage: (message: unknown) => void
}

const makeBunWorkerPlatform = (
  input: WorkerAdapterSpawnInput,
  queue: Queue.Queue<unknown, WorkerError | Cause.Done>,
  exit: Deferred.Deferred<void, WorkerError>,
  shutdownRequested: { current: boolean }
): EffectWorker.WorkerPlatform["Service"] =>
  EffectWorker.makePlatform<globalThis.Worker>()({
    setup: ({ worker }) =>
      Effect.succeed({
        worker,
        postMessage: (message: unknown) => {
          const payload = isEffectWorkerOutboundMessage(message) ? message[1] : message
          worker.postMessage(payload)
        }
      } satisfies BunWorkerPort),
    listen: ({ deferred, emit, port, scope }) =>
      Effect.gen(function* () {
        const onMessage = (event: MessageEvent): void => {
          emit([1, event.data])
        }
        const onError = (event: ErrorEvent): void => {
          if (shutdownRequested.current) {
            endBunWorkerRuntime(queue, exit, deferred)
            return
          }
          const error = new WorkerCrashedError({
            operation: "Worker.messages",
            script: input.script,
            resourceId: Option.none(),
            exitCode: Option.none(),
            signal: Option.none(),
            lastError: Option.some(event.error ?? event.message)
          })
          failBunWorkerRuntime(queue, exit, deferred, error, event.error ?? event.message)
        }
        const onMessageError = (event: MessageEvent): void => {
          if (shutdownRequested.current) {
            endBunWorkerRuntime(queue, exit, deferred)
            return
          }
          const error = new WorkerChannelError({
            operation: "Worker.messages",
            field: "transport",
            script: input.script,
            message: "worker message could not be deserialized",
            cause: Option.some(event.data)
          })
          failBunWorkerRuntime(queue, exit, deferred, error, event.data)
        }
        const onClose = (event: Event): void => {
          const exitCode = "code" in event && typeof event.code === "number" ? event.code : 0
          if (exitCode === 0 || shutdownRequested.current) {
            endBunWorkerRuntime(queue, exit, deferred)
            return
          }
          const error = new WorkerCrashedError({
            operation: "Worker.messages",
            script: input.script,
            resourceId: Option.none(),
            exitCode: Option.some(exitCode),
            signal: Option.none(),
            lastError: Option.none()
          })
          failBunWorkerRuntime(queue, exit, deferred, error, undefined)
        }

        yield* attachWorkerListeners(input, port.worker, {
          onMessage,
          onError,
          onMessageError,
          onClose
        }).pipe(Scope.provide(scope))
        emit([0])

        yield* Scope.addFinalizer(
          scope,
          shutdownBunWorker(input, port.worker, queue, exit, shutdownRequested)
        )
      })
  })

const isEffectWorkerOutboundMessage = (message: unknown): message is readonly [0, unknown] =>
  Array.isArray(message) && message.length === 2 && message[0] === 0

const failBunWorkerRuntime = (
  queue: Queue.Queue<unknown, WorkerError | Cause.Done>,
  exit: Deferred.Deferred<void, WorkerError>,
  deferred: Deferred.Deferred<never, EffectWorkerError>,
  error: WorkerError,
  cause: unknown
): void => {
  Queue.failCauseUnsafe(queue, Cause.fail(error))
  Deferred.doneUnsafe(exit, Effect.fail(error))
  Deferred.doneUnsafe(
    deferred,
    Effect.fail(
      new EffectWorkerError({
        reason: new WorkerReceiveError({
          message: `${error._tag}: ${error.operation}`,
          cause
        })
      })
    )
  )
}

const endBunWorkerRuntime = (
  queue: Queue.Queue<unknown, WorkerError | Cause.Done>,
  exit: Deferred.Deferred<void, WorkerError>,
  deferred: Deferred.Deferred<never, EffectWorkerError>
): void => {
  Queue.endUnsafe(queue)
  Deferred.doneUnsafe(exit, Effect.void)
  Deferred.doneUnsafe(deferred, Effect.interrupt)
}

const shutdownBunWorker = (
  input: WorkerAdapterSpawnInput,
  worker: globalThis.Worker,
  queue: Queue.Queue<unknown, WorkerError | Cause.Done>,
  exit: Deferred.Deferred<void, WorkerError>,
  shutdownRequested: { current: boolean }
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const warnShutdownFailure = (phase: string, cause: unknown) =>
      Effect.logWarning("Worker.shutdown failed", {
        script: input.script,
        phase,
        reason: String(cause)
      })

    shutdownRequested.current = true
    yield* Effect.try({
      try: () => worker.postMessage({ _tag: "Shutdown" }),
      catch: (cause) => cause
    }).pipe(Effect.catch((cause) => warnShutdownFailure("postMessage", cause)))
    const gracefulExit = yield* Effect.timeoutOption(
      Effect.exit(Deferred.await(exit)),
      `${input.gracefulShutdownMs} millis`
    )
    if (Option.isNone(gracefulExit)) {
      yield* Effect.try({
        try: () => worker.terminate(),
        catch: (cause) => cause
      }).pipe(Effect.catch((cause) => warnShutdownFailure("terminate", cause)))
    }
    yield* Queue.shutdown(queue).pipe(
      Effect.catchCause((cause) => warnShutdownFailure("queueShutdown", cause))
    )
  })

interface WorkerEventHandlers {
  readonly onMessage: (event: MessageEvent) => void
  readonly onError: (event: ErrorEvent) => void
  readonly onMessageError: (event: MessageEvent) => void
  readonly onClose: (event: Event) => void
}

const attachWorkerListeners = (
  input: WorkerAdapterSpawnInput,
  worker: globalThis.Worker,
  handlers: WorkerEventHandlers
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      worker.addEventListener("message", handlers.onMessage)
      worker.addEventListener("error", handlers.onError)
      worker.addEventListener("messageerror", handlers.onMessageError)
      worker.addEventListener("close", handlers.onClose)
    }),
    () => cleanupWorkerListeners(input, worker, handlers)
  ).pipe(
    Effect.catchDefect((cause) =>
      Effect.logWarning("Worker.listen failed", {
        script: input.script,
        phase: "addListeners",
        reason: String(cause)
      })
    )
  )

const cleanupWorkerListeners = (
  input: WorkerAdapterSpawnInput,
  worker: globalThis.Worker,
  handlers: WorkerEventHandlers
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    worker.removeEventListener("message", handlers.onMessage)
    worker.removeEventListener("error", handlers.onError)
    worker.removeEventListener("messageerror", handlers.onMessageError)
    worker.removeEventListener("close", handlers.onClose)
  }).pipe(
    Effect.catchDefect((cause) =>
      Effect.logWarning("Worker.shutdown failed", {
        script: input.script,
        phase: "removeListeners",
        reason: String(cause)
      })
    )
  )

const mapEffectWorkerSendError = (
  input: WorkerAdapterSpawnInput,
  error: EffectWorkerError
): WorkerChannelError =>
  new WorkerChannelError({
    operation: "Worker.send",
    field: "transport",
    script: input.script,
    message: error.message,
    cause: Option.some(error)
  })

const makeWorkerUnsupportedError = (
  input: WorkerAdapterSpawnInput,
  reason: string,
  cause: unknown
): WorkerUnsupportedError =>
  new WorkerUnsupportedError({
    operation: "Worker.spawn",
    script: input.script,
    reason,
    cause: Option.some(cause)
  })
