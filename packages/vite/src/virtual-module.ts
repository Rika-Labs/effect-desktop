export const VIRTUAL_MODULE_ID = "virtual:effect-desktop/runtime"
export const RESOLVED_VIRTUAL_MODULE_ID = "\0virtual:effect-desktop/runtime"

export const FRAME_UP_EVENT = "effect-desktop:frame-up"
export const FRAME_DOWN_EVENT = "effect-desktop:frame-down"
export const RUNTIME_READY_EVENT = "effect-desktop:runtime-ready"
export const RUNTIME_RESTART_EVENT = "effect-desktop:runtime-restart"

export const buildVirtualModuleSource = (): string => `
import { Socket } from "effect/unstable/socket"
import { Deferred, Effect, Layer, Queue } from "effect"

const FRAME_DOWN = ${JSON.stringify(FRAME_DOWN_EVENT)}
const FRAME_UP = ${JSON.stringify(FRAME_UP_EVENT)}
const RUNTIME_READY = ${JSON.stringify(RUNTIME_READY_EVENT)}

const fromBase64 = (b64) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const toBase64 = (bytes) => {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

const makeDevSocket = () =>
  Effect.gen(function* () {
    const inbound = yield* Queue.unbounded()
    const closeSignal = yield* Deferred.make()

    const runRaw = (handler, opts) =>
      Effect.gen(function* () {
        if (import.meta.hot) {
          const ready = yield* Effect.async((resume) => {
            import.meta.hot.on(RUNTIME_READY, () => resume(Effect.void))
            import.meta.hot.on(FRAME_DOWN, ({ data }) => {
              const bytes = fromBase64(data)
              Effect.runFork(Queue.offer(inbound, bytes))
            })
          })
        }

        if (opts?.onOpen) yield* opts.onOpen

        while (true) {
          const item = yield* Effect.race(
            Queue.take(inbound),
            Deferred.await(closeSignal).pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  new Socket.SocketError({
                    reason: new Socket.SocketCloseError({ code: 1000 })
                  })
                )
              )
            )
          )
          const result = handler(item)
          if (Effect.isEffect(result)) yield* result
        }
      })

    const write = (chunk) => {
      if (Socket.isCloseEvent(chunk)) {
        return Deferred.complete(closeSignal, Effect.void).pipe(Effect.asVoid)
      }
      return Effect.sync(() => {
        const data = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk)
        if (import.meta.hot) {
          import.meta.hot.send(FRAME_UP, { data: toBase64(data) })
        }
      })
    }

    const writer = Effect.acquireRelease(Effect.succeed(write), () => Effect.void)

    return Socket.make({ runRaw, writer })
  })

export const layerDevSocket = Layer.effect(Socket.Socket, makeDevSocket())

if (import.meta.hot) {
  import.meta.hot.on(${JSON.stringify(RUNTIME_RESTART_EVENT)}, () => {
    import.meta.hot?.invalidate()
  })
}
`
