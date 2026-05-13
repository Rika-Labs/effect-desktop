import { resolve } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Fiber, Layer, ManagedRuntime, Semaphore, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import type { TransportError } from "@effect-desktop/core/runtime/transport"
import type { ChildProcessSpawner } from "effect/unstable/process"
import { makeRuntimeProcess, type RuntimeProcess } from "./runtime-process.js"
import {
  FRAME_DOWN_EVENT,
  FRAME_UP_EVENT,
  RUNTIME_READY_EVENT,
  RUNTIME_RESTART_EVENT
} from "./virtual-module.js"

export interface ViteDevRuntimeServer {
  readonly ws: {
    readonly send: (event: string, payload: unknown) => void
    readonly on: (event: string, handler: (payload: { readonly data: string }) => void) => void
  }
  readonly watcher: {
    readonly on: (event: "change", handler: (filePath: string) => void) => void
  }
  readonly httpServer?: {
    readonly once: (event: "close", handler: () => void) => void
  } | null
  readonly config?: {
    readonly logger?: {
      readonly error: (message: string) => void
    }
  }
}

export interface HmrControllerOptions {
  readonly entry: string
  readonly cwd: string
  readonly server: ViteDevRuntimeServer
  readonly runtime?: ManagedRuntime.ManagedRuntime<never, unknown>
  readonly processLayer?: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, never, never>
}

export interface HmrController {
  readonly process: () => RuntimeProcess | undefined
  readonly dispose: () => void
}

export const makeHmrController = (options: HmrControllerOptions): HmrController => {
  const { entry, cwd, server } = options
  const runtime = options.runtime ?? ManagedRuntime.make(Layer.empty)
  const processLayer = options.processLayer ?? NodeServices.layer
  const lifecycle = Effect.runSync(Semaphore.make(1))
  let active: ActiveRuntime | undefined
  let disposed = false

  const entryPath = resolve(cwd, entry)

  const provideProcessLayer = (
    effect: Effect.Effect<
      void,
      PlatformError | TransportError,
      ChildProcessSpawner.ChildProcessSpawner
    >
  ): Effect.Effect<void, PlatformError | TransportError, never> =>
    effect.pipe(Effect.provide(processLayer))

  const run = (
    effect: Effect.Effect<
      void,
      PlatformError | TransportError,
      ChildProcessSpawner.ChildProcessSpawner
    >
  ): void => {
    runtime.runPromise(provideProcessLayer(effect)).catch((error: unknown) => {
      reportRuntimeError(server, error)
    })
  }

  const runLifecycle = (
    effect: Effect.Effect<
      void,
      PlatformError | TransportError,
      ChildProcessSpawner.ChildProcessSpawner
    >
  ): void => {
    runtime
      .runPromise(lifecycle.withPermit(provideProcessLayer(effect)))
      .catch((error: unknown) => {
        reportRuntimeError(server, error)
      })
  }

  const restart = (): void => {
    if (disposed) {
      return
    }
    runLifecycle(
      closeActive().pipe(
        Effect.andThen(startRuntime()),
        Effect.tap(() => Effect.sync(() => server.ws.send(RUNTIME_RESTART_EVENT, {})))
      )
    )
  }

  server.ws.on(FRAME_UP_EVENT, (data: { data: string }) => {
    const bytes = Buffer.from(data.data, "base64")
    const current = active
    if (current) {
      run(current.process.send(new Uint8Array(bytes)))
    }
  })

  server.watcher.on("change", (filePath) => {
    if (filePath === entryPath) {
      restart()
    }
  })

  runLifecycle(startRuntime())

  return {
    process: () => active?.process,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      void runtime.runPromise(lifecycle.withPermit(closeActive())).finally(() => {
        if (!options.runtime) {
          void runtime.dispose()
        }
      })
    }
  }

  function startRuntime(): Effect.Effect<
    void,
    PlatformError | TransportError,
    ChildProcessSpawner.ChildProcessSpawner
  > {
    return Effect.gen(function* () {
      if (disposed) {
        return
      }
      const process = yield* makeRuntimeProcess({ entry, cwd })
      if (disposed) {
        yield* process.close
        return
      }
      active = { process }
      const frameFiber = yield* process.frames.pipe(
        Stream.runForEach((frame) =>
          Effect.sync(() => {
            server.ws.send(FRAME_DOWN_EVENT, { data: Buffer.from(frame).toString("base64") })
          })
        ),
        Effect.catch((error: TransportError) =>
          Effect.sync(() => {
            if (!disposed && active?.process === process) {
              reportRuntimeError(server, error)
            }
          })
        ),
        Effect.forkDetach({ startImmediately: true })
      )
      const exitFiber = yield* process.exitCode.pipe(
        Effect.match({
          onFailure: () => ({ code: null, signal: null }),
          onSuccess: (code) => ({ code: Number(code), signal: null })
        }),
        Effect.tap((payload) =>
          Effect.sync(() => {
            if (!disposed && active?.process === process) {
              server.ws.send("effect-desktop:runtime-exit", payload)
            }
          })
        ),
        Effect.asVoid,
        Effect.forkDetach({ startImmediately: true })
      )
      active = { process, frameFiber, exitFiber }
      server.ws.send(RUNTIME_READY_EVENT, {})
    })
  }

  function closeActive(): Effect.Effect<void, never, never> {
    return Effect.gen(function* () {
      const current = active
      active = undefined
      if (!current) {
        return
      }
      yield* current.process.close
      if (current.frameFiber) {
        yield* Fiber.interrupt(current.frameFiber).pipe(Effect.ignore)
      }
      if (current.exitFiber) {
        yield* Fiber.interrupt(current.exitFiber).pipe(Effect.ignore)
      }
    })
  }
}

interface ActiveRuntime {
  readonly process: RuntimeProcess
  readonly frameFiber?: Fiber.Fiber<void, never>
  readonly exitFiber?: Fiber.Fiber<void, never>
}

const reportRuntimeError = (server: ViteDevRuntimeServer, error: unknown): void => {
  server.config?.logger?.error(`[effect-desktop] runtime error: ${String(error)}`)
}
