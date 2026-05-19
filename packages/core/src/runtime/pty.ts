import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolStaleHandleError,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type HostProtocolErrorTag
} from "@effect-desktop/bridge"
import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Filter,
  Layer,
  Option,
  Pull,
  RcMap,
  Ref,
  Schema,
  Semaphore,
  Scope,
  Stream
} from "effect"

import {
  ResourceRegistry,
  type ManagedResourceHandle,
  type ResourceRegistryApi,
  type StaleHandle
} from "./resources.js"
import {
  disabledExecutionInspectorCollector,
  ExecutionEvent,
  type ExecutionInspectorCollectorApi
} from "./inspector-events.js"
import { ResourceOwner, type ResourceOwnerApi } from "./resource-owner.js"
import { holdScopedExecutionPermit } from "./execution-budgets.js"

const NonEmptyString = Schema.NonEmptyString
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NulByte = String.fromCharCode(0)
const UnitSeparatorByte = String.fromCharCode(31)
const DeleteByte = String.fromCharCode(127)
const NoControlTextPattern = new RegExp(`^[^${NulByte}-${UnitSeparatorByte}${DeleteByte}]+$`, "u")
const NoNulTextPattern = new RegExp(`^[^${NulByte}]+$`, "u")
const OptionalNoNulTextPattern = new RegExp(`^[^${NulByte}]*$`, "u")
const PtySignalString = Schema.NonEmptyString.check(Schema.isPattern(NoControlTextPattern))
const EnvironmentVariableName = Schema.NonEmptyString.check(Schema.isPattern(NoNulTextPattern))
const EnvironmentVariableValue = Schema.String.check(Schema.isPattern(OptionalNoNulTextPattern))

export class PtyOpenInput extends Schema.Class<PtyOpenInput>("PtyOpenInput")({
  command: NonEmptyString,
  args: Schema.Array(Schema.String),
  ownerScope: NonEmptyString,
  rows: PositiveInt,
  cols: PositiveInt,
  cwd: Schema.optionalKey(NonEmptyString),
  env: Schema.optionalKey(Schema.Record(EnvironmentVariableName, EnvironmentVariableValue))
}) {}

export class PtyResizeInput extends Schema.Class<PtyResizeInput>("PtyResizeInput")({
  rows: PositiveInt,
  cols: PositiveInt
}) {}

export const PtySignalInput = Schema.Union([
  PtySignalString,
  Schema.Int.check(Schema.isGreaterThan(0))
])
export type PtySignalInput = typeof PtySignalInput.Type

export class PtyExitStatus extends Schema.Class<PtyExitStatus>("PtyExitStatus")({
  code: Schema.Int,
  signal: Schema.optionalKey(Schema.String)
}) {}

export type PtyError = HostProtocolError

