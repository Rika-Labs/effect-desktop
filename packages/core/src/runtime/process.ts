import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolStaleHandleError,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type HostProtocolErrorTag,
  type HostProtocolInvalidArgumentError
} from "@effect-desktop/bridge"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Queue,
  RcMap,
  Ref,
  Schema,
  Semaphore,
  Sink,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import { holdScopedExecutionPermit } from "./execution-budgets.js"
import { ResourceRegistry } from "./resources.js"
import { ResourceOwner, type ResourceOwnerApi } from "./resource-owner.js"
import {
  disabledExecutionInspectorCollector,
  ExecutionEvent,
  type ExecutionInspectorCollectorApi
} from "./inspector-events.js"
import type {
  ManagedResourceHandle,
  ResourceId,
  ResourceRegistryApi,
  StaleHandle
} from "./resources.js"

const { NonEmptyString } = Schema
const NulByte = String.fromCharCode(0)
const NoNulTextPattern = new RegExp(`^[^${NulByte}]+$`, "u")
const OptionalNoNulTextPattern = new RegExp(`^[^${NulByte}]*$`, "u")
const EnvironmentVariableName = Schema.NonEmptyString.check(Schema.isPattern(NoNulTextPattern))
const EnvironmentVariableValue = Schema.String.check(Schema.isPattern(OptionalNoNulTextPattern))
const ProcessTimestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PROCESS_SIGNALS = [
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGCHLD",
  "SIGCONT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGIO",
  "SIGIOT",
  "SIGKILL",
  "SIGPIPE",
  "SIGPOLL",
  "SIGPROF",
  "SIGPWR",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTKFLT",
  "SIGSTOP",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGUNUSED",
  "SIGURG",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGWINCH",
  "SIGXCPU",
  "SIGXFSZ",
  "SIGBREAK",
  "SIGLOST",
  "SIGINFO"
] as const satisfies readonly ChildProcess.Signal[]

export class ProcessSpawnInput extends Schema.Class<ProcessSpawnInput>("ProcessSpawnInput")({
  args: Schema.Array(Schema.String),
  command: NonEmptyString,
  cwd: Schema.optionalKey(NonEmptyString),
  env: Schema.optionalKey(Schema.Record(EnvironmentVariableName, EnvironmentVariableValue)),
  ownerScope: NonEmptyString,
  shell: Schema.optionalKey(Schema.Boolean)
}) {}

export const ProcessSignalInput = Schema.Literals(PROCESS_SIGNALS)
export type ProcessSignalInput = typeof ProcessSignalInput.Type

export class ProcessExitStatus extends Schema.Class<ProcessExitStatus>("ProcessExitStatus")({
  code: Schema.Int,
  signal: Schema.optionalKey(Schema.String)
}) {}

export type ProcessError = HostProtocolError

