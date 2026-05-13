import { Effect, Exit, Fiber, Stream } from "effect"

export interface DesktopStreamOptions<A> {
  readonly capacity?: number | undefined
  readonly onItem?: ((item: A) => void) | undefined
}

const DEFAULT_DESKTOP_STREAM_CAPACITY = 1024

export const appendBounded = <A>(
  items: readonly A[],
  item: A,
  capacity: number
): readonly A[] => (capacity === 0 ? items : [...items, item].slice(-capacity))

export const normalizeDesktopStreamCapacity = (capacity: number | undefined): number => {
  const resolved = capacity ?? DEFAULT_DESKTOP_STREAM_CAPACITY
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError("desktop stream capacity must be a non-negative safe integer")
  }
  return resolved
}

export const isDesktopStreamOptions = <A>(value: unknown): value is DesktopStreamOptions<A> =>
  typeof value === "object" &&
  value !== null &&
  ("capacity" in value || "onItem" in value)

export const runRendererStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  options: DesktopStreamOptions<A>,
  setChunk: (item: A) => void,
  onExit: (exit: Exit.Exit<void, E>) => void
): (() => void) => {
  let active = true
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (item) =>
      Effect.sync(() => {
        options.onItem?.(item)
        if (active) {
          setChunk(item)
        }
      })
    )
  )

  void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
    if (active) {
      onExit(exit)
    }
  })

  return () => {
    active = false
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
  }
}
