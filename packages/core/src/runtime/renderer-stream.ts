import { Cause, Effect, Exit, Fiber, FiberSet, ManagedRuntime, Scope, Stream } from "effect"

export interface FrameworkRuntime<R = never, ER = never> {
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E | ER>
  readonly dispose: () => Promise<void>
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

  return Object.freeze({
    runFork: <A, E>(effect: Effect.Effect<A, E, R>) => runFork(effect),
    dispose: () => runtime.runPromise(Scope.close(scope, Exit.void))
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

export const runFrameworkPromiseExit = <R, ER, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  effect: Effect.Effect<A, E, R>
): Promise<Exit.Exit<A, E | ER>> =>
  new Promise((resolve) => {
    const fiber = runtime.runFork(effect)
    fiber.addObserver((exit) => {
      queueMicrotask(() => {
        resolve(exit)
      })
    })
  })

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
