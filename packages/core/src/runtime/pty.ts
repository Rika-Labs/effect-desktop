import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolUnsupportedError,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type HostProtocolErrorTag
} from "@effect-desktop/bridge"
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Stream
} from "effect"

import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
// eslint-disable-next-line no-control-regex -- PTY signals and env values must not contain control bytes or NUL.
const PtySignalString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000-\u001F\u007F]+$/))
const EnvironmentVariableName = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000]+$/))
const EnvironmentVariableValue = Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))

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
  readonly ownerScope: string
  readonly rows: number
  readonly cols: number
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

export interface PtyHandle {
  readonly resource: ResourceHandle<"pty", "running">
  readonly pid: Option.Option<number>
  readonly output: Stream.Stream<Uint8Array, PtyError, never>
  readonly outputMetrics: Effect.Effect<PtyOutputMetrics, never, never>
  readonly onExit: Effect.Effect<PtyExitStatus, PtyError, never>
  readonly write: (chunk: Uint8Array) => Effect.Effect<void, PtyError, never>
  readonly resize: (size: PtyResizeInput) => Effect.Effect<void, PtyError, never>
  readonly kill: (signal?: PtySignalInput) => Effect.Effect<void, PtyError, never>
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
  readonly adapter?: PtyAdapter
  readonly budgets?: PtyBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly permissions?: PtyPermissionPolicy
}

export interface PtyBudgetPolicy {
  readonly maxConcurrent?: number
  readonly outputBufferBytes?: number
  readonly outputCoalesceBytes?: number
  readonly outputCoalesceMs?: number
  readonly outputOverflow?: PtyOutputOverflow
}

export type PtyOutputOverflow = "block" | "dropNewest" | "dropOldest" | "error"

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

const DEFAULT_PTY_BUDGETS: Required<PtyBudgetPolicy> = Object.freeze({
  maxConcurrent: 16,
  outputBufferBytes: 262_144,
  outputCoalesceBytes: 65_536,
  outputCoalesceMs: 4,
  outputOverflow: "dropOldest"
})
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000
const EMPTY_PTY_PERMISSIONS: PtyPermissionPolicy = Object.freeze({})

export const makePty = (
  registry: ResourceRegistryApi,
  options: PtyOptions = {}
): Effect.Effect<PtyApi, never, never> =>
  Effect.gen(function* () {
    const adapter = options.adapter ?? UnsupportedPtyAdapter
    const budgets = { ...DEFAULT_PTY_BUDGETS, ...options.budgets }
    const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS
    const permissions = options.permissions ?? EMPTY_PTY_PERMISSIONS
    const ptyBudgets = yield* Ref.make(new Map<string, number>())

    const api: PtyApi = Object.freeze({
      open: (options: PtyOpenOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeOpenInput(
            {
              command: options.argv[0],
              args: options.argv.slice(1),
              ownerScope: options.ownerScope,
              rows: options.rows,
              cols: options.cols,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options.env === undefined ? {} : { env: options.env })
            },
            "PTY.open"
          )
          yield* authorizePtyOpen(permissions, input)
          yield* validatePtyBudgets(budgets, "PTY.open")
          const { child, resource } = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* reservePtyBudget(ptyBudgets, input.ownerScope, budgets.maxConcurrent)
              const child = yield* Effect.try({
                try: () => adapter.open(input),
                catch: (error) => mapPtyError(error, input.command, "PTY.open")
              }).pipe(Effect.tapError(() => releasePtyBudget(ptyBudgets, input.ownerScope)))
              const resource = yield* registry
                .register({
                  kind: "pty",
                  ownerScope: input.ownerScope,
                  state: "running",
                  dispose: disposeChild(child, input.command, gracefulShutdownMs).pipe(
                    Effect.andThen(releasePtyBudget(ptyBudgets, input.ownerScope))
                  )
                })
                .pipe(Effect.orDie)

              return { child, resource }
            })
          )

          return yield* makeHandle(child, resource, input.command, budgets)
        }).pipe(
          Effect.withSpan("PTY.open", {
            attributes: {
              command: options.argv[0],
              argc: options.argv.length,
              ownerScope: options.ownerScope,
              rows: options.rows,
              cols: options.cols
            }
          })
        )
    })
    return api
  })

