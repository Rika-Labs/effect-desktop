import { Cause, Context, Data, Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect"

import {
  PermissionRegistry,
  type NormalizedCapability,
  type PermissionContext,
  type PermissionDeniedError,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "./permission-registry.js"
import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString
const StrictParseOptions = { onExcessProperty: "error" } as const

export class WorkerSpawnInput extends Schema.Class<WorkerSpawnInput>("WorkerSpawnInput")({
  script: NonEmptyString,
  ownerScope: NonEmptyString,
  capabilities: Schema.Array(Schema.Unknown)
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
  readonly shutdown: Effect.Effect<void, never, never>
}

export interface WorkerOptions {
  readonly adapter?: WorkerAdapter
  readonly budgets?: WorkerBudgetPolicy
  readonly gracefulShutdownMs?: number
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
    const workerBudgets = yield* Ref.make(new Map<string, number>())

    return Object.freeze({
      spawn: <In, Out>(options: WorkerSpawnOptions<In, Out>) =>
        Effect.gen(function* () {
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
              const resource = yield* registry.register({
                kind: "worker",
                ownerScope: input.ownerScope,
                state: "running",
                dispose: runtime.shutdown.pipe(
                  Effect.andThen(releaseWorkerBudget(workerBudgets, input.ownerScope))
                )
              })

              return { runtime, resource }
            })
          )

          return makeHandle(
            runtime,
            resource,
            input.script,
            options.inputSchema,
            options.outputSchema
          )
        }).pipe(
          Effect.withSpan("Worker.spawn", {
            attributes: {
              script: options.script,
              ownerScope: options.ownerScope,
              capabilityCount: options.capabilities?.length ?? 0
            }
          })
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
  outputSchema: Schema.Schema<Out>
): WorkerHandle<In, Out> => {
  const messages = runtime.messages.pipe(
    Stream.mapEffect((message) => decodeOutput(message, outputSchema, script))
  )

  return Object.freeze({
    resource,
    send: (message: In) =>
      Effect.gen(function* () {
        const decoded = yield* decodeInput(message, inputSchema, script)
        yield* runtime.send(decoded)
      }).pipe(Effect.withSpan("Worker.send", { attributes: { script, resourceId: resource.id } })),
    messages,
    close: resource.dispose()
  })
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
        Effect.runFork(
          Queue.fail(
            queue,
            new WorkerCrashedError({
              operation: "Worker.messages",
              script: input.script,
              resourceId,
              exitCode: Option.none(),
              signal: Option.none(),
              lastError: Option.some(event.error ?? event.message)
            })
          )
        )
      }
      const onMessageError = (event: MessageEvent): void => {
        Effect.runFork(
          Queue.fail(
            queue,
            new WorkerChannelError({
              operation: "Worker.messages",
              field: "transport",
              script: input.script,
              message: "worker message could not be deserialized",
              cause: Option.some(event.data)
            })
          )
        )
      }
      const onClose = (event: Event): void => {
        const exitCode = "code" in event && typeof event.code === "number" ? event.code : 0
        if (exitCode === 0) {
          Effect.runFork(Queue.end(queue))
          return
        }
        Effect.runFork(
          Queue.fail(
            queue,
            new WorkerCrashedError({
              operation: "Worker.messages",
              script: input.script,
              resourceId,
              exitCode: Option.some(exitCode),
              signal: Option.none(),
              lastError: Option.none()
            })
          )
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
        shutdown: Effect.gen(function* () {
          worker.removeEventListener("message", onMessage)
          worker.removeEventListener("error", onError)
          worker.removeEventListener("messageerror", onMessageError)
          worker.removeEventListener("close", onClose)
          yield* Effect.try({
            try: () => worker.postMessage({ _tag: "Shutdown" }),
            catch: (cause) => cause
          }).pipe(Effect.catchCause(() => Effect.void))
          yield* Effect.sleep(`${input.gracefulShutdownMs} millis`)
          yield* Effect.try({
            try: () => worker.terminate(),
            catch: (cause) => cause
          }).pipe(Effect.catchCause(() => Effect.void))
          yield* Queue.shutdown(queue)
        }).pipe(Effect.catchCause(() => Effect.void))
      } satisfies WorkerRuntime
    })
})