export interface PtyOpenOptions {
  readonly argv: readonly [string, ...string[]]
  readonly rows: number
  readonly cols: number
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

export interface PtyHandle {
  readonly resource: ManagedResourceHandle<"pty", "running">
  readonly pid: Option.Option<number>
  readonly output: Stream.Stream<Uint8Array, PtyError, never>
  readonly outputMetrics: Effect.Effect<PtyOutputMetrics, never, never>
  readonly onExit: Effect.Effect<PtyExitStatus, PtyError, never>
  readonly write: (chunk: unknown) => Effect.Effect<void, PtyError, never>
  readonly resize: (size: PtyResizeInput) => Effect.Effect<void, PtyError, never>
  readonly kill: (signal?: unknown) => Effect.Effect<void, PtyError, never>
}

export interface PtyApi {
  readonly open: (options: PtyOpenOptions) => Effect.Effect<PtyHandle, PtyError, never>
}

export interface PtyAdapter {
  readonly open: (input: PtyOpenInput) => PtyChild
}

export interface PtyChild {
  readonly pid: Option.Option<number>
  readonly output: ReadableStream<Uint8Array>
  readonly exited: Promise<PtyExitStatus>
  readonly write: (chunk: Uint8Array) => Promise<void>
  readonly resize: (size: PtyResizeInput) => Promise<void>
  readonly isRunning: () => boolean
  readonly terminateTree: () => Promise<void>
  readonly forceKillTree: () => Promise<void>
  readonly kill: (signal?: PtySignalInput) => Promise<void>
}

export interface PtyOptions {
  readonly adapter: PtyAdapter
  readonly budgets?: PtyBudgetPolicy
  readonly inspector?: ExecutionInspectorCollectorApi
  readonly gracefulShutdownMs?: number
  readonly permissions?: PtyPermissionPolicy
  readonly now?: () => number
}

export interface PtyBudgetPolicy {
  readonly maxConcurrent?: number
  readonly outputBufferBytes?: number
  readonly outputCoalesceBytes?: number
  readonly outputCoalesceMs?: number
  readonly outputOverflow?: unknown
}

export type PtyOutputOverflow = "block" | "dropNewest" | "dropOldest" | "error"

interface ResolvedPtyBudgetPolicy {
  readonly maxConcurrent: number
  readonly outputBufferBytes: number
  readonly outputCoalesceBytes: number
  readonly outputCoalesceMs: number
  readonly outputOverflow: PtyOutputOverflow
}

export interface PtyOutputMetrics {
  readonly coalescedFrames: number
  readonly coalescingFactor: number
  readonly droppedBytes: number
  readonly droppedFrames: number
  readonly emittedBytes: number
  readonly emittedFrames: number
  readonly inputBytes: number
  readonly inputFrames: number
  readonly outputBufferBytes: number
  readonly outputCoalesceBytes: number
  readonly outputCoalesceMs: number
  readonly outputOverflow: PtyOutputOverflow
  readonly queueBytes: number
  readonly queueDepth: number
}

export interface PtyPermissionPolicy {
  readonly spawn?: readonly string[]
}

const DEFAULT_PTY_BUDGETS: ResolvedPtyBudgetPolicy = Object.freeze({
  maxConcurrent: 16,
  outputBufferBytes: 262_144,
  outputCoalesceBytes: 65_536,
  outputCoalesceMs: 4,
  outputOverflow: "dropOldest"
})
const PTY_OUTPUT_OVERFLOWS = new Set<string>(["block", "dropNewest", "dropOldest", "error"])
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000
const EMPTY_PTY_PERMISSIONS: PtyPermissionPolicy = Object.freeze({})

export const makePty = (
  registry: ResourceRegistryApi,
  owner: ResourceOwnerApi,
  options: PtyOptions
): Effect.Effect<PtyApi, HostProtocolInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const adapter = options.adapter
    const rawBudgets: Required<PtyBudgetPolicy> = { ...DEFAULT_PTY_BUDGETS, ...options.budgets }
    const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS
    const inspector = options.inspector ?? disabledExecutionInspectorCollector
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())
    if (!Number.isFinite(gracefulShutdownMs) || gracefulShutdownMs <= 0) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "gracefulShutdownMs",
          "must be a finite positive number",
          "PTY.make"
        )
      )
    }
    const permissions = options.permissions ?? EMPTY_PTY_PERMISSIONS
    const ptyBudgetScope = yield* Scope.make()
    const ptyBudgets = yield* RcMap.make({
      lookup: (_ownerScope: string) => Semaphore.make(rawBudgets.maxConcurrent)
    }).pipe(Scope.provide(ptyBudgetScope))

    const api: PtyApi = Object.freeze({
      open: (options: PtyOpenOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeOpenInput(
            {
              command: options.argv[0],
              args: options.argv.slice(1),
              ownerScope: owner.scopeId,
              rows: options.rows,
              cols: options.cols,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options.env === undefined ? {} : { env: options.env })
            },
            "PTY.open"
          )
          yield* authorizePtyOpen(permissions, input)
          const budgets = yield* validatePtyBudgets(rawBudgets, "PTY.open")
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "pty",
              status: "start",
              operation: "PTY.open",
              command: input.command,
              ownerScope: input.ownerScope,
              timestamp: now()
            })
          )
          const { child, disposalOrigin, ptyScope, resource } = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const ptyScope = yield* Scope.make()
              yield* holdPtyBudgetPermit(
                ptyBudgets,
                ptyScope,
                input.ownerScope,
                budgets.maxConcurrent
              ).pipe(Effect.tapError(() => Scope.close(ptyScope, Exit.void)))
              const child = yield* Effect.try({
                try: () => adapter.open(input),
                catch: (error) => mapPtyError(error, input.command, "PTY.open")
              }).pipe(Effect.tapError(() => Scope.close(ptyScope, Exit.void)))
              const disposalOrigin = yield* Ref.make<PtyDisposalOrigin>("running")
              const resource = yield* registry
                .register({
                  kind: "pty",
                  ownerScope: input.ownerScope,
                  state: "running",
                  dispose: disposeChild(
                    child,
                    ptyScope,
                    input.command,
                    gracefulShutdownMs,
                    disposalOrigin
                  )
                })
                .pipe(Effect.orDie)
              yield* inspector.publish(
                new ExecutionEvent({
                  kind: "pty",
                  status: "success",
                  operation: "PTY.open",
                  command: input.command,
                  ownerScope: input.ownerScope,
                  resourceId: resource.id,
                  ...(Option.isSome(child.pid) ? { pid: child.pid.value } : {}),
                  timestamp: now()
                })
              )

              return { child, disposalOrigin, ptyScope, resource }
            })
          )

          return yield* makeHandle(
            child,
            resource,
            ptyScope,
            disposalOrigin,
            input.command,
            budgets,
            registry,
            inspector,
            now
          )
        }).pipe(
          Effect.tapError((error) =>
            inspector.publish(
              new ExecutionEvent({
                kind: "pty",
                status: "failure",
                operation: "PTY.open",
                command: options.argv[0],
                ownerScope: owner.scopeId,
                errorTag: error._tag,
                message: error.message,
                timestamp: now()
              })
            )
          ),
          Effect.withSpan("PTY.open", {
            attributes: {
              command: options.argv[0],
              argc: options.argv.length,
              ownerScope: owner.scopeId,
              rows: options.rows,
              cols: options.cols
            }
          })
        )
    })
    return api
  })

