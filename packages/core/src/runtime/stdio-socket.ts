import process from "node:process"
import { Readable } from "node:stream"
import { Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"

export const writeStdout = (chunk: string | Uint8Array): Effect.Effect<void, unknown, never> =>
  Effect.callback((resume) => {
    process.stdout.write(chunk, (error) => {
      if (error) {
        resume(Effect.fail(error))
      } else {
        resume(Effect.void)
      }
    })
  })

const acquire = Effect.acquireRelease(
  Effect.sync(() => {
    // `process.stdin` is a byte stream in this runtime entry; Node's type only
    // exposes a generic web stream at the external stdio boundary.
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