export interface ProcessSpawnOptions {
  readonly shell?: boolean
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

export interface ProcessHandle {
  readonly resource: ManagedResourceHandle<"process", "running">
  readonly pid: number
  readonly stdin: Sink.Sink<void, unknown, never, ProcessError, never>
  readonly stdout: Stream.Stream<Uint8Array, ProcessError, never>
  readonly stderr: Stream.Stream<Uint8Array, ProcessError, never>
  readonly exit: Effect.Effect<ProcessExitStatus, ProcessError, never>
  readonly kill: (signal?: unknown) => Effect.Effect<void, ProcessError, never>
}

export interface ProcessSnapshot {
  readonly resourceId: string
  readonly pid: number
  readonly command: string
  readonly args: readonly string[]
  readonly ownerScope: string
  readonly state: "running" | "exited"
  readonly startedAt: number
  readonly updatedAt: number
  readonly lastExit: Option.Option<ProcessExitStatus>
}

export interface ProcessApi {
  readonly spawn: (
    command: string,
    args?: readonly string[],
    options?: ProcessSpawnOptions
  ) => Effect.Effect<ProcessHandle, ProcessError, never>
  readonly list: () => Effect.Effect<readonly ProcessSnapshot[], never, never>
  readonly observe: () => Stream.Stream<readonly ProcessSnapshot[], never, never>
}

export interface ProcessOptions {
  readonly budgets?: ProcessBudgetPolicy
  readonly inspector?: ExecutionInspectorCollectorApi
  readonly gracefulShutdownMs?: number
  readonly maxSnapshots?: number
  readonly permissions?: ProcessPermissionPolicy
  readonly now?: () => number
}

export interface ProcessBudgetPolicy {
  readonly maxConcurrent?: number
  readonly stderrBufferBytes?: number
  readonly stdoutBufferBytes?: number
}

export interface ProcessPermissionPolicy {
  readonly spawn?: readonly string[]
  readonly shell?: boolean
}

const DEFAULT_PROCESS_BUDGETS: Required<ProcessBudgetPolicy> = Object.freeze({
  maxConcurrent: 16,
  stderrBufferBytes: 262_144,
  stdoutBufferBytes: 1_048_576
})
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5000
const DEFAULT_MAX_PROCESS_SNAPSHOTS = 1024
const EMPTY_PROCESS_PERMISSIONS: ProcessPermissionPolicy = Object.freeze({})

export const makeProcess = (
  registry: ResourceRegistryApi,
  owner: ResourceOwnerApi,
  options: ProcessOptions = {}
): Effect.Effect<
  ProcessApi,
  HostProtocolInvalidArgumentError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* makeProcess() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const budgets = { ...DEFAULT_PROCESS_BUDGETS, ...options.budgets }
    yield* validateProcessBudgets(budgets, "Process.make")
    const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS
    if (!Number.isFinite(gracefulShutdownMs) || gracefulShutdownMs <= 0) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "gracefulShutdownMs",
          "must be a finite positive number",
          "Process.make"
        )
      )
    }
    const maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_PROCESS_SNAPSHOTS
    if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots <= 0) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "maxSnapshots",
          "must be a positive safe integer",
          "Process.make"
        )
      )
    }
    const permissions = options.permissions ?? EMPTY_PROCESS_PERMISSIONS
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())
    const inspector = options.inspector ?? disabledExecutionInspectorCollector
    const processBudgetScope = yield* Scope.make()
    const processBudgets = yield* RcMap.make({
      lookup: (_ownerScope: string) => Semaphore.make(budgets.maxConcurrent)
    }).pipe(Scope.provide(processBudgetScope))
    const snapshots = yield* SubscriptionRef.make(new Map<ResourceId, ProcessSnapshot>())

    return Object.freeze({
      list: () => SubscriptionRef.get(snapshots).pipe(Effect.map(processSnapshotList)),
      observe: () => SubscriptionRef.changes(snapshots).pipe(Stream.map(processSnapshotList)),
      spawn: (command: string, args: readonly string[] = [], options?: ProcessSpawnOptions) =>
        Effect.gen(function* spawn() {
          const input = yield* decodeSpawnInput(
            {
              args: [...args],
              command,
              ownerScope: owner.scopeId,
              ...(options?.shell === undefined ? {} : { shell: options.shell }),
              ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options?.env === undefined ? {} : { env: options.env })
            },
            "Process.spawn"
          )
          yield* authorizeProcessSpawn(permissions, input)
          const startedAt = yield* decodeProcessTimestamp(now(), "Process.spawn")
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "process",
              status: "start",
              operation: "Process.spawn",
              command: input.command,
              ownerScope: input.ownerScope,
              timestamp: startedAt
            })
          )
          const { child, disposalOrigin, exitObserved, exitState, processScope, resource } =
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const processScope = yield* Scope.make()
                yield* holdScopedExecutionPermit({
                  budgets: processBudgets,
                  scope: processScope,
                  ownerScope: input.ownerScope,
                  maxConcurrent: budgets.maxConcurrent,
                  onBusy: (ownerScope, maxConcurrent) =>
                    makeProcessResourceBusy(ownerScope, maxConcurrent, "Process.spawn")
                }).pipe(Effect.tapError(() => Scope.close(processScope, Exit.void)))
                const command = makeChildProcessCommand(input, gracefulShutdownMs)
                const child = yield* spawner.spawn(command).pipe(
                  Scope.provide(processScope),
                  Effect.mapError((error) =>
                    mapPlatformError(error, input.command, "Process.spawn")
                  ),
                  Effect.tapError(() => Scope.close(processScope, Exit.void))
                )
                const exitState = yield* Deferred.make<ProcessExitStatus, ProcessError>()
                const exitObserved = yield* Ref.make(false)
                const disposalOrigin = yield* Ref.make<ProcessDisposalOrigin>("running")
                const resource = yield* registry
                  .register({
                    dispose: disposeChild(
                      child,
                      processScope,
                      input.command,
                      gracefulShutdownMs,
                      disposalOrigin,
                      Ref.get(exitObserved).pipe(Effect.map((observed) => !observed))
                    ),
                    kind: "process",
                    ownerScope: input.ownerScope,
                    state: "running"
                  })
                  .pipe(Effect.orDie)
                yield* upsertProcessSnapshot(
                  snapshots,
                  resource.id,
                  {
                    args: input.args,
                    command: input.command,
                    lastExit: Option.none(),
                    ownerScope: input.ownerScope,
                    pid: Number(child.pid),
                    resourceId: resource.id,
                    startedAt,
                    state: "running",
                    updatedAt: startedAt
                  },
                  maxSnapshots
                )
                yield* inspector.publish(
                  new ExecutionEvent({
                    kind: "process",
                    status: "success",
                    operation: "Process.spawn",
                    command: input.command,
                    ownerScope: input.ownerScope,
                    pid: Number(child.pid),
                    resourceId: resource.id,
                    timestamp: startedAt
                  })
                )

                return { child, disposalOrigin, exitObserved, exitState, processScope, resource }
              })
            )

          return yield* makeHandle(
            child,
            resource,
            exitState,
            processScope,
            exitObserved,
            disposalOrigin,
            input.command,
            budgets,
            snapshots,
            now,
            registry,
            inspector
          ).pipe(Effect.uninterruptible)
        }).pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              const timestamp = yield* safeInspectorTimestamp(now)
              yield* inspector.publish(
                new ExecutionEvent({
                  kind: "process",
                  status: "failure",
                  operation: "Process.spawn",
                  command,
                  ownerScope: owner.scopeId,
                  errorTag: error._tag,
                  message: error.message,
                  timestamp
                })
              )
            })
          ),
          Effect.withSpan("Process.spawn", {
            attributes: {
              argc: args.length,
              command,
              ownerScope: owner.scopeId
            }
          })
        )
    })
  })

