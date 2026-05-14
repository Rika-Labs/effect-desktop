import { Effect, Exit, ManagedRuntime, Stream } from "effect"

export interface FrameworkRuntime<R = never, ER = never> {
  readonly runCallback: ManagedRuntime.ManagedRuntime<R, ER>["runCallback"]
  readonly runPromiseExit: ManagedRuntime.ManagedRuntime<R, ER>["runPromiseExit"]
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

export const runFrameworkEffect = <R, ER, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  effect: Effect.Effect<A, E, R>,
  onExit: (exit: Exit.Exit<A, E | ER>) => void
): (() => void) =>
  runtime.runCallback(effect, {
    onExit: (exit) => {
      queueMicrotask(() => {
        onExit(exit)
      })
    }
  })

export const runFrameworkPromiseExit = <R, ER, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  effect: Effect.Effect<A, E, R>
): Promise<Exit.Exit<A, E | ER>> => runtime.runPromiseExit(effect)

export const runRendererStream = <R, ER, A, E>(
  runtime: FrameworkRuntime<R, ER>,
  stream: Stream.Stream<A, E, R>,
  options: DesktopStreamOptions<A>,
  setChunk: (item: A) => void,
  onExit: (exit: Exit.Exit<void, E | ER>) => void
): (() => void) => {
  let active = true
  const dispose = runFrameworkEffect(
    runtime,
    Stream.runForEach(stream, (item) =>
      Effect.sync(() => {
        options.onItem?.(item)
        if (active) {
          setChunk(item)
        }
      })
    ),
    (exit) => {
      if (active) {
        onExit(exit)
      }
    }
  )

  return () => {
    active = false
    dispose()
  }
}
