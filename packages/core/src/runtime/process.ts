import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type HostProtocolErrorTag
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Ref, Schema, Sink, Stream } from "effect"

import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString

export class ProcessSpawnInput extends Schema.Class<ProcessSpawnInput>("ProcessSpawnInput")({
  command: NonEmptyString,
  args: Schema.Array(Schema.String),
  ownerScope: NonEmptyString,
  shell: Schema.optionalKey(Schema.Boolean),
  cwd: Schema.optionalKey(NonEmptyString),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
}) {}

export const ProcessSignalInput = Schema.Union([
  NonEmptyString,
  Schema.Int.check(Schema.isGreaterThan(0))
])
export type ProcessSignalInput = typeof ProcessSignalInput.Type

export class ProcessExitStatus extends Schema.Class<ProcessExitStatus>("ProcessExitStatus")({
  code: Schema.Int,
  signal: Schema.optionalKey(Schema.String)
}) {}

export type ProcessError = HostProtocolError

export interface ProcessSpawnOptions {
  readonly ownerScope: string
  readonly shell?: boolean
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

export interface ProcessHandle {
  readonly resource: ResourceHandle<"process", "running">
  readonly pid: number
  readonly stdin: Sink.Sink<void, Uint8Array, never, ProcessError, never>
  readonly stdout: Stream.Stream<Uint8Array, ProcessError, never>
  readonly stderr: Stream.Stream<Uint8Array, ProcessError, never>
  readonly exit: Effect.Effect<ProcessExitStatus, ProcessError, never>
  readonly kill: (signal?: ProcessSignalInput) => Effect.Effect<void, ProcessError, never>
}

export interface ProcessApi {
  readonly spawn: (
    command: string,
    args?: readonly string[],
    options?: ProcessSpawnOptions
  ) => Effect.Effect<ProcessHandle, ProcessError, never>
}

export interface ProcessAdapter {
  readonly spawn: (input: ProcessSpawnInput) => ProcessChild
}

export interface ProcessChild {
  readonly pid: number
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<ProcessExitStatus>
  readonly writeStdin: (chunk: Uint8Array) => Promise<void>
  readonly closeStdin: () => Promise<void>
  readonly isRunning: () => boolean
  readonly terminateTree: () => Promise<void>
  readonly forceKillTree: () => Promise<void>
  readonly kill: (signal?: ProcessSignalInput) => void
}

export interface ProcessOptions {
  readonly adapter?: ProcessAdapter
  readonly budgets?: ProcessBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly permissions?: ProcessPermissionPolicy
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
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000
const EMPTY_PROCESS_PERMISSIONS: ProcessPermissionPolicy = Object.freeze({})

export const makeProcess = (
  registry: ResourceRegistryApi,
  options: ProcessOptions = {}
): Effect.Effect<ProcessApi, never, never> =>
  Effect.gen(function* () {
    const adapter = options.adapter ?? BunProcessAdapter
    const budgets = { ...DEFAULT_PROCESS_BUDGETS, ...options.budgets }
    const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS
    const permissions = options.permissions ?? EMPTY_PROCESS_PERMISSIONS
    const processBudgets = yield* Ref.make(new Map<string, number>())

    return Object.freeze({
      spawn: (command: string, args: readonly string[] = [], options?: ProcessSpawnOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeSpawnInput(
            {
              command,
              args: Array.from(args),
              ownerScope: options?.ownerScope,
              ...(options?.shell === undefined ? {} : { shell: options.shell }),
              ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options?.env === undefined ? {} : { env: options.env })
            },
            "Process.spawn"
          )
          yield* authorizeProcessSpawn(permissions, input)
          const { child, resource } = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* reserveProcessBudget(processBudgets, input.ownerScope, budgets.maxConcurrent)
              const child = yield* Effect.try({
                try: () => adapter.spawn(input),
                catch: (error) => mapProcessError(error, input.command, "Process.spawn")
              }).pipe(Effect.tapError(() => releaseProcessBudget(processBudgets, input.ownerScope)))
              const resource = yield* registry.register({
                kind: "process",
                ownerScope: input.ownerScope,
                state: "running",
                dispose: disposeChild(child, input.command, gracefulShutdownMs).pipe(
                  Effect.andThen(releaseProcessBudget(processBudgets, input.ownerScope))
                )
              })

              return { child, resource }
            })
          )

          return makeHandle(child, resource, input.command, budgets)
        }).pipe(
          Effect.withSpan("Process.spawn", {
            attributes: { command, argc: args.length, ownerScope: options?.ownerScope ?? "" }
          })
        )
    })
  })

