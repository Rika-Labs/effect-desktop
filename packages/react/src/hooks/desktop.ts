import {
  makeFrameworkScopedOperation,
  runFrameworkEffect,
  runFrameworkPromiseExit,
  type FrameworkRuntime
} from "@effect-desktop/core/renderer"
import { Effect, Exit, Layer, ManagedRuntime, type Cause } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList } from "react"

import {
  asyncResultFromExit,
  asyncResultStatusOf,
  runAsyncResult,
  type AsyncResultStatus
} from "./effect-runner.js"

export type DesktopAsyncStatus = AsyncResultStatus

export type DesktopAsyncState<A, E> = AsyncResult.AsyncResult<A, E>

export type DesktopActionConcurrency = "drop" | "replace" | "queue"

export interface DesktopActionOptions {
  readonly concurrency?: DesktopActionConcurrency | undefined
}

export interface DesktopAction<Args extends readonly unknown[], A, E> {
  readonly state: DesktopAsyncState<A, E>
  readonly status: DesktopAsyncStatus
  readonly run: (...args: Args) => void
  readonly cancel: () => void
  readonly reset: () => void
}

export interface DesktopQuery<A, E> {
  readonly state: DesktopAsyncState<A, E>
  readonly status: DesktopAsyncStatus
  readonly reload: () => void
  readonly cancel: () => void
  readonly reset: () => void
}

export interface DesktopResourceState<E> {
  readonly status: "idle" | "active" | "disposed" | "failure"
  readonly error: Cause.Cause<E> | undefined
}

export interface DesktopDisposable<E = never> {
  readonly dispose: () => Effect.Effect<void, E, never>
}

const defaultRuntime: FrameworkRuntime = ManagedRuntime.make(Layer.empty)

const idle = <A, E>(): DesktopAsyncState<A, E> => AsyncResult.initial<A, E>()
const running = <A, E>(): DesktopAsyncState<A, E> => AsyncResult.initial<A, E>(true)

export const statusOf = <A, E>(state: DesktopAsyncState<A, E>): DesktopAsyncStatus =>
  asyncResultStatusOf(state)

export const useDesktopAction = <Args extends readonly unknown[], A, E>(
  operation: (...args: Args) => Effect.Effect<A, E, never>,
  options: DesktopActionOptions = {}
): DesktopAction<Args, A, E> => {
  const concurrency = options.concurrency ?? "drop"
  const operationRef = useRef(operation)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  const interruptRef = useRef<(() => void) | undefined>(undefined)
  const runIdRef = useRef(0)
  const queueRef = useRef<Args[]>([])
  const [state, setState] = useState<DesktopAsyncState<A, E>>(idle<A, E>)

  operationRef.current = operation

  const start = useCallback((args: Args): void => {
    runningRef.current = true
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setState(running<A, E>())

    const interrupt = runFrameworkEffect(
      defaultRuntime,
      runAsyncResult(operationRef.current(...args)),
      (exit) => {
        if (!mountedRef.current || runId !== runIdRef.current) {
          return
        }

        interruptRef.current = undefined
        runningRef.current = false

        setState(asyncResultFromExit(exit))

        const next = queueRef.current.shift()
        if (next !== undefined) {
          start(next)
        }
      }
    )
    interruptRef.current = interrupt
  }, [])

  const cancel = useCallback((): void => {
    const interrupt = interruptRef.current
    if (interrupt === undefined) {
      return
    }

    interrupt()
  }, [])

  const run = useCallback(
    (...args: Args): void => {
      if (!runningRef.current) {
        start(args)
        return
      }

      switch (concurrency) {
        case "drop":
          return
        case "replace":
          cancel()
          start(args)
          return
        case "queue":
          queueRef.current.push(args)
          return
      }
    },
    [cancel, concurrency, start]
  )

  const reset = useCallback((): void => {
    queueRef.current = []
    setState(idle<A, E>())
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const interrupt = interruptRef.current
      if (interrupt !== undefined) {
        interrupt()
      }
    }
  }, [])

  return {
    state,
    status: statusOf(state),
    run,
    cancel,
    reset
  }
}

export const useDesktopQuery = <A, E>(
  operation: () => Effect.Effect<A, E, never>,
  deps?: DependencyList
): DesktopQuery<A, E> => {
  const operationRef = useRef(operation)
  const interruptRef = useRef<(() => void) | undefined>(undefined)
  const queryOperation = useMemo(() => makeFrameworkScopedOperation(defaultRuntime), [])
  const [reloads, setReloads] = useState(0)
  const [state, setState] = useState<DesktopAsyncState<A, E>>(idle<A, E>)

  operationRef.current = operation

  const cancel = useCallback((): void => {
    const interrupt = interruptRef.current
    if (interrupt === undefined) {
      return
    }

    interrupt()
  }, [])

  const reload = useCallback((): void => {
    setReloads((value) => value + 1)
  }, [])

  const reset = useCallback((): void => {
    setState(idle<A, E>())
  }, [])

  useEffect(
    () => {
      setState(running<A, E>())

      queryOperation.runLatest(runAsyncResult(operationRef.current()), (exit) => {
        interruptRef.current = undefined
        setState(asyncResultFromExit(exit))
      })
      interruptRef.current = queryOperation.reset

      return () => {
        queryOperation.reset()
      }
    },
    deps === undefined ? [reloads] : [...deps, reloads]
  )

  useEffect(() => {
    return () => {
      queryOperation.dispose()
    }
  }, [queryOperation])

  return {
    state,
    status: statusOf(state),
    reload,
    cancel,
    reset
  }
}

export const useDesktopResource = <E>(
  resource: DesktopDisposable<E> | undefined,
  deps?: DependencyList
): DesktopResourceState<E> => {
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const [state, setState] = useState<DesktopResourceState<E>>({
    status: resource === undefined ? "idle" : "active",
    error: undefined
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(
    () => {
      const current = resource
      const generation = generationRef.current + 1
      generationRef.current = generation

      if (current === undefined) {
        setState({ status: "idle", error: undefined })
        return
      }

      setState({ status: "active", error: undefined })
      return () => {
        void runFrameworkPromiseExit(defaultRuntime, current.dispose()).then((exit) => {
          if (!mountedRef.current || generationRef.current !== generation) {
            return
          }

          if (Exit.isSuccess(exit)) {
            setState({ status: "disposed", error: undefined })
          } else {
            setState({ status: "failure", error: exit.cause })
          }
        })
      }
    },
    deps === undefined ? [resource] : deps
  )

  return state
}

export const useResource = useDesktopResource
