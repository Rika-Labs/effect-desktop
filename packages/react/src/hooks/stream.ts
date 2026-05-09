import { Cause, Effect, Exit, Fiber, Option, Stream, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { useEffect, useRef, useState, type DependencyList } from "react"

export type StreamStatus = "idle" | "running" | "closed" | "failure"

export interface StreamState<A, E> {
  readonly status: StreamStatus
  readonly data: readonly A[]
  readonly error: Option.Option<Cause.Cause<E>>
}

const idle = <A, E>(): StreamState<A, E> => ({
  status: "idle",
  data: [],
  error: Option.none()
})

const running = <A, E>(): StreamState<A, E> => ({
  status: "running",
  data: [],
  error: Option.none()
})

export const useStream = <A, E>(stream: Stream.Stream<A, E, never>): StreamState<A, E> => {
  const [state, setState] = useState<StreamState<A, E>>(idle<A, E>)
  const streamRef = useRef<Stream.Stream<A, E, never>>(stream)
  streamRef.current = stream

  useEffect(() => {
    let active = true
    setState(running<A, E>())

    const fiber = Effect.runFork(
      Stream.runForEach(streamRef.current, (item) =>
        Effect.sync(() => {
          if (active) {
            setState((prev) => ({ ...prev, data: [...prev.data, item] }))
          }
        })
      )
    )

    void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
      if (!active) return
      if (Exit.isSuccess(exit)) {
        setState((prev) => ({ ...prev, status: "closed" as const, error: Option.none() }))
      } else {
        setState((prev) => ({
          ...prev,
          status: "failure" as const,
          error: Option.some(exit.cause)
        }))
      }
    })

    return () => {
      active = false
      void Effect.runPromiseExit(Fiber.interrupt(fiber))
    }
  }, [stream])

  return state
}

export const useSubscribable = <A>(ref: SubscriptionRef.SubscriptionRef<A>): A | undefined => {
  const [value, setValue] = useState<A | undefined>(undefined)
  const refRef = useRef<SubscriptionRef.SubscriptionRef<A>>(ref)
  refRef.current = ref

  useEffect(() => {
    let active = true

    const fiber = Effect.runFork(
      Stream.runForEach(SubscriptionRef.changes(refRef.current), (v) =>
        Effect.sync(() => {
          if (active) setValue(v)
        })
      )
    )

    return () => {
      active = false
      void Effect.runPromiseExit(Fiber.interrupt(fiber))
    }
  }, [ref])

  return value
}

export const useEffectResult = <A, E>(
  effect: Effect.Effect<A, E, never>,
  deps?: DependencyList
): AsyncResult.AsyncResult<A, E> => {
  const [result, setResult] = useState<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial<A, E>)
  const effectRef = useRef<Effect.Effect<A, E, never>>(effect)
  effectRef.current = effect

  useEffect(
    () => {
      let active = true
      setResult(AsyncResult.initial<A, E>(true))

      void Effect.runPromiseExit(effectRef.current).then((exit) => {
        if (!active) return
        if (Exit.isSuccess(exit)) {
          setResult(AsyncResult.success(exit.value))
        } else {
          setResult(AsyncResult.failure(exit.cause))
        }
      })

      return () => {
        active = false
      }
    },
    deps ?? [effect]
  )

  return result
}
