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
import { Cause, Context, Effect, Exit, Layer, Option, Ref, Schema, Stream } from "effect"

import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export class PtyOpenInput extends Schema.Class<PtyOpenInput>("PtyOpenInput")({
  command: NonEmptyString,
  args: Schema.Array(Schema.String),
  ownerScope: NonEmptyString,
  rows: PositiveInt,
  cols: PositiveInt,
  cwd: Schema.optionalKey(NonEmptyString),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
}) {}

export class PtyResizeInput extends Schema.Class<PtyResizeInput>("PtyResizeInput")({
  rows: PositiveInt,
  cols: PositiveInt
}) {}

export const PtySignalInput = Schema.Union([
  NonEmptyString,
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
}

export interface PtyPermissionPolicy {
  readonly spawn?: readonly string[]
}

const DEFAULT_PTY_BUDGETS: Required<PtyBudgetPolicy> = Object.freeze({
  maxConcurrent: 16,
  outputBufferBytes: 1_048_576
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
          const { child, resource } = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* reservePtyBudget(ptyBudgets, input.ownerScope, budgets.maxConcurrent)
              const child = yield* Effect.try({
                try: () => adapter.open(input),
                catch: (error) => mapPtyError(error, input.command, "PTY.open")
              }).pipe(Effect.tapError(() => releasePtyBudget(ptyBudgets, input.ownerScope)))
              const resource = yield* registry.register({
                kind: "pty",
                ownerScope: input.ownerScope,
                state: "running",
                dispose: disposeChild(child, input.command, gracefulShutdownMs).pipe(
                  Effect.andThen(releasePtyBudget(ptyBudgets, input.ownerScope))
                )
              })

              return { child, resource }
            })
          )

          return makeHandle(child, resource, input.command, budgets)
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
): PtyHandle => {
  const output = boundedOutputStream(
    Stream.fromReadableStream({
      evaluate: () => child.output,
      onError: (error) => mapPtyError(error, command, "PTY.output"),
      releaseLockOnEnd: true
    }),
    command,
    budgets.outputBufferBytes
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
}

const boundedOutputStream = (
  stream: Stream.Stream<Uint8Array, PtyError, never>,
  command: string,
  limitBytes: number
): Stream.Stream<Uint8Array, PtyError, never> => {
  let bufferedBytes = 0
  return stream.pipe(
    Stream.mapEffect((chunk) =>
      Effect.gen(function* () {
        const nextBytes = bufferedBytes + chunk.byteLength
        if (nextBytes > limitBytes) {
          return yield* Effect.fail(makeBackpressureOverflow(command, limitBytes, 1))
        }

        bufferedBytes = nextBytes
        return chunk
      })
    )
  )
}

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
        try: () => child.kill("SIGTERM"),
        catch: (error) => mapPtyError(error, command, "PTY.dispose.kill")
      }).pipe(
        Effect.catch((error: HostProtocolError) =>
          Effect.logWarning("PTY.dispose.kill failed", {
            command,
            reason: error.message
          })
        )
      )
      const gracefulExit = yield* waitForChildExit(child, command, gracefulShutdownMs)
      if (Option.isNone(gracefulExit) && child.isRunning()) {
        yield* Effect.logWarning("PTY.dispose.wait timed out", {
          command,
          gracefulShutdownMs
        })
      }
    }
  })

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