export class Process extends Context.Service<Process, ProcessApi>()(
  "@effect-desktop/core/runtime/process"
) {}

export const ProcessLive = Layer.effect(
  Process,
  Effect.gen(function* ProcessLive() {
    const owner = yield* ResourceOwner
    const registry = yield* ResourceRegistry
    return yield* makeProcess(registry, owner).pipe(Effect.orDie)
  })
)

export const ProcessLayer = (
  options: ProcessOptions = {}
): Layer.Layer<
  Process,
  HostProtocolInvalidArgumentError,
  ResourceOwner | ResourceRegistry | ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    Process,
    Effect.gen(function* ProcessLayer() {
      const owner = yield* ResourceOwner
      const registry = yield* ResourceRegistry
      return yield* makeProcess(registry, owner, options)
    })
  )

const makeHandle = (
  child: ChildProcessSpawner.ChildProcessHandle,
  resource: ManagedResourceHandle<"process", "running">,
  exitState: Deferred.Deferred<ProcessExitStatus, ProcessError>,
  processScope: Scope.Closeable,
  exitObserved: Ref.Ref<boolean>,
  disposalOrigin: Ref.Ref<ProcessDisposalOrigin>,
  command: string,
  budgets: Required<ProcessBudgetPolicy>,
  snapshots: SubscriptionRef.SubscriptionRef<Map<ResourceId, ProcessSnapshot>>,
  now: () => number,
  registry: ResourceRegistryApi,
  inspector: ExecutionInspectorCollectorApi
): Effect.Effect<ProcessHandle, never, never> =>
  Effect.gen(function* makeHandle() {
    const stdout = boundedOutputStream(
      child.stdout.pipe(
        Stream.mapError((error) => mapPlatformError(error, command, "Process.stdout"))
      ),
      "stdout",
      command,
      budgets.stdoutBufferBytes
    )
    const stderr = boundedOutputStream(
      child.stderr.pipe(
        Stream.mapError((error) => mapPlatformError(error, command, "Process.stderr"))
      ),
      "stderr",
      command,
      budgets.stderrBufferBytes
    )
    const stdin = child.stdin.pipe(
      Sink.mapError((error) => mapPlatformError(error, command, "Process.stdin.write")),
      Sink.mapInputEffect((chunk: unknown) => decodeStdinChunk(chunk, "Process.stdin.write"))
    )
    const childExitStatus = child.exitCode.pipe(
      Effect.map((code) => new ProcessExitStatus({ code: Number(code) })),
      Effect.catch((error: PlatformError) => {
        const signal = platformErrorSignal(error)
        if (signal !== undefined) {
          return Effect.succeed(new ProcessExitStatus({ code: 0, signal }))
        }
        return Effect.fail(mapPlatformError(error, command, "Process.exit"))
      })
    )
    const completeExit = (status: ProcessExitStatus): Effect.Effect<void, ProcessError, never> =>
      Effect.gen(function* completeExit() {
        yield* markProcessExited(snapshots, resource.id, status, now(), "Process.exit")
        yield* inspector.publish(
          new ExecutionEvent({
            kind: "process",
            status: "cleanup",
            operation: "Process.exit",
            command,
            resourceId: resource.id,
            pid: Number(child.pid),
            exitCode: status.code,
            ...(status.signal === undefined ? {} : { signal: status.signal }),
            timestamp: now()
          })
        )
        yield* Deferred.succeed(exitState, status)
        yield* Ref.set(exitObserved, true)
        const origin = yield* claimObserverDisposal(disposalOrigin)
        if (origin === "registry") {
          return
        }
        yield* resource.dispose()
        yield* Scope.close(processScope, Exit.void)
      })
    yield* observeChildExit(
      childExitStatus,
      exitState,
      resource,
      command,
      completeExit,
      disposalOrigin,
      exitObserved,
      processScope
    ).pipe(Scope.provide(processScope))
    const exit = Deferred.await(exitState)

    return Object.freeze({
      exit,
      kill: (signal?: unknown) =>
        Effect.gen(function* kill() {
          const decodedSignal =
            signal === undefined ? undefined : yield* decodeSignalInput(signal, "Process.kill")
          yield* assertProcessHandleFresh(registry, resource, "Process.kill")
          const killSignal = decodedSignal ?? "SIGTERM"
          yield* child
            .kill({ killSignal })
            .pipe(Effect.mapError((error) => mapPlatformError(error, command, "Process.kill")))
          yield* inspector.publish(
            new ExecutionEvent({
              kind: "process",
              status: "interruption",
              operation: "Process.kill",
              command,
              resourceId: resource.id,
              pid: Number(child.pid),
              signal: killSignal,
              timestamp: now()
            })
          )
          yield* exit
        }).pipe(
          Effect.withSpan("Process.kill", {
            attributes: { command, pid: Number(child.pid) }
          })
        ),
      pid: Number(child.pid),
      resource,
      stderr,
      stdin,
      stdout
    })
  })