export class Process extends Context.Service<Process, ProcessApi>()("Process") {}

export const ProcessLive = Layer.effect(
  Process,
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    return yield* makeProcess(registry)
  })
)

export const ProcessLayer = (
  options: ProcessOptions = {}
): Layer.Layer<Process, never, ResourceRegistry> =>
  Layer.effect(
    Process,
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      return yield* makeProcess(registry, options)
    })
  )

const makeHandle = (
  child: ProcessChild,
  resource: ResourceHandle<"process", "running">,
  command: string,
  budgets: Required<ProcessBudgetPolicy>
): ProcessHandle => {
  const stdout = boundedOutputStream(
    Stream.fromReadableStream({
      evaluate: () => child.stdout,
      onError: (error) => mapProcessError(error, command, "Process.stdout"),
      releaseLockOnEnd: true
    }),
    "stdout",
    command,
    budgets.stdoutBufferBytes
  )
  const stderr = boundedOutputStream(
    Stream.fromReadableStream({
      evaluate: () => child.stderr,
      onError: (error) => mapProcessError(error, command, "Process.stderr"),
      releaseLockOnEnd: true
    }),
    "stderr",
    command,
    budgets.stderrBufferBytes
  )
  const closeStdin = Effect.tryPromise({
    try: () => child.closeStdin(),
    catch: (error) => mapProcessError(error, command, "Process.stdin.close")
  })
  const stdin = Sink.forEach((chunk: Uint8Array) =>
    Effect.tryPromise({
      try: () => child.writeStdin(chunk),
      catch: (error) => mapProcessError(error, command, "Process.stdin.write")
    })
  ).pipe(Sink.ensuring(closeStdin))
  const exitStatus = Effect.tryPromise({
    try: () => child.exited,
    catch: (error) => mapProcessError(error, command, "Process.exit")
  })
  observeChildExit(exitStatus, resource, command)
  const exit = exitStatus.pipe(Effect.tap(() => resource.dispose()))

  return Object.freeze({
    resource,
    pid: child.pid,
    stdin,
    stdout,
    stderr,
    exit,
    kill: (signal?: ProcessSignalInput) =>
      Effect.gen(function* () {
        const decodedSignal =
          signal === undefined ? undefined : yield* decodeSignalInput(signal, "Process.kill")
        yield* Effect.try({
          try: () => child.kill(decodedSignal),
          catch: (error) => mapProcessError(error, command, "Process.kill")
        })
      }).pipe(Effect.withSpan("Process.kill", { attributes: { command, pid: child.pid } }))
  })
}

const boundedOutputStream = (
  stream: Stream.Stream<Uint8Array, ProcessError, never>,
  streamName: "stdout" | "stderr",
  command: string,
  limitBytes: number
): Stream.Stream<Uint8Array, ProcessError, never> => {
  let bufferedBytes = 0
  return stream.pipe(
    Stream.mapEffect((chunk) =>
      Effect.gen(function* () {
        const nextBytes = bufferedBytes + chunk.byteLength
        if (nextBytes > limitBytes) {
          return yield* Effect.fail(makeBackpressureOverflow(streamName, command, limitBytes, 1))
        }

        bufferedBytes = nextBytes
        return chunk
      })
    )
  )
}

const makeBackpressureOverflow = (
  streamName: "stdout" | "stderr",
  command: string,
  limitBytes: number,
  lostFrames: number
): HostProtocolBackpressureOverflowError =>
  new HostProtocolBackpressureOverflowError({
    tag: "BackpressureOverflow",
    policy: "error",
    lostFrames,
    ...makeProcessErrorCommon(
      "BackpressureOverflow",
      `${streamName} exceeded process buffer budget (${limitBytes} bytes): ${command}`,
      `Process.${streamName}`
    )
  })

