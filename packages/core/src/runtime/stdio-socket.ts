import { Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"

const acquire = Effect.acquireRelease(
  Effect.sync(() => {
    const readable = Bun.stdin.stream() as ReadableStream<Uint8Array>

    const writable = new WritableStream<Uint8Array>({
      async write(chunk) {
        await Bun.write(Bun.stdout, chunk)
      }
    })

    return { readable, writable }
  }),
  () => Effect.void
)

export const layerStdioSocket: Layer.Layer<Socket.Socket> = Layer.effect(
  Socket.Socket,
  Socket.fromTransformStream(acquire)
)
