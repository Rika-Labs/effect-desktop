import { Cause, Effect, Exit, Fiber, FiberSet, ManagedRuntime, Scope, Stream } from "effect"

export interface FrameworkRuntime<R = never, ER = never> {
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E | ER>
  readonly disposeEffect: Effect.Effect<void, never, never>
}

export interface FrameworkScopedOperation<R = never, ER = never> {
  readonly runLatestPromiseExit: <A, E>(
    effect: Effect.Effect<A, E, R>
  ) => Promise<readonly [Exit.Exit<A, E | ER>, boolean]>
  readonly runLatest: <A, E>(
    effect: Effect.Effect<A, E, R>,
    onExit: (exit: Exit.Exit<A, E | ER>) => void
  ) => void
  readonly reset: () => void
  readonly dispose: () => void
}

export interface DesktopStreamOptions<A> {
  readonly capacity?: number | undefined
  readonly onItem?: ((item: A) => void) | undefined
}

const DEFAULT_DESKTOP_STREAM_CAPACITY = 1024

export const appendBounded = <A>(items: readonly A[], item: A, capacity: number): readonly A[] =>
  capacity === 0 ? items : [...items, item].slice(-capacity)

export const normalizeDesktopStreamCapacity = (capacity: number | undefined): number => {
  const resolved = capacity ?? DEFAULT_DESKTOP_STREAM_CAPACITY
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError("desktop stream capacity must be a non-negative safe integer")
  }
  return resolved
}

export const isDesktopStreamOptions = <A>(value: unknown): value is DesktopStreamOptions<A> =>
  typeof value === "object" && value !== null && ("capacity" in value || "onItem" in value)

export const makeFrameworkRuntime = <R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>
): FrameworkRuntime<R, ER> => {
  const scope = runtime.runSync(Scope.make())
  const runFork = runtime.runSync(Scope.provide(FiberSet.makeRuntime<R, unknown, unknown>(), scope))
  const disposeEffect = Scope.close(scope, Exit.void)

  return Object.freeze({
    runFork: <A, E>(effect: Effect.Effect<A, E, R>) => runFork(effect),
    disposeEffect
  })
}

export const runFrameworkEffect = <R, ER, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  effect: Effect.Effect<A, E, R>,
  onExit: (exit: Exit.Exit<A, E | ER>) => void
): (() => void) => {
  const fiber = runtime.runFork(effect)
  observeFrameworkFiber(fiber, onExit)
  return () => {
    interruptFrameworkFiber(fiber)
  }
}

const awaitFrameworkFiber = <A, E>(fiber: Fiber.Fiber<A, E>): Promise<Exit.Exit<A, E>> =>
  Effect.runPromise(Fiber.await(fiber))

export const observeFrameworkFiber = <A, E>(
  fiber: Fiber.Fiber<A, E>,
  onExit: (exit: Exit.Exit<A, E>) => void
): void => {
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
      return
    }
    queueMicrotask(() => {
      onExit(exit)
    })
  })
}

export const interruptFrameworkFiber = <A, E>(fiber: Fiber.Fiber<A, E>): void => {
  Effect.runFork(Fiber.interrupt(fiber))
}

export const makeFrameworkScopedOperation = <R, ER>(
  runtime: FrameworkRuntime<R, ER>
): FrameworkScopedOperation<R, ER> => {
  let generation = 0
  let disposed = false
  let interruptLatest: (() => void) | undefined

  const interrupt = (): void => {
    interruptLatest?.()
    interruptLatest = undefined
  }

  const runLatestPromiseExit = async <A, E>(
    effect: Effect.Effect<A, E, R>
  ): Promise<readonly [Exit.Exit<A, E | ER>, boolean]> => {
    interrupt()
    const currentGeneration = generation + 1
    generation = currentGeneration
    const fiber = runtime.runFork(effect)
    interruptLatest = () => {
      interruptFrameworkFiber(fiber)
    }
    const exit = await awaitFrameworkFiber(fiber)
    if (generation === currentGeneration) {
      interruptLatest = undefined
    }
    return [exit, !disposed && generation === currentGeneration]
  }

  return {
    runLatestPromiseExit,
    runLatest: <A, E>(
      effect: Effect.Effect<A, E, R>,
      onExit: (exit: Exit.Exit<A, E | ER>) => void
    ): void => {
      interrupt()
      const currentGeneration = generation + 1
      generation = currentGeneration
      const fiber = runtime.runFork(effect)
      interruptLatest = () => {
        interruptFrameworkFiber(fiber)
      }
      observeFrameworkFiber(fiber, (exit) => {
        if (generation === currentGeneration) {
          interruptLatest = undefined
        }
        if (!disposed && generation === currentGeneration) {
          onExit(exit)
        }
      })
    },
    reset: () => {
      generation += 1
      interrupt()
    },
    dispose: () => {
      disposed = true
      generation += 1
      interrupt()
    }
  }
}

export const runRendererStream = <R, ER, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  stream: Stream.Stream<A, E, R>,
  options: DesktopStreamOptions<A>,
  setChunk: (item: A) => void,
  onExit: (exit: Exit.Exit<void, E | ER>) => void
): (() => void) => {
  const fiber = runtime.runFork(
    Stream.runForEach(stream, (item) =>
      Effect.sync(() => {
        options.onItem?.(item)
        setChunk(item)
      })
    )
  )
  observeFrameworkFiber(fiber, onExit)
  return () => {
    interruptFrameworkFiber(fiber)
  }
}