const observeChildExit = (
  exitStatus: Effect.Effect<ProcessExitStatus, ProcessError, never>,
  resource: ResourceHandle<"process", "running">,
  command: string
): void => {
  Effect.runFork(
    exitStatus.pipe(
      Effect.flatMap(() => resource.dispose()),
      Effect.catch((error: HostProtocolError) =>
        Effect.logWarning("Process.exit observer failed", {
          command,
          reason: error.message
        })
      )
    )
  )
}

const disposeChild = (
  child: ProcessChild,
  command: string,
  gracefulShutdownMs: number
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (child.isRunning()) {
      yield* requestTreeShutdown(child, command)
      const gracefulExit = yield* waitForChildExit(child, command, gracefulShutdownMs)

      if (Option.isNone(gracefulExit) && child.isRunning()) {
        yield* forceTreeShutdown(child, command)
        const forcedExit = yield* waitForChildExit(child, command, gracefulShutdownMs)
        if (Option.isNone(forcedExit) && child.isRunning()) {
          yield* Effect.logWarning("Process.dispose.forceKill timed out", {
            command,
            gracefulShutdownMs
          })
        }
      }
    }

    yield* Effect.tryPromise({
      try: () => child.closeStdin(),
      catch: (error) => mapProcessError(error, command, "Process.dispose.stdin")
    }).pipe(
      Effect.catch((error: HostProtocolError) =>
        Effect.logWarning("Process.dispose.stdin failed", {
          command,
          reason: error.message
        })
      )
    )
  })

const requestTreeShutdown = (
  child: ProcessChild,
  command: string
): Effect.Effect<void, never, never> =>
  Effect.tryPromise({
    try: () => child.terminateTree(),
    catch: (error) => mapProcessError(error, command, "Process.dispose.terminateTree")
  }).pipe(
    Effect.catch((error: HostProtocolError) =>
      Effect.logWarning("Process.dispose.terminateTree failed", {
        command,
        reason: error.message
      })
    )
  )

const forceTreeShutdown = (
  child: ProcessChild,
  command: string
): Effect.Effect<void, never, never> =>
  Effect.tryPromise({
    try: () => child.forceKillTree(),
    catch: (error) => mapProcessError(error, command, "Process.dispose.forceKillTree")
  }).pipe(
    Effect.catch((error: HostProtocolError) =>
      Effect.logWarning("Process.dispose.forceKillTree failed", {
        command,
        reason: error.message
      })
    )
  )

const waitForChildExit = (
  child: ProcessChild,
  command: string,
  gracefulShutdownMs: number
): Effect.Effect<Option.Option<ProcessExitStatus>, never, never> =>
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: () => child.exited,
      catch: (error) => mapProcessError(error, command, "Process.dispose.wait")
    }).pipe(Effect.timeoutOption(`${gracefulShutdownMs} millis`))
  }).pipe(
    Effect.catch((error: HostProtocolError) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("Process.dispose.wait failed", {
          command,
          reason: error.message
        })
        return Option.none<ProcessExitStatus>()
      })
    )
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

const authorizeProcessSpawn = (
  permissions: ProcessPermissionPolicy,
  input: ProcessSpawnInput
): Effect.Effect<
  void,
  HostProtocolInvalidArgumentError | HostProtocolPermissionDeniedError,
  never