const boundedOutputStream = (
  stream: Stream.Stream<Uint8Array, ProcessError, never>,
  streamName: "stdout" | "stderr",
  command: string,
  limitBytes: number
): Stream.Stream<Uint8Array, ProcessError, never> =>
  Stream.unwrap(
    Effect.gen(function* boundedOutputStream() {
      const queue = yield* Queue.bounded<Uint8Array, ProcessError | Cause.Done>(
        Math.max(1, limitBytes)
      )
      const queuedBytes = yield* Ref.make(0)
      const producer = yield* runOutputProducer(
        stream,
        queue,
        queuedBytes,
        streamName,
        command,
        limitBytes
      ).pipe(Effect.forkScoped)

      return Stream.fromQueue(queue).pipe(
        Stream.mapEffect((chunk) =>
          Ref.update(queuedBytes, (bytes) => Math.max(0, bytes - chunk.byteLength)).pipe(
            Effect.as(chunk)
          )
        ),
        Stream.ensuring(
          Effect.gen(function* boundedOutputStream() {
            yield* Fiber.interrupt(producer)
            yield* Queue.shutdown(queue)
          })
        )
      )
    })
  )

const runOutputProducer = (
  stream: Stream.Stream<Uint8Array, ProcessError, never>,
  queue: Queue.Queue<Uint8Array, ProcessError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  streamName: "stdout" | "stderr",
  command: string,
  limitBytes: number
): Effect.Effect<void, never, never> =>
  Effect.gen(function* runOutputProducer() {
    const exit = yield* Effect.exit(
      stream.pipe(
        Stream.runForEach((chunk) =>
          offerOutputChunk(queue, queuedBytes, streamName, command, limitBytes, chunk)
        )
      )
    )
    if (Exit.isFailure(exit)) {
      yield* Queue.fail(queue, mapCauseToProcessError(exit.cause, command, `Process.${streamName}`))
      return
    }

    yield* Queue.end(queue)
  }).pipe(
    Effect.catchCause((cause) =>
      Queue.fail(queue, mapCauseToProcessError(cause, command, `Process.${streamName}`)).pipe(
        Effect.asVoid
      )
    )
  )