export class PTY extends Context.Service<PTY, PtyApi>()("PTY") {}

export const PtyLive = Layer.effect(
  PTY,
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    return yield* makePty(registry)
  })
)

export const PtyLayer = (options: PtyOptions = {}): Layer.Layer<PTY, never, ResourceRegistry> =>
  Layer.effect(
    PTY,
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      return yield* makePty(registry, options)
    })
  )

const makeHandle = (
  child: PtyChild,
  resource: ResourceHandle<"pty", "running">,
  command: string,
  budgets: Required<PtyBudgetPolicy>
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
      outputMetrics
    )
    const exitStatus = Effect.tryPromise({
      try: () => child.exited,
      catch: (error) => mapPtyError(error, command, "PTY.onExit")
    })
    observeChildExit(exitStatus, resource, command)
    const onExit = exitStatus.pipe(Effect.tap(() => resource.dispose()))

    return Object.freeze({
      resource,
      pid: child.pid,
      output,
      outputMetrics: Ref.get(outputMetrics),
      onExit,
      write: (chunk: Uint8Array) =>
        Effect.tryPromise({
          try: () => child.write(chunk),
          catch: (error) => mapPtyError(error, command, "PTY.write")
        }),
      resize: (size: PtyResizeInput) =>
        Effect.gen(function* () {
          const decodedSize = yield* decodeResizeInput(size, "PTY.resize")
          yield* Effect.tryPromise({
            try: () => child.resize(decodedSize),
            catch: (error) => mapPtyError(error, command, "PTY.resize")
          })
        }),
      kill: (signal?: PtySignalInput) =>
        Effect.gen(function* () {
          const decodedSignal =
            signal === undefined ? undefined : yield* decodeSignalInput(signal, "PTY.kill")
          yield* Effect.tryPromise({
            try: () => child.kill(decodedSignal),
            catch: (error) => mapPtyError(error, command, "PTY.kill")
          })
        }).pipe(Effect.withSpan("PTY.kill", { attributes: { command } }))
    })
  })

interface QueuedOutput {
  readonly bytes: Uint8Array
}

interface OutputFrame {
  readonly bytes: Uint8Array
  readonly coalesced: boolean
}

const makeOutputStream = (
  source: Stream.Stream<Uint8Array, PtyError, never>,
  command: string,
  policy: Required<PtyBudgetPolicy>,
  metrics: Ref.Ref<PtyOutputMetrics>
): Stream.Stream<Uint8Array, PtyError, never> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.bounded<QueuedOutput, PtyError | Cause.Done>(
        outputQueueCapacity(policy)
      )
      const queuedBytes = yield* Ref.make(0)
      const producer = yield* runOutputProducer(
        source,
        queue,
        queuedBytes,
        command,
        policy,
        metrics
      ).pipe(Effect.forkScoped)

      return Stream.fromQueue(queue).pipe(
        Stream.mapEffect((queued) =>
          Ref.update(queuedBytes, (bytes) => Math.max(0, bytes - queued.bytes.byteLength)).pipe(
            Effect.andThen(syncOutputQueueMetrics(queue, queuedBytes, metrics)),
            Effect.as(queued.bytes)
          )
        ),
        Stream.ensuring(
          Effect.gen(function* () {
            yield* Fiber.interrupt(producer)
            yield* Queue.shutdown(queue)
          })
        )
      )
    })
  )