export class PTY extends Context.Service<PTY, PtyApi>()("@effect-desktop/core/runtime/pty") {}

export const PtyLayer = (
  options: PtyOptions
): Layer.Layer<PTY, HostProtocolInvalidArgumentError, ResourceOwner | ResourceRegistry> =>
  Layer.effect(
    PTY,
    Effect.gen(function* () {
      const owner = yield* ResourceOwner
      const registry = yield* ResourceRegistry
      return yield* makePty(registry, owner, options)
    })
  )

const makeHandle = (
  child: PtyChild,
  resource: ManagedResourceHandle<"pty", "running">,
  ptyScope: Scope.Closeable,
  disposalOrigin: Ref.Ref<PtyDisposalOrigin>,
  command: string,
  budgets: ResolvedPtyBudgetPolicy,
  registry: ResourceRegistryApi,
  inspector: ExecutionInspectorCollectorApi,
  now: () => number
): Effect.Effect<PtyHandle, never, never> =>
  Effect.gen(function* () {
    const outputMetrics = yield* makeOutputMetrics(budgets)
    const output = makeOutputStream(
      Stream.fromReadableStream({
        evaluate: () => child.output,
        onError: (error) => mapPtyError(error, command, "PTY.output"),
        releaseLockOnEnd: true
      }),
      command,
      budgets,
      outputMetrics,
      now
    )
    const exitStatus = Effect.tryPromise({
      try: () => child.exited,
      catch: (error) => mapPtyError(error, command, "PTY.onExit")
    })
    yield* observeChildExit(
      exitStatus,
      resource,
      command,
      ptyScope,
      disposalOrigin,
      inspector,
      now
    ).pipe(Scope.provide(ptyScope))
    const onExit = exitStatus.pipe(Effect.tap(() => resource.dispose()))

    return Object.freeze({
      resource,
      pid: child.pid,
      output,
      outputMetrics: Ref.get(outputMetrics),
      onExit,
      write: (chunk: unknown) =>
        Effect.gen(function* () {
          const bytes = yield* decodeWriteInput(chunk, "PTY.write")
          yield* assertPtyHandleFresh(registry, resource, "PTY.write")
          yield* Effect.tryPromise({
            try: () => child.write(bytes),
            catch: (error) => mapPtyError(error, command, "PTY.write")
          })
        }),
      resize: (size: PtyResizeInput) =>
        Effect.gen(function* () {
          const decodedSize = yield* decodeResizeInput(size, "PTY.resize")
          yield* assertPtyHandleFresh(registry, resource, "PTY.resize")
          yield* Effect.tryPromise({
            try: () => child.resize(decodedSize),
            catch: (error) => mapPtyError(error, command, "PTY.resize")
          })
        }),
      kill: Effect.fn("PTY.kill", { attributes: { command } })(function* (signal?: unknown) {
        const decodedSignal =
          signal === undefined ? undefined : yield* decodeSignalInput(signal, "PTY.kill")
        yield* assertPtyHandleFresh(registry, resource, "PTY.kill")
        yield* Effect.tryPromise({
          try: () => child.kill(decodedSignal),
          catch: (error) => mapPtyError(error, command, "PTY.kill")
        })
        yield* inspector.publish(
          new ExecutionEvent({
            kind: "pty",
            status: "interruption",
            operation: "PTY.kill",
            command,
            resourceId: resource.id,
            signal: decodedSignal === undefined ? "default" : String(decodedSignal),
            timestamp: now()
          })
        )
      })
    })
  })

