import { NodeServices } from "@effect/platform-node"
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Path,
  Scope,
  Semaphore,
  Stream
} from "effect"
import type { PlatformError } from "effect/PlatformError"
import type { TransportError } from "@orika/core/runtime/transport"
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
    readonly off: (event: string, handler: (payload: { readonly data: string }) => void) => void
  }
  readonly transformRequest?: (
    url: string,
    options?: { readonly ssr?: boolean }
  ) => Promise<unknown>
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
  readonly processLayer?: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, never, never>
}

export interface HmrController {
  readonly process: () => RuntimeProcess | undefined
  readonly handleHotUpdate: (filePath: string, modules: readonly RuntimeHotUpdateModule[]) => void
  readonly dispose: () => void
}

export interface RuntimeHotUpdateModule {
  readonly id: string | null
  readonly file: string | null
  readonly importers: ReadonlySet<RuntimeHotUpdateModule>
}

export const makeHmrController = (options: HmrControllerOptions): HmrController => {
  const { entry, cwd, server } = options
  const processLayer = options.processLayer ?? NodeServices.layer
  const processRuntime = ManagedRuntime.make(Layer.mergeAll(Path.layer, processLayer))
  const lifecycle = Effect.runSync(Semaphore.make(1))
  const listenerScope = Effect.runSync(Scope.make())
  let active: ActiveRuntime | undefined
  let disposed = false

  const entryPath = processRuntime.runSync(
    Effect.gen(function* () {
      const path = yield* Path.Path
      return path.resolve(cwd, entry)
    })
  )
  const normalizedEntryPath = normalizeFilePath(entryPath)

  const run = (
    effect: Effect.Effect<
      void,
      PlatformError | TransportError,
      ChildProcessSpawner.ChildProcessSpawner
    >
  ): void => {
    void processRuntime.runCallback(effect, {
      onExit: (exit) => {
        reportRuntimeExit(server, exit)
      }
    })
  }

  const runLifecycle = (
    effect: Effect.Effect<
      void,
      PlatformError | TransportError,
      ChildProcessSpawner.ChildProcessSpawner
    >
  ): void => {
    void processRuntime.runCallback(lifecycle.withPermit(effect), {
      onExit: (exit) => {
        reportRuntimeExit(server, exit)
      }
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

  const handleFrameUp = (data: { readonly data: string }): void => {
    const bytes = Buffer.from(data.data, "base64")
    const current = active
    if (current !== undefined) {
      run(current.process.send(new Uint8Array(bytes)))
    }
  }

  const handleHotUpdate = (filePath: string, modules: readonly RuntimeHotUpdateModule[]): void => {
    if (normalizeFilePath(filePath) === normalizedEntryPath) {
      restart()
      return
    }
    if (modules.some((module) => reachesRuntimeEntry(module, normalizedEntryPath))) {
      restart()
    }
  }

  Effect.runSync(
    Scope.addFinalizer(
      listenerScope,
      Effect.sync(() => {
        server.ws.off(FRAME_UP_EVENT, handleFrameUp)
      })
    )
  )
  server.ws.on(FRAME_UP_EVENT, handleFrameUp)

  runLifecycle(startRuntime())

  return {
    process: () => active?.process,
    handleHotUpdate,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      void processRuntime.runCallback(
        lifecycle.withPermit(
          closeActive().pipe(Effect.andThen(Scope.close(listenerScope, Exit.void)))
        ),
        {
          onExit: (exit) => {
            reportRuntimeExit(server, exit)
            void processRuntime.dispose()
          }
        }
      )
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
      const process = yield* makeRuntimeProcess({ entryPath, cwd })
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
        Effect.tapError((error: TransportError) =>
          Effect.sync(() => {
            if (!disposed && active?.process === process) {
              reportRuntimeError(server, error)
            }
          })
        ),
        Effect.ignore,
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
      refreshRuntimeGraph()
    })
  }

  function refreshRuntimeGraph(): void {
    const transformRequest = server.transformRequest
    if (transformRequest === undefined) {
      return
    }
    void transformRequest(entryPath, { ssr: true }).catch((error: unknown) => {
      reportRuntimeError(server, error)
    })
  }

  function closeActive(): Effect.Effect<void, never, never> {
    return Effect.gen(function* () {
      const current = active
      active = undefined
      if (current === undefined) {
        return
      }
      yield* current.process.close
      if (current.frameFiber !== undefined) {
        yield* Fiber.interrupt(current.frameFiber).pipe(Effect.ignore)
      }
      if (current.exitFiber !== undefined) {
        yield* Fiber.interrupt(current.exitFiber).pipe(Effect.ignore)
      }
    })
  }
}

const reachesRuntimeEntry = (
  module: RuntimeHotUpdateModule,
  normalizedEntryPath: string,
  seen = new Set<RuntimeHotUpdateModule>()
): boolean => {
  if (seen.has(module)) {
    return false
  }
  seen.add(module)
  if (moduleMatchesPath(module, normalizedEntryPath)) {
    return true
  }
  for (const importer of module.importers) {
    if (reachesRuntimeEntry(importer, normalizedEntryPath, seen)) {
      return true
    }
  }
  return false
}

const moduleMatchesPath = (module: RuntimeHotUpdateModule, normalizedPath: string): boolean =>
  normalizeOptionalFilePath(module.id) === normalizedPath ||
  normalizeOptionalFilePath(module.file) === normalizedPath

const normalizeOptionalFilePath = (path: string | null): string | null =>
  path === null ? null : normalizeFilePath(path)

const normalizeFilePath = (path: string): string => path.replaceAll("\\", "/")

interface ActiveRuntime {
  readonly process: RuntimeProcess
  readonly frameFiber?: Fiber.Fiber<void, never>
  readonly exitFiber?: Fiber.Fiber<void, never>
}

const reportRuntimeError = (server: ViteDevRuntimeServer, error: unknown): void => {
  server.config?.logger?.error(`[effect-desktop] runtime error: ${String(error)}`)
}

const reportRuntimeExit = (server: ViteDevRuntimeServer, exit: Exit.Exit<void, unknown>): void => {
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    reportRuntimeError(server, Cause.squash(exit.cause))
  }
}
