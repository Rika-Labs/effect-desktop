import {
  runFrameworkEffect,
  runFrameworkPromiseExit,
  type FrameworkRuntime
} from "@effect-desktop/core/renderer"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react"

export type DesktopAsyncStatus =
  | "idle"
  | "running"
  | "success"
  | "failure"
  | "canceled"
  | "unavailable"

export type DesktopAsyncState<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly cause: Cause.Cause<E>; readonly message: string }
  | { readonly _tag: "Canceled" }
  | { readonly _tag: "Unavailable"; readonly message: string }

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

const idle = <A, E>(): DesktopAsyncState<A, E> => ({ _tag: "Idle" })

export const statusOf = <A, E>(state: DesktopAsyncState<A, E>): DesktopAsyncStatus => {
  switch (state._tag) {
    case "Idle":
      return "idle"
    case "Running":
      return "running"
    case "Success":
      return "success"
    case "Failure":
      return "failure"
    case "Canceled":
      return "canceled"
    case "Unavailable":
      return "unavailable"
  }
}

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
  const canceledRunIdsRef = useRef(new Set<number>())
  const queueRef = useRef<Args[]>([])
  const [state, setState] = useState<DesktopAsyncState<A, E>>(idle<A, E>)

  operationRef.current = operation

  const start = useCallback((args: Args): void => {
    runningRef.current = true
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setState({ _tag: "Running" })

    const interrupt = runFrameworkEffect(defaultRuntime, operationRef.current(...args), (exit) => {
      if (!mountedRef.current || runId !== runIdRef.current) {
        canceledRunIdsRef.current.delete(runId)
        return
      }

      interruptRef.current = undefined
      runningRef.current = false

      const wasCanceled = canceledRunIdsRef.current.delete(runId)
      if (wasCanceled) {
        setState({ _tag: "Canceled" })
      } else {
        setState(stateFromExit(exit))
      }

      const next = queueRef.current.shift()
      if (next !== undefined) {
        start(next)
      }
    })
    interruptRef.current = interrupt
  }, [])

  const cancel = useCallback((): void => {
    const interrupt = interruptRef.current
    if (interrupt === undefined) {
      return
    }

    canceledRunIdsRef.current.add(runIdRef.current)
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
  const canceledRef = useRef(false)
  const [reloads, setReloads] = useState(0)
  const [state, setState] = useState<DesktopAsyncState<A, E>>(idle<A, E>)

  operationRef.current = operation

  const cancel = useCallback((): void => {
    const interrupt = interruptRef.current
    if (interrupt === undefined) {
      return
    }

    canceledRef.current = true
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
      let active = true
      canceledRef.current = false
      setState({ _tag: "Running" })

      const interrupt = runFrameworkEffect(defaultRuntime, operationRef.current(), (exit) => {
        if (!active) {
          return
        }

        interruptRef.current = undefined
        if (canceledRef.current) {
          setState({ _tag: "Canceled" })
        } else {
          setState(stateFromExit(exit))
        }
      })
      interruptRef.current = interrupt

      return () => {
        active = false
        interrupt()
      }
    },
    deps === undefined ? [reloads] : [...deps, reloads]
  )

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

const stateFromExit = <A, E>(exit: Exit.Exit<A, E>): DesktopAsyncState<A, E> => {
  if (Exit.isSuccess(exit)) {
    return { _tag: "Success", value: exit.value }
  }

  const unavailableMessage = unavailableMessageFromCause(exit.cause)
  if (unavailableMessage !== undefined) {
    return { _tag: "Unavailable", message: unavailableMessage }
  }

  return {
    _tag: "Failure",
    cause: exit.cause,
    message: String(exit.cause)
  }
}

const unavailableMessageFromCause = <E>(cause: Cause.Cause<E>): string | undefined => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const message = unavailableMessageFromError(reason.error)
      if (message !== undefined) {
        return message
      }
    }
  }
  return undefined
}

const unavailableMessageFromError = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const value = error as {
    readonly tag?: unknown
    readonly current?: unknown
    readonly message?: unknown
  }
  const isUnavailable =
    value.tag === "HostUnavailable" ||
    value.tag === "RuntimeUnavailable" ||
    (value.tag === "InvalidState" && value.current === "missing host bridge")

  if (!isUnavailable) {
    return undefined
  }

  return typeof value.message === "string" ? value.message : "desktop host is unavailable"
}