interface OutputFrame {
  readonly bytes: Uint8Array
  readonly coalesced: boolean
}

const makeOutputStream = (
  source: Stream.Stream<Uint8Array, PtyError, never>,
  command: string,
  policy: ResolvedPtyBudgetPolicy,
  metrics: Ref.Ref<PtyOutputMetrics>,
  now: () => number
): Stream.Stream<Uint8Array, PtyError, never> =>
  source.pipe(
    Stream.mapEffect((chunk) => recordInputChunk(metrics, chunk).pipe(Effect.as(chunk))),
    coalesceOutputFrames(policy, now),
    Stream.mapError((error) => mapPtyError(error, command, "PTY.output")),
    Stream.mapEffect((frame) => applyOutputPolicy(command, policy, metrics, frame)),
    Stream.filterMap(Filter.fromPredicateOption((frame) => frame)),
    Stream.buffer({
      capacity: outputQueueCapacity(policy),
      strategy: outputBufferStrategy(policy)
    }),
    Stream.map((frame) => frame.bytes)
  )

const coalesceOutputFrames =
  (
    policy: ResolvedPtyBudgetPolicy,
    now: () => number
  ): ((
    source: Stream.Stream<Uint8Array, PtyError, never>
  ) => Stream.Stream<OutputFrame, PtyError, never>) =>
  (source) =>
    Stream.transformPull(source, (pull) =>
      Effect.sync(() => {
        const coalescer = makeOutputCoalescer(policy, now)
        let pending: OutputFrame[] = []
        let sourceDone = false

        const pullFrame: Pull.Pull<readonly [OutputFrame, ...OutputFrame[]], PtyError> =
          Effect.suspend(() => {
            const nextPending = takeNonEmptyOutputFrames(pending)
            if (nextPending !== undefined) {
              pending = pending.slice(nextPending.length)
              return Effect.succeed(nextPending)
            }

            if (sourceDone) {
              const finalFrame = coalescer.flush()
              if (finalFrame.bytes.byteLength > 0) {
                return Effect.succeed([finalFrame])
              }
              return Cause.done()
            }

            const nextEvent = coalescer.isEmpty()
              ? readOutputChunks(pull)
              : Effect.raceFirst(
                  readOutputChunks(pull),
                  Effect.sleep(`${coalescer.flushDelayMs()} millis`).pipe(
                    Effect.as({ _tag: "flush" } as const)
                  )
                )

            return nextEvent.pipe(
              Effect.flatMap((event) => {
                if (event._tag === "done") {
                  sourceDone = true
                  return pullFrame
                }
                if (event._tag === "flush") {
                  const frame = coalescer.flushTimer()
                  if (frame.bytes.byteLength > 0) {
                    return Effect.succeed([frame])
                  }
                  return pullFrame
                }

                const frames: OutputFrame[] = []
                for (const chunk of event.chunks) {
                  frames.push(...coalescer.push(chunk))
                }
                const nextFrames = takeNonEmptyOutputFrames(frames)
                if (nextFrames !== undefined) {
                  pending = frames.slice(nextFrames.length)
                  return Effect.succeed(nextFrames)
                }
                return pullFrame
              })
            )
          })

        return pullFrame
      })
    )

type OutputPullEvent =
  | { readonly _tag: "chunks"; readonly chunks: readonly Uint8Array[] }
  | { readonly _tag: "done" }
  | { readonly _tag: "flush" }

const readOutputChunks = (
  pull: Pull.Pull<readonly Uint8Array[], PtyError>
): Effect.Effect<OutputPullEvent, PtyError, never> =>
  Pull.matchEffect(pull, {
    onDone: () => Effect.succeed({ _tag: "done" } as const),
    onFailure: (cause) => Effect.failCause(cause),
    onSuccess: (chunks) => Effect.succeed({ _tag: "chunks", chunks } as const)
  })

const takeNonEmptyOutputFrames = (
  frames: readonly OutputFrame[]
): readonly [OutputFrame, ...OutputFrame[]] | undefined => {
  const [first, ...rest] = frames
  return first === undefined ? undefined : [first, ...rest]
}