> =>
  Effect.gen(function* () {
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

const reserveProcessBudget = (
  processBudgets: Ref.Ref<Map<string, number>>,
  ownerScope: string,
  maxConcurrent: number
): Effect.Effect<void, HostProtocolResourceBusyError, never> =>
  Effect.gen(function* () {
    const reserved = yield* Ref.modify(processBudgets, (current) => {
      const runningProcesses = current.get(ownerScope) ?? 0
      if (runningProcesses >= maxConcurrent) {
        return [false, current] as const
      }
      const next = new Map(current)
      next.set(ownerScope, runningProcesses + 1)
      return [true, next] as const
    })

    if (reserved) {
      return
    }

    return yield* Effect.fail(makeProcessResourceBusy(ownerScope, maxConcurrent, "Process.spawn"))
  })

const releaseProcessBudget = (
  processBudgets: Ref.Ref<Map<string, number>>,
  ownerScope: string
): Effect.Effect<void, never, never> =>
  Ref.update(processBudgets, (current) => {
    const runningProcesses = current.get(ownerScope) ?? 0
    if (runningProcesses <= 1) {
      const next = new Map(current)
      next.delete(ownerScope)
      return next
    }

    const next = new Map(current)
    next.set(ownerScope, runningProcesses - 1)
    return next
  })

const makeProcessResourceBusy = (
  ownerScope: string,
  maxConcurrent: number,
  operation: string
): HostProtocolResourceBusyError =>
  new HostProtocolResourceBusyError({
    tag: "ResourceBusy",
    resource: `process:${ownerScope}`,
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
    tag: "PermissionDenied",
    capability,
    resource,
    ...makeProcessErrorCommon("PermissionDenied", `permission denied: ${resource}`, operation)
  })

const BunProcessAdapter: ProcessAdapter = {
  spawn: (input) => {
    let resolveExit: (status: ProcessExitStatus) => void
    let rejectExit: (error: unknown) => void
    const exited = new Promise<ProcessExitStatus>((resolve, reject) => {
      resolveExit = resolve
      rejectExit = reject
    })

    const subprocess = Bun.spawn({
      cmd: [input.command, ...input.args],
      // POSIX detached children get their own process group. Windows tree
      // cleanup uses taskkill /T at the adapter boundary.
      detached: process.platform !== "win32",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.env === undefined ? {} : { env: input.env }),
      onExit: (_subprocess, code, signal, error) => {
        if (error !== undefined) {
          rejectExit(error)
          return
        }

        resolveExit(
          new ProcessExitStatus({
            code: code ?? 0,
            ...(signal === null ? {} : { signal: signalName(signal) })
          })
        )
      }
    })

    return Object.freeze({
      pid: subprocess.pid,
      stdout: subprocess.stdout,
      stderr: subprocess.stderr,
      exited,
      writeStdin: async (chunk: Uint8Array) => {
        await subprocess.stdin.write(chunk)
      },
      closeStdin: async () => {
        await subprocess.stdin.end()
      },
      isRunning: () => subprocess.exitCode === null && !subprocess.killed,
      terminateTree: async () => {
        terminateProcessTree(subprocess.pid, "SIGTERM")
      },
      forceKillTree: async () => {
        await forceKillProcessTree(subprocess.pid)
      },
      kill: (signal?: ProcessSignalInput) => {
        subprocess.kill(signal as number | NodeJS.Signals | undefined)
      }
    })
  }
}

const signalName = (signal: number): string => SIGNAL_NAMES[signal] ?? String(signal)

const SIGNAL_NAMES: Readonly<Record<number, string>> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  6: "SIGABRT",
  9: "SIGKILL",
  15: "SIGTERM"
}

const terminateProcessTree = (pid: number, signal: NodeJS.Signals): void => {
  if (process.platform === "win32") {
    process.kill(pid, signal)
    return
  }

  process.kill(-pid, signal)
}

const forceKillProcessTree = async (pid: number): Promise<void> => {
  if (process.platform === "win32") {
    await runTaskkill(pid)
    return
  }

  process.kill(-pid, "SIGKILL")
}

const runTaskkill = async (pid: number): Promise<void> => {
  const subprocess = Bun.spawn({
    cmd: ["taskkill", "/PID", String(pid), "/T", "/F"],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore"
  })
  const code = await subprocess.exited
  if (code !== 0) {
    throw new Error(`taskkill exited with code ${code}`)
  }
}

const mapProcessError = (error: unknown, command: string, operation: string): HostProtocolError => {
  if (isNodeError(error)) {
    switch (error.code) {
      case "ENOENT":
        return new HostProtocolFileNotFoundError({
          tag: "FileNotFound",
          path: command,
          ...makeProcessErrorCommon(
            "FileNotFound",
            `process command not found: ${command}`,
            operation
          )
        })
      case "EACCES":
      case "EPERM":
        return new HostProtocolPermissionDeniedError({
          tag: "PermissionDenied",
          capability: "process.spawn",
          resource: command,
          ...makeProcessErrorCommon(
            "PermissionDenied",
            `process command permission denied: ${command}`,
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

const makeProcessErrorCommon = (
  tag: HostProtocolErrorTag,
  message: string,
  operation: string
): Pick<HostProtocolError, "message" | "operation" | "recoverable"> => ({
  message,
  operation,
  recoverable: hostProtocolErrorRecoverableDefault(tag)
})

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error && "message" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
