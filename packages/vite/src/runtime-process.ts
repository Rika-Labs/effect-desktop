import { resolve } from "node:path"
import {
  makeFramedSocketConnection,
  type TransportError
} from "@effect-desktop/core/runtime/transport"
import { Effect, Exit, Scope, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Socket } from "effect/unstable/socket"

export interface RuntimeProcessOptions {
  readonly entry: string
  readonly cwd: string
  readonly env?: Record<string, string | undefined>
}

export interface RuntimeProcess {
  readonly pid: ChildProcessSpawner.ProcessId
  readonly frames: Stream.Stream<Uint8Array, TransportError, never>
  readonly send: (payload: Uint8Array) => Effect.Effect<void, TransportError, never>
  readonly exitCode: Effect.Effect<ChildProcessSpawner.ExitCode, PlatformError, never>
  readonly close: Effect.Effect<void, never, never>
}

export const makeRuntimeProcess = (
  options: RuntimeProcessOptions
): Effect.Effect<
  RuntimeProcess,
  PlatformError | TransportError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    return yield* Effect.gen(function* () {
      const entryPath = resolve(options.cwd, options.entry)
      const command = ChildProcess.make("bun", ["run", entryPath], {
        cwd: options.cwd,
        env: options.env,
        extendEnv: true,
        stdin: { stream: "pipe", endOnDone: false },
        stdout: "pipe",
        stderr: "inherit",
        killSignal: "SIGTERM",
        forceKillAfter: "2 seconds"
      })
      const child = yield* Scope.provide(command.asEffect(), scope)
      yield* Scope.addFinalizer(scope, child.kill().pipe(Effect.ignore))
      const socket = makeChildProcessSocket(child)
      const connection = yield* Scope.provide(
        makeFramedSocketConnection(socket, {}, "ViteRuntime"),
        scope
      )

      return Object.freeze({
        pid: child.pid,
        frames: connection.receive,
        send: connection.send,
        exitCode: child.exitCode,
        close: Scope.close(scope, Exit.void)
      } satisfies RuntimeProcess)
    }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
  })

const makeChildProcessSocket = (child: ChildProcessSpawner.ChildProcessHandle): Socket.Socket =>
  Socket.make({
    runRaw: (handler, options) =>
      Effect.gen(function* () {
        if (options?.onOpen) {
          yield* options.onOpen
        }
        yield* child.stdout.pipe(
          Stream.mapError((cause) => socketError(new Socket.SocketReadError({ cause }))),
          Stream.runForEach((chunk) => {
            const result = handler(chunk)
            return Effect.isEffect(result) ? result : Effect.void
          })
        )
      }),
    writer: Effect.succeed((chunk) => {
      if (Socket.isCloseEvent(chunk)) {
        return child
          .kill()
          .pipe(
            Effect.mapError(() => socketError(new Socket.SocketCloseError({ code: chunk.code })))
          )
      }
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
      return Stream.make(bytes).pipe(
        Stream.run(child.stdin),
        Effect.asVoid,
        Effect.mapError((cause) => socketError(new Socket.SocketWriteError({ cause })))
      )
    })
  })

const socketError = (reason: Socket.SocketErrorReason): Socket.SocketError =>
  new Socket.SocketError({ reason })