const offerOutputChunk = (
  queue: Queue.Queue<Uint8Array, ProcessError | Cause.Done>,
  queuedBytes: Ref.Ref<number>,
  streamName: "stdout" | "stderr",
  command: string,
  limitBytes: number,
  chunk: Uint8Array
): Effect.Effect<void, ProcessError, never> =>
  Effect.gen(function* offerOutputChunk() {
    const currentBytes = yield* Ref.get(queuedBytes)
    if (currentBytes + chunk.byteLength > limitBytes) {
      return yield* Effect.fail(makeBackpressureOverflow(streamName, command, limitBytes, 1))
    }

    const queueFull = yield* Queue.isFull(queue)
    if (queueFull) {
      return yield* Effect.fail(makeBackpressureOverflow(streamName, command, limitBytes, 1))
    }

    yield* Ref.update(queuedBytes, (bytes) => bytes + chunk.byteLength)
    const offered = yield* Queue.offer(queue, chunk)
    if (!offered) {
      yield* Ref.update(queuedBytes, (bytes) => Math.max(0, bytes - chunk.byteLength))
      return yield* Effect.fail(makeBackpressureOverflow(streamName, command, limitBytes, 1))
    }
  })

const makeBackpressureOverflow = (
  streamName: "stdout" | "stderr",
  command: string,
  limitBytes: number,
  lostFrames: number
): HostProtocolBackpressureOverflowError =>
  new HostProtocolBackpressureOverflowError({
    lostFrames,
    policy: "error",
    tag: "BackpressureOverflow",
    ...makeProcessErrorCommon(
      "BackpressureOverflow",
      `${streamName} exceeded process buffer budget (${limitBytes} bytes): ${command}`,
      `Process.${streamName}`
    )
  })

const safeInspectorTimestamp = (now: () => number): Effect.Effect<number, never, never> => {
  const timestamp = now()
  return Number.isFinite(timestamp) && timestamp >= 0
    ? Effect.succeed(timestamp)
    : Clock.currentTimeMillis
}

const mapCauseToProcessError = (
  cause: Cause.Cause<ProcessError>,
  _command: string,
  operation: string
): ProcessError => {
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    return failure.value
  }

  const squashed = Cause.squash(cause)
  return makeHostProtocolInvalidArgumentError("command", formatUnknownError(squashed), operation)
}