const runOutputProducer = (
  source: Stream.Stream<Uint8Array, PtyError, never>,
  queue: Queue.Queue<QueuedOutput, PtyError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  command: string,
  policy: Required<PtyBudgetPolicy>,
  metrics: Ref.Ref<PtyOutputMetrics>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const coalescer = makeOutputCoalescer(policy)
    const exit = yield* Effect.exit(
      source.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            yield* recordInputChunk(metrics, chunk)
            const frames = coalescer.push(chunk)
            for (const frame of frames) {
              yield* offerOutputFrame(queue, queuedBytes, command, policy, metrics, frame)
            }
            if (coalescer.beginTimer()) {
              yield* flushCoalescedOutputAfterWindow(
                coalescer,
                queue,
                queuedBytes,
                command,
                policy,
                metrics
              ).pipe(Effect.forkChild)
            }
          })
        )
      )
    )
    if (Exit.isFailure(exit)) {
      yield* Queue.fail(queue, mapCauseToPtyError(exit.cause, command, "PTY.output"))
      return
    }

    const finalFrame = coalescer.flush()
    if (finalFrame.bytes.byteLength > 0) {
      yield* offerOutputFrame(queue, queuedBytes, command, policy, metrics, finalFrame)
    }
    yield* Queue.end(queue)
  }).pipe(
    Effect.catchCause((cause) =>
      Queue.fail(queue, mapCauseToPtyError(cause, command, "PTY.output")).pipe(Effect.asVoid)
    )
  )

const offerOutputFrame = (
  queue: Queue.Queue<QueuedOutput, PtyError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  command: string,
  policy: Required<PtyBudgetPolicy>,
  metrics: Ref.Ref<PtyOutputMetrics>,
  frame: OutputFrame
): Effect.Effect<void, PtyError, never> =>
  Effect.gen(function* () {
    if (frame.bytes.byteLength > policy.outputBufferBytes) {
      yield* recordDroppedFrame(metrics, frame)
      if (policy.outputOverflow === "error") {
        return yield* Effect.fail(makeBackpressureOverflow(command, policy.outputBufferBytes, 1))
      }
      return
    }

    if (policy.outputOverflow === "block") {
      yield* Queue.offer(queue, { bytes: frame.bytes })
      yield* Ref.update(queuedBytes, (bytes) => bytes + frame.bytes.byteLength)
      yield* recordEmittedFrame(queue, queuedBytes, metrics, frame)
      return
    }

    const canFit = yield* makeOutputQueueRoom(
      queue,
      queuedBytes,
      metrics,
      policy,
      frame.bytes.byteLength
    )
    if (!canFit) {
      yield* recordDroppedFrame(metrics, frame)
      if (policy.outputOverflow === "error") {
        return yield* Effect.fail(makeBackpressureOverflow(command, policy.outputBufferBytes, 1))
      }
      return
    }

    const offered = Queue.offerUnsafe(queue, { bytes: frame.bytes })
    if (!offered) {
      yield* recordDroppedFrame(metrics, frame)
      if (policy.outputOverflow === "error") {
        return yield* Effect.fail(makeBackpressureOverflow(command, policy.outputBufferBytes, 1))
      }
      return
    }

    yield* Ref.update(queuedBytes, (bytes) => bytes + frame.bytes.byteLength)
    yield* recordEmittedFrame(queue, queuedBytes, metrics, frame)
  })

const flushCoalescedOutputAfterWindow = (
  coalescer: OutputCoalescer,
  queue: Queue.Queue<QueuedOutput, PtyError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  command: string,
  policy: Required<PtyBudgetPolicy>,
  metrics: Ref.Ref<PtyOutputMetrics>
): Effect.Effect<void, never, never> =>
  Effect.sleep(`${policy.outputCoalesceMs} millis`).pipe(
    Effect.andThen(
      Effect.gen(function* () {
        const frame = coalescer.flushTimer()
        if (frame.bytes.byteLength > 0) {
          yield* offerOutputFrame(queue, queuedBytes, command, policy, metrics, frame)
        }
      })
    ),
    Effect.catchCause((cause) =>
      Queue.fail(queue, mapCauseToPtyError(cause, command, "PTY.output")).pipe(Effect.asVoid)
    )
  )

