import {
  appendBounded,
  makeFrameworkScopedOperation,
  normalizeDesktopStreamCapacity,
  runRendererStream,
  type DesktopStreamOptions,
  type FrameworkRuntime
} from "@effect-desktop/core/renderer"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Stream, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { useEffect, useMemo, useRef, useState, type DependencyList } from "react"

import { asyncResultFromExit, runAsyncResult } from "./effect-runner.js"

export type StreamStatus = "idle" | "running" | "closed" | "failure"

export interface StreamState<A, E> {
  readonly status: StreamStatus
  readonly data: readonly A[]
  readonly error: Option.Option<Cause.Cause<E>>
}

export type { DesktopStreamOptions }

const defaultRuntime: FrameworkRuntime = ManagedRuntime.make(Layer.empty)

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

export const useDesktopStream = <A, E, R = never, ER = never>(
  stream: Stream.Stream<A, E, R>,
  options: DesktopStreamOptions<A> = {},
  runtime: FrameworkRuntime<R, ER> = defaultRuntime as FrameworkRuntime<R, ER>
): StreamState<A, E | ER> => {
  const capacity = normalizeDesktopStreamCapacity(options.capacity)
  const [state, setState] = useState<StreamState<A, E | ER>>(idle<A, E | ER>)
  const streamRef = useRef<Stream.Stream<A, E, R>>(stream)
  const onItemRef = useRef<((item: A) => void) | undefined>(options.onItem)
  streamRef.current = stream
  onItemRef.current = options.onItem

  useEffect(() => {
    setState(running<A, E>())

    return runRendererStream(
      runtime,
      streamRef.current,
      { capacity, onItem: (item) => onItemRef.current?.(item) },
      (item) => {
        setState((prev) => ({
          ...prev,
          data: appendBounded(prev.data, item, capacity)
        }))
      },
      (exit) => {
        if (Exit.isSuccess(exit)) {
          setState((prev) => ({ ...prev, status: "closed" as const, error: Option.none() }))
        } else {
          setState((prev) => ({
            ...prev,
            status: "failure" as const,
            error: Option.some(exit.cause)
          }))
        }
      }
    )
  }, [stream, capacity, runtime])

  return state
}

export const useSubscribable = <A>(ref: SubscriptionRef.SubscriptionRef<A>): A | undefined => {
  const [value, setValue] = useState<A | undefined>(undefined)
  const refRef = useRef<SubscriptionRef.SubscriptionRef<A>>(ref)
  const operation = useMemo(() => makeFrameworkScopedOperation(defaultRuntime), [])
  refRef.current = ref

  useEffect(() => {
    operation.runLatest(
      Stream.runForEach(SubscriptionRef.changes(refRef.current), (v) =>
        Effect.sync(() => {
          setValue(v)
        })
      ),
      () => undefined
    )

    return () => {
      operation.reset()
    }
  }, [operation, ref])

  useEffect(() => {
    return () => {
      operation.dispose()
    }
  }, [operation])

  return value
}

export const useEffectResult = <A, E, R = never, ER = never>(
  effect: Effect.Effect<A, E, R>,
  deps?: DependencyList,
  runtime: FrameworkRuntime<R, ER> = defaultRuntime as FrameworkRuntime<R, ER>
): AsyncResult.AsyncResult<A, E | ER> => {
  const [result, setResult] = useState<AsyncResult.AsyncResult<A, E | ER>>(
    AsyncResult.initial<A, E | ER>
  )
  const effectRef = useRef<Effect.Effect<A, E, R>>(effect)
  const operation = useMemo(() => makeFrameworkScopedOperation(runtime), [runtime])
  effectRef.current = effect

  useEffect(() => {
    return () => {
      operation.dispose()
    }
  }, [operation])

  useEffect(
    () => {
      setResult(AsyncResult.initial<A, E | ER>(true))

      operation.runLatest(runAsyncResult(effectRef.current), (exit) => {
        setResult(asyncResultFromExit(exit))
      })

      return () => {
        operation.reset()
      }
    },
    deps ?? [effect, operation]
  )

  return result
}