const applyOutputPolicy = (
  command: string,
  policy: ResolvedPtyBudgetPolicy,
  metrics: Ref.Ref<PtyOutputMetrics>,
  frame: OutputFrame
): Effect.Effect<Option.Option<OutputFrame>, PtyError, never> =>
  Effect.gen(function* () {
    if (frame.bytes.byteLength > policy.outputBufferBytes) {
      yield* recordDroppedFrame(metrics, frame)
      if (policy.outputOverflow === "error") {
        return yield* Effect.fail(makeBackpressureOverflow(command, policy.outputBufferBytes, 1))
      }
      return Option.none<OutputFrame>()
    }

    yield* recordEmittedFrame(metrics, frame)
    return Option.some(frame)
  })

const outputBufferStrategy = (
  policy: ResolvedPtyBudgetPolicy
): "dropping" | "sliding" | "suspend" => {
  if (policy.outputOverflow === "dropNewest" || policy.outputOverflow === "error") {
    return "dropping"
  }
  if (policy.outputOverflow === "dropOldest") {
    return "sliding"
  }
  return "suspend"
}

const makeOutputMetrics = (
  policy: ResolvedPtyBudgetPolicy
): Effect.Effect<Ref.Ref<PtyOutputMetrics>, never, never> =>
  Ref.make({
    coalescedFrames: 0,
    coalescingFactor: 1,
    droppedBytes: 0,
    droppedFrames: 0,
    emittedBytes: 0,
    emittedFrames: 0,
    inputBytes: 0,
    inputFrames: 0,
    outputBufferBytes: policy.outputBufferBytes,
    outputCoalesceBytes: policy.outputCoalesceBytes,
    outputCoalesceMs: policy.outputCoalesceMs,
    outputOverflow: policy.outputOverflow,
    queueBytes: 0,
    queueDepth: 0
  })

const recordInputChunk = (
  metrics: Ref.Ref<PtyOutputMetrics>,
  chunk: Uint8Array
): Effect.Effect<void, never, never> =>
  Ref.update(metrics, (current) =>
    updateCoalescingFactor({
      ...current,
      inputBytes: current.inputBytes + chunk.byteLength,
      inputFrames: current.inputFrames + 1
    })
  )

const recordEmittedFrame = (
  metrics: Ref.Ref<PtyOutputMetrics>,
  frame: OutputFrame
): Effect.Effect<void, never, never> =>
  Ref.update(metrics, (current) =>
    updateCoalescingFactor({
      ...current,
      coalescedFrames: current.coalescedFrames + (frame.coalesced ? 1 : 0),
      emittedBytes: current.emittedBytes + frame.bytes.byteLength,
      emittedFrames: current.emittedFrames + 1,
      queueBytes: 0,
      queueDepth: 0
    })
  )

const recordDroppedFrame = (
  metrics: Ref.Ref<PtyOutputMetrics>,
  frame: OutputFrame | Uint8Array
): Effect.Effect<void, never, never> =>
  Ref.update(metrics, (current) => {
    const bytes = frame instanceof Uint8Array ? frame.byteLength : frame.bytes.byteLength
    return updateCoalescingFactor({
      ...current,
      droppedBytes: current.droppedBytes + bytes,
      droppedFrames: current.droppedFrames + 1
    })
  })

const updateCoalescingFactor = (metrics: PtyOutputMetrics): PtyOutputMetrics => ({
  ...metrics,
  coalescingFactor: metrics.emittedFrames === 0 ? 1 : metrics.inputFrames / metrics.emittedFrames
})

interface OutputCoalescer {
  readonly flushDelayMs: () => number
  readonly flush: () => OutputFrame
  readonly flushTimer: () => OutputFrame
  readonly isEmpty: () => boolean
  readonly push: (chunk: Uint8Array) => readonly OutputFrame[]
}