const observeChildExit = (
  exitStatus: Effect.Effect<ProcessExitStatus, ProcessError, never>,
  exitState: Deferred.Deferred<ProcessExitStatus, ProcessError>,
  resource: ManagedResourceHandle<"process", "running">,
  command: string,
  completeExit: (status: ProcessExitStatus) => Effect.Effect<void, ProcessError, never>,
  disposalOrigin: Ref.Ref<ProcessDisposalOrigin>,
  exitObserved: Ref.Ref<boolean>,
  processScope: Scope.Closeable
): Effect.Effect<void, never, Scope.Scope> =>
  exitStatus.pipe(
    Effect.flatMap((status) => completeExit(status)),
    Effect.tapError((error: HostProtocolError) =>
      Effect.gen(function* observeChildExitFailure() {
        yield* Deferred.fail(exitState, error)
        yield* Ref.set(exitObserved, true)
        const origin = yield* claimObserverDisposal(disposalOrigin)
        if (origin !== "registry") {
          yield* resource.dispose()
          yield* Scope.close(processScope, Exit.void)
        }
        yield* Effect.logWarning("Process.exit observer failed", {
          command,
          reason: error.message
        })
      })
    ),
    Effect.ignore,
    Effect.forkScoped({ startImmediately: true }),
    Effect.asVoid
  )

const disposeChild = (
  child: ChildProcessSpawner.ChildProcessHandle,
  processScope: Scope.Closeable,
  command: string,
  gracefulShutdownMs: number,
  disposalOrigin: Ref.Ref<ProcessDisposalOrigin>,
  closeProcessScope: Effect.Effect<boolean, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* disposeChild() {
    const origin = yield* claimRegistryDisposal(disposalOrigin)
    if (origin === "observer") {
      return
    }
    const shouldTerminateChild = yield* closeProcessScope

    const running = yield* child.isRunning.pipe(
      Effect.mapError((error) => mapPlatformError(error, command, "Process.dispose.running")),
      Effect.catch((error: HostProtocolError) =>
        Effect.logWarning("Process.dispose.running failed", {
          command,
          reason: error.message
        }).pipe(Effect.as(false))
      )
    )
    if (running && shouldTerminateChild) {
      yield* child
        .kill({
          forceKillAfter: `${gracefulShutdownMs} millis`,
          killSignal: "SIGTERM"
        })
        .pipe(
          Effect.mapError((error) => mapPlatformError(error, command, "Process.dispose.kill")),
          Effect.tapError((error: HostProtocolError) =>
            Effect.logWarning("Process.dispose.kill failed", {
              command,
              reason: error.message
            })
          ),
          Effect.ignore
        )
    }

    yield* Scope.close(processScope, Exit.void)
  })

type ProcessDisposalOrigin = "running" | "observer" | "registry"

const claimObserverDisposal = (
  origin: Ref.Ref<ProcessDisposalOrigin>
): Effect.Effect<ProcessDisposalOrigin, never, never> =>
  Ref.modify(origin, (current) =>
    current === "running" ? (["observer", "observer"] as const) : ([current, current] as const)
  )

const claimRegistryDisposal = (
  origin: Ref.Ref<ProcessDisposalOrigin>
): Effect.Effect<ProcessDisposalOrigin, never, never> =>
  Ref.modify(origin, (current) =>
    current === "running" ? (["registry", "registry"] as const) : ([current, current] as const)
  )

const decodeSpawnInput = (
  input: unknown,
  operation: string
): Effect.Effect<ProcessSpawnInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(ProcessSpawnInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeSignalInput = (
  input: unknown,
  operation: string
): Effect.Effect<ProcessSignalInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(ProcessSignalInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("signal", formatUnknownError(error), operation)
    )
  )