const makeOutputQueueRoom = (
  queue: Queue.Queue<QueuedOutput, PtyError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  metrics: Ref.Ref<PtyOutputMetrics>,
  policy: Required<PtyBudgetPolicy>,
  incomingBytes: number
): Effect.Effect<boolean, never, never> =>
  Effect.gen(function* () {
    if (policy.outputOverflow === "dropNewest" || policy.outputOverflow === "error") {
      const queueBytes = yield* Ref.get(queuedBytes)
      return queueBytes + incomingBytes <= policy.outputBufferBytes && !Queue.isFullUnsafe(queue)
    }

    while (
      (yield* Ref.get(queuedBytes)) + incomingBytes > policy.outputBufferBytes ||
      Queue.isFullUnsafe(queue)
    ) {
      const evicted = Queue.takeUnsafe(queue)
      if (evicted === undefined) {
        break
      }
      if (Exit.isSuccess(evicted)) {
        yield* Ref.update(queuedBytes, (bytes) =>
          Math.max(0, bytes - evicted.value.bytes.byteLength)
        )
        yield* recordDroppedFrame(metrics, evicted.value.bytes)
      }
    }

    return true
  })

const makeOutputMetrics = (
  policy: Required<PtyBudgetPolicy>
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
  queue: Queue.Queue<QueuedOutput, PtyError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  metrics: Ref.Ref<PtyOutputMetrics>,
  frame: OutputFrame
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const queueDepth = yield* Queue.size(queue)
    const queueBytes = yield* Ref.get(queuedBytes)
    yield* Ref.update(metrics, (current) =>
      updateCoalescingFactor({
        ...current,
        coalescedFrames: current.coalescedFrames + (frame.coalesced ? 1 : 0),
        emittedBytes: current.emittedBytes + frame.bytes.byteLength,
        emittedFrames: current.emittedFrames + 1,
        queueBytes,
        queueDepth
      })
    )
  })

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

const syncOutputQueueMetrics = (
  queue: Queue.Queue<QueuedOutput, PtyError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  metrics: Ref.Ref<PtyOutputMetrics>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const queueDepth = yield* Queue.size(queue)
    const queueBytes = yield* Ref.get(queuedBytes)
    yield* Ref.update(metrics, (current) => ({
      ...current,
      queueBytes,
      queueDepth
    }))
  })

const updateCoalescingFactor = (metrics: PtyOutputMetrics): PtyOutputMetrics => ({
  ...metrics,
  coalescingFactor: metrics.emittedFrames === 0 ? 1 : metrics.inputFrames / metrics.emittedFrames
})

interface OutputCoalescer {
  readonly beginTimer: () => boolean
  readonly flush: () => OutputFrame
  readonly flushTimer: () => OutputFrame
  readonly push: (chunk: Uint8Array) => readonly OutputFrame[]
}

