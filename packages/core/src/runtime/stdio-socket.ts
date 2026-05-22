import { Buffer } from "node:buffer"
import process from "node:process"
import { Data, Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"

export class StdoutWriteError extends Data.TaggedError("StdoutWriteError")<{
  readonly cause: unknown
}> {}

export const writeStdout = (
  chunk: string | Uint8Array
): Effect.Effect<void, StdoutWriteError, never> =>
  Effect.callback((resume) => {
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

export const layerStdioSocket: Layer.Layer<Socket.Socket> = Layer.effect(
  Socket.Socket,
  Socket.fromTransformStream(acquire)
)