const makeOutputCoalescer = (
  policy: ResolvedPtyBudgetPolicy,
  now: () => number
): OutputCoalescer => {
  const chunks: Uint8Array[] = []
  let bufferedBytes = 0
  let windowStartedAt = 0

  const flush = (): OutputFrame => {
    if (bufferedBytes === 0) {
      return { bytes: new Uint8Array(), coalesced: false }
    }

    const coalesced = chunks.length > 1
    const frame = concatChunks(chunks, bufferedBytes)
    chunks.length = 0
    bufferedBytes = 0
    windowStartedAt = 0
    return { bytes: frame, coalesced }
  }

  return {
    flushDelayMs: () => {
      if (bufferedBytes === 0) {
        return Number.POSITIVE_INFINITY
      }
      return Math.max(0, policy.outputCoalesceMs - (now() - windowStartedAt))
    },
    flush,
    flushTimer: () => flush(),
    isEmpty: () => bufferedBytes === 0,
    push: (chunk) => {
      if (chunk.byteLength === 0) {
        return []
      }

      const timestamp = now()
      const frames: OutputFrame[] = []
      if (
        bufferedBytes > 0 &&
        policy.outputCoalesceMs > 0 &&
        timestamp - windowStartedAt >= policy.outputCoalesceMs
      ) {
        frames.push(flush())
      }

      if (bufferedBytes === 0) {
        windowStartedAt = timestamp
      }
      chunks.push(chunk)
      bufferedBytes += chunk.byteLength
      if (bufferedBytes >= policy.outputCoalesceBytes) {
        frames.push(flush())
      }

      return frames
    }
  }
}

const concatChunks = (chunks: readonly Uint8Array[], totalBytes: number): Uint8Array => {
  if (chunks.length === 1) {
    const onlyChunk = chunks[0]
    return onlyChunk === undefined ? new Uint8Array() : onlyChunk
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const outputQueueCapacity = (policy: ResolvedPtyBudgetPolicy): number =>
  Math.max(1, Math.ceil(policy.outputBufferBytes / policy.outputCoalesceBytes))

const observeChildExit = (
  exitStatus: Effect.Effect<PtyExitStatus, PtyError, never>,
  resource: ManagedResourceHandle<"pty", "running">,
  command: string,
  ptyScope: Scope.Closeable,
  disposalOrigin: Ref.Ref<PtyDisposalOrigin>,
  inspector: ExecutionInspectorCollectorApi,
  now: () => number
): Effect.Effect<void, never, Scope.Scope> =>
  exitStatus.pipe(
    Effect.exit,
    Effect.flatMap((exit) =>
      Effect.gen(function* () {
        const origin = yield* claimPtyObserverDisposal(disposalOrigin)
        if (origin !== "registry") {
          yield* resource.dispose()
        }
        if (Exit.isFailure(exit)) {
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "pty",
              status: "failure",
              operation: "PTY.exit",
              command,
              resourceId: resource.id,
              message: formatExitFailure(exit),
              timestamp: now()
            })
          )
          yield* Effect.logWarning("PTY.exit observer failed", {
            command,
            reason: formatExitFailure(exit)
          })
        } else {
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "pty",
              status: "cleanup",
              operation: "PTY.exit",
              command,
              resourceId: resource.id,
              timestamp: now()
            })
          )
        }
        if (origin !== "registry") {
          yield* Scope.close(ptyScope, Exit.void)
        }
      })
    ),
    Effect.forkScoped({ startImmediately: true }),
    Effect.asVoid
  )

const disposeChild = (
  child: PtyChild,
  ptyScope: Scope.Closeable,
  command: string,
  gracefulShutdownMs: number,
  disposalOrigin: Ref.Ref<PtyDisposalOrigin>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const origin = yield* claimPtyRegistryDisposal(disposalOrigin)
    if (origin === "observer") {
      return
    }

    if (child.isRunning()) {
      yield* Effect.tryPromise({
        try: () => child.terminateTree(),
        catch: (error) => mapPtyError(error, command, "PTY.dispose.terminateTree")
      }).pipe(
        Effect.tapError((error: HostProtocolError) =>
          Effect.logWarning("PTY.dispose.terminateTree failed", {
            command,
            reason: error.message
          })
        ),
        Effect.ignore
      )
      const gracefulExit = yield* waitForChildExit(child, command, gracefulShutdownMs)
      if (Option.isNone(gracefulExit) && child.isRunning()) {
        yield* forceKillChild(child, command)
        const forcedExit = yield* waitForChildExit(child, command, gracefulShutdownMs)
        if (Option.isNone(forcedExit) && child.isRunning()) {
          yield* Effect.logWarning("PtyForceKillTimeout", {
            command,
            gracefulShutdownMs
          })
        }
      }
    }

    yield* Scope.close(ptyScope, Exit.void)
  })

type PtyDisposalOrigin = "running" | "observer" | "registry"

const claimPtyObserverDisposal = (
  origin: Ref.Ref<PtyDisposalOrigin>
): Effect.Effect<PtyDisposalOrigin, never, never> =>
  Ref.modify(origin, (current) =>
    current === "running" ? (["observer", "observer"] as const) : ([current, current] as const)
  )