const decodeStdinChunk = (
  input: unknown,
  operation: string
): Effect.Effect<Uint8Array, HostProtocolInvalidArgumentError, never> =>
  input instanceof Uint8Array
    ? Effect.succeed(input)
    : Effect.fail(makeHostProtocolInvalidArgumentError("chunk", "must be a Uint8Array", operation))

const decodeProcessTimestamp = (
  input: unknown,
  operation: string
): Effect.Effect<number, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(ProcessTimestamp)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("now", formatUnknownError(error), operation)
    )
  )

const assertProcessHandleFresh = (
  registry: ResourceRegistryApi,
  resource: ManagedResourceHandle<"process", "running">,
  operation: string
): Effect.Effect<void, HostProtocolStaleHandleError, never> =>
  registry.assertFresh(resource).pipe(
    Effect.asVoid,
    Effect.mapError((error) => makeProcessStaleHandleError(error, operation))
  )

const makeProcessStaleHandleError = (
  error: StaleHandle,
  operation: string
): HostProtocolStaleHandleError =>
  new HostProtocolStaleHandleError({
    actualGeneration: Math.max(0, error.actualGeneration),
    expectedGeneration: error.expectedGeneration,
    id: error.id,
    kind: error.kind,
    message: `stale resource handle: ${error.kind}:${error.id}`,
    operation,
    recoverable: false,
    tag: "StaleHandle"
  })

const authorizeProcessSpawn = (
  permissions: ProcessPermissionPolicy,
  input: ProcessSpawnInput
): Effect.Effect<
  void,
  HostProtocolInvalidArgumentError | HostProtocolPermissionDeniedError,
  never
> =>
  Effect.gen(function* authorizeProcessSpawn() {
    if (containsShellMetacharacter(input.command)) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "command",
          "contains shell metacharacters",
          "Process.spawn"
        )
      )
    }

    if (input.shell === true && permissions.shell !== true) {
      return yield* Effect.fail(
        makeProcessPermissionDenied("process.shell", input.command, "Process.spawn")
      )
    }

    if ((permissions.spawn ?? []).includes(input.command)) {
      return
    }

    return yield* Effect.fail(
      makeProcessPermissionDenied("process.spawn", input.command, "Process.spawn")
    )
  })

const processSnapshotList = (
  snapshots: ReadonlyMap<ResourceId, ProcessSnapshot>
): readonly ProcessSnapshot[] =>
  [...snapshots.values()].toSorted((left, right) => left.startedAt - right.startedAt)

const upsertProcessSnapshot = (
  snapshots: SubscriptionRef.SubscriptionRef<Map<ResourceId, ProcessSnapshot>>,
  id: ResourceId,
  snapshot: ProcessSnapshot,
  maxSnapshots: number
): Effect.Effect<void, never, never> =>
  SubscriptionRef.update(snapshots, (current) => {
    const next = new Map(current)
    next.set(id, snapshot)
    while (next.size > maxSnapshots) {
      const oldest = oldestProcessSnapshotId(next)
      if (oldest === undefined) {
        break
      }
      next.delete(oldest)
    }
    return next
  })

const oldestProcessSnapshotId = (
  snapshots: ReadonlyMap<ResourceId, ProcessSnapshot>
): ResourceId | undefined => {
  let oldestId: ResourceId | undefined
  let oldestStartedAt = Number.POSITIVE_INFINITY
  for (const [id, snapshot] of snapshots) {
    if (snapshot.startedAt < oldestStartedAt) {
      oldestId = id
      oldestStartedAt = snapshot.startedAt
    }
  }
  return oldestId
}

const markProcessExited = (
  snapshots: SubscriptionRef.SubscriptionRef<Map<ResourceId, ProcessSnapshot>>,
  id: ResourceId,
  status: ProcessExitStatus,
  updatedAt: number,
  operation: string
): Effect.Effect<void, HostProtocolInvalidArgumentError, never> =>
  Effect.gen(function* markProcessExited() {
    const decodedUpdatedAt = yield* decodeProcessTimestamp(updatedAt, operation)
    yield* SubscriptionRef.update(snapshots, (current) => {
      const existing = current.get(id)
      if (existing === undefined) {
        return current
      }
      const next = new Map(current)
      next.set(id, {
        ...existing,
        lastExit: Option.some(status),
        state: "exited",
        updatedAt: decodedUpdatedAt
      })
      return next
    })
  })