const makeOutputCoalescer = (policy: Required<PtyBudgetPolicy>): OutputCoalescer => {
  const chunks: Uint8Array[] = []
  let bufferedBytes = 0
  let timerActive = false
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
    beginTimer: () => {
      if (bufferedBytes === 0 || timerActive) {
        return false
      }
      timerActive = true
      return true
    },
    flush,
    flushTimer: () => {
      timerActive = false
      return flush()
    },
    push: (chunk) => {
      if (chunk.byteLength === 0) {
        return []
      }

      const now = Date.now()
      const frames: OutputFrame[] = []
      if (
        bufferedBytes > 0 &&
        policy.outputCoalesceMs > 0 &&
        now - windowStartedAt >= policy.outputCoalesceMs
      ) {
        frames.push(flush())
      }

      if (bufferedBytes === 0) {
        windowStartedAt = now
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

const outputQueueCapacity = (policy: Required<PtyBudgetPolicy>): number =>
  Math.max(1, Math.ceil(policy.outputBufferBytes / policy.outputCoalesceBytes))

const observeChildExit = (
  exitStatus: Effect.Effect<PtyExitStatus, PtyError, never>,
  resource: ResourceHandle<"pty", "running">,
  command: string
): void => {
  Effect.runFork(
    exitStatus.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        resource.dispose().pipe(
          Effect.andThen(
            Exit.isFailure(exit)
              ? Effect.logWarning("PTY.exit observer failed", {
                  command,
                  reason: formatExitFailure(exit)
                })
              : Effect.void
          )
        )
      )
    )
  )
}

const disposeChild = (
  child: PtyChild,
  command: string,
  gracefulShutdownMs: number
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (child.isRunning()) {
      yield* Effect.tryPromise({
        try: () => child.terminateTree(),
        catch: (error) => mapPtyError(error, command, "PTY.dispose.terminateTree")
      }).pipe(
        Effect.catch((error: HostProtocolError) =>
          Effect.logWarning("PTY.dispose.terminateTree failed", {
            command,
            reason: error.message
          })
        )
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
  })

const forceKillChild = (child: PtyChild, command: string): Effect.Effect<void, never, never> =>
  Effect.tryPromise({
    try: () => child.forceKillTree(),
    catch: (error) => mapPtyError(error, command, "PTY.dispose.forceKillTree")
  }).pipe(
    Effect.catch((error: HostProtocolError) =>
      Effect.logWarning("PTY.dispose.forceKillTree failed", {
        command,
        reason: error.message
      })
    )
  )

const waitForChildExit = (
  child: PtyChild,
  command: string,
  gracefulShutdownMs: number
): Effect.Effect<Option.Option<PtyExitStatus>, never, never> =>
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: () => child.exited,
      catch: (error) => mapPtyError(error, command, "PTY.dispose.wait")
    }).pipe(Effect.timeoutOption(`${gracefulShutdownMs} millis`))
  }).pipe(
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
): Effect.Effect<void, HostProtocolInvalidArgumentError, never> =>
  Effect.gen(function* () {
    yield* validatePositiveIntegerBudget("maxConcurrent", budgets.maxConcurrent, operation)
    yield* validatePositiveIntegerBudget("outputBufferBytes", budgets.outputBufferBytes, operation)
    yield* validatePositiveIntegerBudget(
      "outputCoalesceBytes",
      budgets.outputCoalesceBytes,
      operation
    )
    yield* validatePositiveIntegerBudget("outputCoalesceMs", budgets.outputCoalesceMs, operation)
  })

const validatePositiveIntegerBudget = (
  field: keyof Required<PtyBudgetPolicy>,
  value: number,
  operation: string
): Effect.Effect<void, HostProtocolInvalidArgumentError, never> =>
  Number.isSafeInteger(value) && value > 0
    ? Effect.void
    : Effect.fail(
        makeHostProtocolInvalidArgumentError(field, "must be a positive safe integer", operation)
      )

const reservePtyBudget = (
  ptyBudgets: Ref.Ref<Map<string, number>>,
  ownerScope: string,
  maxConcurrent: number
): Effect.Effect<void, HostProtocolResourceBusyError, never> =>
  Effect.gen(function* () {
    const reserved = yield* Ref.modify(ptyBudgets, (current) => {
      const runningPtys = current.get(ownerScope) ?? 0
      if (runningPtys >= maxConcurrent) {
        return [false, current] as const
      }
      const next = new Map(current)
      next.set(ownerScope, runningPtys + 1)
      return [true, next] as const
    })

    if (reserved) {
      return
    }

    return yield* Effect.fail(makePtyResourceBusy(ownerScope, maxConcurrent, "PTY.open"))
  })

const releasePtyBudget = (
  ptyBudgets: Ref.Ref<Map<string, number>>,
  ownerScope: string
): Effect.Effect<void, never, never> =>
  Ref.update(ptyBudgets, (current) => {
    const runningPtys = current.get(ownerScope) ?? 0
    if (runningPtys <= 1) {
      const next = new Map(current)
      next.delete(ownerScope)
      return next
    }

    const next = new Map(current)
    next.set(ownerScope, runningPtys - 1)
    return next
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

const mapCauseToPtyError = (
  cause: Cause.Cause<PtyError>,
  command: string,
  operation: string
): PtyError => {
  const squashed = Cause.squash(cause)
  return mapPtyError(squashed, command, operation)
}

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

const makePtyUnsupported = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "PTY adapter is not configured",
    ...makePtyErrorCommon("Unsupported", "PTY adapter is not configured", operation)
  })

const UnsupportedPtyAdapter: PtyAdapter = {
  open: () => {
    throw makePtyUnsupported("PTY.open")
  }
}

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