const claimPtyRegistryDisposal = (
  origin: Ref.Ref<PtyDisposalOrigin>
): Effect.Effect<PtyDisposalOrigin, never, never> =>
  Ref.modify(origin, (current) =>
    current === "running" ? (["registry", "registry"] as const) : ([current, current] as const)
  )

const forceKillChild = (child: PtyChild, command: string): Effect.Effect<void, never, never> =>
  Effect.tryPromise({
    try: () => child.forceKillTree(),
    catch: (error) => mapPtyError(error, command, "PTY.dispose.forceKillTree")
  }).pipe(
    Effect.tapError((error: HostProtocolError) =>
      Effect.logWarning("PTY.dispose.forceKillTree failed", {
        command,
        reason: error.message
      })
    ),
    Effect.ignore
  )

const waitForChildExit = (
  child: PtyChild,
  command: string,
  gracefulShutdownMs: number
): Effect.Effect<Option.Option<PtyExitStatus>, never, never> =>
  Effect.tryPromise({
    try: () => child.exited,
    catch: (error) => mapPtyError(error, command, "PTY.dispose.wait")
  }).pipe(
    Effect.timeoutOption(`${gracefulShutdownMs} millis`),
    Effect.catch((error: HostProtocolError) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("PTY.dispose.wait failed", {
          command,
          reason: error.message
        })
        return Option.none<PtyExitStatus>()
      })
    )
  )

const decodeOpenInput = (
  input: unknown,
  operation: string
): Effect.Effect<PtyOpenInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PtyOpenInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeResizeInput = (
  input: unknown,
  operation: string
): Effect.Effect<PtyResizeInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PtyResizeInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("size", formatUnknownError(error), operation)
    )
  )

const decodeSignalInput = (
  input: unknown,
  operation: string
): Effect.Effect<PtySignalInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PtySignalInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("signal", formatUnknownError(error), operation)
    )
  )

const decodeWriteInput = (
  input: unknown,
  operation: string
): Effect.Effect<Uint8Array, HostProtocolInvalidArgumentError, never> =>
  input instanceof Uint8Array
    ? Effect.succeed(input)
    : Effect.fail(makeHostProtocolInvalidArgumentError("chunk", "must be a Uint8Array", operation))

const assertPtyHandleFresh = (
  registry: ResourceRegistryApi,
  resource: ManagedResourceHandle<"pty", "running">,
  operation: string
): Effect.Effect<void, HostProtocolStaleHandleError, never> =>
  registry.assertFresh(resource).pipe(
    Effect.asVoid,
    Effect.mapError((error) => makePtyStaleHandleError(error, operation))
  )

const makePtyStaleHandleError = (
  error: StaleHandle,
  operation: string
): HostProtocolStaleHandleError =>
  new HostProtocolStaleHandleError({
    tag: "StaleHandle",
    kind: error.kind,
    id: error.id,
    expectedGeneration: error.expectedGeneration,
    actualGeneration: Math.max(0, error.actualGeneration),
    message: `stale resource handle: ${error.kind}:${error.id}`,
    operation,
    recoverable: false
  })

const authorizePtyOpen = (
  permissions: PtyPermissionPolicy,
  input: PtyOpenInput
): Effect.Effect<
  void,
  HostProtocolInvalidArgumentError | HostProtocolPermissionDeniedError,
  never
> =>
  Effect.gen(function* () {
    if (containsShellMetacharacter(input.command)) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError("command", "contains shell metacharacters", "PTY.open")
      )
    }

    if ((permissions.spawn ?? []).includes(input.command)) {
      return
    }

    return yield* Effect.fail(makePtyPermissionDenied(input.command, "PTY.open"))
  })

const validatePtyBudgets = (
  budgets: Required<PtyBudgetPolicy>,
  operation: string
): Effect.Effect<ResolvedPtyBudgetPolicy, HostProtocolInvalidArgumentError, never> =>
  Effect.gen(function* () {
    yield* validatePositiveIntegerBudget("maxConcurrent", budgets.maxConcurrent, operation)
    yield* validatePositiveIntegerBudget("outputBufferBytes", budgets.outputBufferBytes, operation)
    yield* validatePositiveIntegerBudget(
      "outputCoalesceBytes",
      budgets.outputCoalesceBytes,
      operation
    )
    yield* validatePositiveIntegerBudget("outputCoalesceMs", budgets.outputCoalesceMs, operation)
    if (!isPtyOutputOverflow(budgets.outputOverflow)) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "outputOverflow",
          "must be block, dropNewest, dropOldest, or error",
          operation
        )
      )
    }
    return {
      ...budgets,
      outputOverflow: budgets.outputOverflow
    }
  })

