import { Buffer } from "node:buffer"
import process from "node:process"
import { Data, Effect, Layer, Logger } from "effect"
import { Socket } from "effect/unstable/socket"

export class StdoutWriteError extends Data.TaggedError("StdoutWriteError")<{
  readonly cause: unknown
}> {}

const ConsoleStdoutReserved = Symbol.for("@orika/core/runtime/stdio-stdout-reserved")

export const writeStdout = (
  chunk: string | Uint8Array
): Effect.Effect<void, StdoutWriteError, never> =>
  Effect.callback((resume) => {
    reserveConsoleStdoutForProtocol()
    process.stdout.write(chunk, (error) => {
      if (error === undefined || error === null) {
        resume(Effect.void)
      } else {
        resume(Effect.fail(new StdoutWriteError({ cause: error })))
      }
    })
  })

const acquire = Effect.acquireRelease(
  Effect.sync(() => {
    reserveConsoleStdoutForProtocol()

    const readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        process.stdin.on("data", (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
        })
        process.stdin.once("end", () => {
          controller.close()
        })
        process.stdin.once("error", (cause) => {
          controller.error(cause)
        })
      }
    })

    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => Effect.runPromise(writeStdout(chunk))
    })

    return { readable, writable }
  }),
  () => Effect.void
)

const reserveConsoleStdoutForProtocol = (): void => {
  const protocolConsole = globalThis["console"]
  if (Reflect.get(protocolConsole, ConsoleStdoutReserved) === true) {
    return
  }

  // After runtime.ready, stdout is the length-prefixed host protocol channel.
  const stderr = protocolConsole.error.bind(protocolConsole)
  protocolConsole.log = stderr
  protocolConsole.info = stderr
  protocolConsole.debug = stderr
  protocolConsole.table = stderr
  protocolConsole.dir = stderr
  protocolConsole.dirxml = stderr

  Object.defineProperty(protocolConsole, ConsoleStdoutReserved, {
    configurable: false,
    enumerable: false,
    value: true
  })
}

const stdioSocketLayer: Layer.Layer<Socket.Socket> = Layer.effect(
  Socket.Socket,
  Socket.fromTransformStream(acquire)
)

export const layerStdioSocket: Layer.Layer<Socket.Socket> = Layer.merge(
  stdioSocketLayer,
  Layer.succeed(Logger.LogToStderr, true)
)
