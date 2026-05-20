import process from "node:process"
import { Readable } from "node:stream"
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
    const readable = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>

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
