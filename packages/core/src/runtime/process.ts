import {
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  hostProtocolErrorRecoverableDefault,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
  type HostProtocolErrorTag
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema, Sink, Stream } from "effect"

import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString

export class ProcessSpawnInput extends Schema.Class<ProcessSpawnInput>("ProcessSpawnInput")({
  command: NonEmptyString,
  args: Schema.Array(Schema.String),
  ownerScope: NonEmptyString,
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
  readonly gracefulShutdownMs?: number
}

const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000

export const makeProcess = (
  registry: ResourceRegistryApi,
  options: ProcessOptions = {}
): Effect.Effect<ProcessApi, never, never> =>
  Effect.sync(() => {
    const adapter = options.adapter ?? BunProcessAdapter
    const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS

    return Object.freeze({
      spawn: (command: string, args: readonly string[] = [], options?: ProcessSpawnOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeSpawnInput(
            {
              command,
              args: Array.from(args),
              ownerScope: options?.ownerScope,
              ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(options?.env === undefined ? {} : { env: options.env })
            },
            "Process.spawn"
          )
          const child = yield* Effect.try({
            try: () => adapter.spawn(input),
            catch: (error) => mapProcessError(error, input.command, "Process.spawn")
          })
          const resource = yield* registry.register({
            kind: "process",
            ownerScope: input.ownerScope,
            state: "running",
            dispose: disposeChild(child, input.command, gracefulShutdownMs)
          })

          return makeHandle(child, resource, input.command)
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
  command: string
): ProcessHandle => {
  const stdout = Stream.fromReadableStream({
    evaluate: () => child.stdout,
    onError: (error) => mapProcessError(error, command, "Process.stdout"),
    releaseLockOnEnd: true
  })
  const stderr = Stream.fromReadableStream({
    evaluate: () => child.stderr,
    onError: (error) => mapProcessError(error, command, "Process.stderr"),
    releaseLockOnEnd: true
  })
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