const isPtyOutputOverflow = (value: unknown): value is PtyOutputOverflow =>
  typeof value === "string" && PTY_OUTPUT_OVERFLOWS.has(value)

const validatePositiveIntegerBudget = (
  field: keyof ResolvedPtyBudgetPolicy,
  value: number,
  operation: string
): Effect.Effect<void, HostProtocolInvalidArgumentError, never> =>
  Number.isSafeInteger(value) && value > 0
    ? Effect.void
    : Effect.fail(
        makeHostProtocolInvalidArgumentError(field, "must be a positive safe integer", operation)
      )

const holdPtyBudgetPermit = (
  ptyBudgets: RcMap.RcMap<string, Semaphore.Semaphore>,
  ptyScope: Scope.Closeable,
  ownerScope: string,
  maxConcurrent: number
): Effect.Effect<void, HostProtocolResourceBusyError, never> =>
  holdScopedExecutionPermit({
    budgets: ptyBudgets,
    maxConcurrent,
    onBusy: (scope, limit) => makePtyResourceBusy(scope, limit, "PTY.open"),
    ownerScope,
    scope: ptyScope
  })

const makeBackpressureOverflow = (
  command: string,
  limitBytes: number,
  lostFrames: number
): HostProtocolBackpressureOverflowError =>
  new HostProtocolBackpressureOverflowError({
    tag: "BackpressureOverflow",
    policy: "error",
    lostFrames,
    ...makePtyErrorCommon(
      "BackpressureOverflow",
      `output exceeded PTY buffer budget (${limitBytes} bytes): ${command}`,
      "PTY.output"
    )
  })

const makePtyResourceBusy = (
  ownerScope: string,
  maxConcurrent: number,
  operation: string
): HostProtocolResourceBusyError =>
  new HostProtocolResourceBusyError({
    tag: "ResourceBusy",
    resource: `pty:${ownerScope}`,
    ...makePtyErrorCommon(
      "ResourceBusy",
      `PTY budget exceeded for scope ${ownerScope}: limit ${maxConcurrent}`,
      operation
    )
  })

const makePtyPermissionDenied = (
  command: string,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: "pty.spawn",
    resource: command,
    ...makePtyErrorCommon("PermissionDenied", `permission denied: ${command}`, operation)
  })

const mapPtyError = (error: unknown, command: string, operation: string): HostProtocolError => {
  if (isHostProtocolError(error)) {
    return error
  }

  if (isNodeError(error)) {
    switch (error.code) {
      case "ENOENT":
        return new HostProtocolFileNotFoundError({
          tag: "FileNotFound",
          path: command,
          ...makePtyErrorCommon("FileNotFound", `PTY command not found: ${command}`, operation)
        })
      case "EACCES":
      case "EPERM":
        return new HostProtocolPermissionDeniedError({
          tag: "PermissionDenied",
          capability: "pty.spawn",
          resource: command,
          ...makePtyErrorCommon(
            "PermissionDenied",
            `PTY command permission denied: ${command}`,
            operation
          )
        })
      case "EINVAL":
        return makeHostProtocolInvalidArgumentError("command", error.message, operation)
      case undefined:
        return makeHostProtocolInvalidArgumentError("command", error.message, operation)
      default:
        return makeHostProtocolInvalidArgumentError("command", error.message, operation)
    }
  }

  return makeHostProtocolInvalidArgumentError("command", formatUnknownError(error), operation)
}

const makePtyErrorCommon = (
  tag: HostProtocolErrorTag,
  message: string,
  operation: string
): Pick<HostProtocolError, "message" | "operation" | "recoverable"> => ({
  message,
  operation,
  recoverable: hostProtocolErrorRecoverableDefault(tag)
})

const containsShellMetacharacter = (command: string): boolean => SHELL_METACHARACTER.test(command)

const SHELL_METACHARACTER = /[;|&><`\n]|\$\(/

const isHostProtocolError = (error: unknown): error is HostProtocolError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error && "message" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const formatExitFailure = (exit: Exit.Exit<unknown, HostProtocolError>): string => {
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    return fail?.error.message ?? "unknown PTY exit failure"
  }

  return "unknown PTY exit failure"
}