const validateProcessBudgets = (
  budgets: Required<ProcessBudgetPolicy>,
  operation: string
): Effect.Effect<void, HostProtocolInvalidArgumentError, never> =>
  Effect.gen(function* validateProcessBudgets() {
    yield* validatePositiveIntegerBudget("maxConcurrent", budgets.maxConcurrent, operation)
    yield* validatePositiveIntegerBudget("stdoutBufferBytes", budgets.stdoutBufferBytes, operation)
    yield* validatePositiveIntegerBudget("stderrBufferBytes", budgets.stderrBufferBytes, operation)
  })

const validatePositiveIntegerBudget = (
  field: keyof Required<ProcessBudgetPolicy>,
  value: number,
  operation: string
): Effect.Effect<void, HostProtocolInvalidArgumentError, never> =>
  Number.isSafeInteger(value) && value > 0
    ? Effect.void
    : Effect.fail(
        makeHostProtocolInvalidArgumentError(field, "must be a positive safe integer", operation)
      )

const makeProcessResourceBusy = (
  ownerScope: string,
  maxConcurrent: number,
  operation: string
): HostProtocolResourceBusyError =>
  new HostProtocolResourceBusyError({
    resource: `process:${ownerScope}`,
    tag: "ResourceBusy",
    ...makeProcessErrorCommon(
      "ResourceBusy",
      `process budget exceeded for scope ${ownerScope}: limit ${maxConcurrent}`,
      operation
    )
  })

const containsShellMetacharacter = (command: string): boolean => SHELL_METACHARACTER.test(command)

const SHELL_METACHARACTER = /[;|&><`\n]|\$\(/

const makeProcessPermissionDenied = (
  capability: "process.spawn" | "process.shell",
  resource: string,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    capability,
    resource,
    tag: "PermissionDenied",
    ...makeProcessErrorCommon("PermissionDenied", `permission denied: ${resource}`, operation)
  })

const makeChildProcessCommand = (
  input: ProcessSpawnInput,
  gracefulShutdownMs: number
): ChildProcess.StandardCommand =>
  ChildProcess.make(input.command, input.args, {
    detached: process.platform !== "win32",
    forceKillAfter: `${gracefulShutdownMs} millis`,
    killSignal: "SIGTERM",
    stderr: "pipe",
    stdin: { stream: "pipe" },
    stdout: "pipe",
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.shell === undefined ? {} : { shell: input.shell })
  })

const mapPlatformError = (
  error: PlatformError,
  command: string,
  operation: string
): HostProtocolError => {
  if (error.reason._tag === "NotFound") {
    return new HostProtocolFileNotFoundError({
      path: command,
      tag: "FileNotFound",
      ...makeProcessErrorCommon("FileNotFound", `process command not found: ${command}`, operation)
    })
  }

  if (error.reason._tag === "PermissionDenied") {
    return new HostProtocolPermissionDeniedError({
      capability: "process.spawn",
      resource: command,
      tag: "PermissionDenied",
      ...makeProcessErrorCommon(
        "PermissionDenied",
        `process command permission denied: ${command}`,
        operation
      )
    })
  }

  return makeHostProtocolInvalidArgumentError("command", error.message, operation)
}

const platformErrorSignal = (error: PlatformError): ProcessSignalInput | undefined => {
  const cause = error.cause === undefined ? "" : formatUnknownError(error.cause)
  const message = `${error.message} ${cause}`
  return PROCESS_SIGNALS.find((signal) => message.includes(signal))
}

const makeProcessErrorCommon = (
  tag: HostProtocolErrorTag,
  message: string,
  operation: string
): Pick<HostProtocolError, "message" | "operation" | "recoverable"> => ({
  message,
  operation,
  recoverable: hostProtocolErrorRecoverableDefault(tag)
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
