import { Cause, Effect, Exit, Fiber } from "effect"
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

export type DesktopEffectOperation<Args extends readonly unknown[], A, E> = (
  ...args: Args
) => Effect.Effect<A, E, never>

export interface DesktopOperation<Args extends readonly unknown[], A, E> {
  readonly useAction: (options?: DesktopActionOptions) => DesktopAction<Args, A, E>
}

type AnyDesktopEffectOperation = (
  ...args: readonly never[]
) => Effect.Effect<unknown, unknown, never>

type DesktopOperationFor<Operation> = Operation extends (
  ...args: infer Args
) => Effect.Effect<infer A, infer E, never>
  ? Args extends readonly unknown[]
    ? DesktopOperation<Args, A, E>
    : never
  : never

export type DesktopApi<
  Operations extends { readonly [Key in keyof Operations]: AnyDesktopEffectOperation }
> = {
  readonly [Key in keyof Operations]: DesktopOperationFor<Operations[Key]>
}

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
  const fiberRef = useRef<Fiber.Fiber<A, E> | undefined>(undefined)
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

    const fiber = Effect.runFork(operationRef.current(...args))
    fiberRef.current = fiber

    void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
      if (!mountedRef.current || runId !== runIdRef.current) {
        canceledRunIdsRef.current.delete(runId)
        return
      }

      fiberRef.current = undefined
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
  }, [])

  const cancel = useCallback((): void => {
    const fiber = fiberRef.current
    if (fiber === undefined) {
      return
    }

    canceledRunIdsRef.current.add(runIdRef.current)
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
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
      const fiber = fiberRef.current
      if (fiber !== undefined) {
        void Effect.runPromiseExit(Fiber.interrupt(fiber))
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
  const fiberRef = useRef<Fiber.Fiber<A, E> | undefined>(undefined)
  const canceledRef = useRef(false)
  const [reloads, setReloads] = useState(0)
  const [state, setState] = useState<DesktopAsyncState<A, E>>(idle<A, E>)

  operationRef.current = operation

  const cancel = useCallback((): void => {
    const fiber = fiberRef.current
    if (fiber === undefined) {
      return
    }

    canceledRef.current = true
    void Effect.runPromiseExit(Fiber.interrupt(fiber))
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

      const fiber = Effect.runFork(operationRef.current())
      fiberRef.current = fiber

      void Effect.runPromiseExit(Fiber.join(fiber)).then((exit) => {
        if (!active) {
          return
        }

        fiberRef.current = undefined
        if (canceledRef.current) {
          setState({ _tag: "Canceled" })
        } else {
          setState(stateFromExit(exit))
        }
      })

      return () => {
        active = false
        void Effect.runPromiseExit(Fiber.interrupt(fiber))
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
        void Effect.runPromiseExit(current.dispose()).then((exit) => {
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

export const defineDesktopOperation = <Args extends readonly unknown[], A, E>(
  effect: DesktopEffectOperation<Args, A, E>
): DesktopOperation<Args, A, E> => {
  const useAction = (options?: DesktopActionOptions): DesktopAction<Args, A, E> =>
    useDesktopAction(effect, options)

  return Object.freeze({
    useAction
  })
}

export const defineDesktopApi = <
  Operations extends { readonly [Key in keyof Operations]: AnyDesktopEffectOperation }
>(
  operations: Operations
): DesktopApi<Operations> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(operations).map(([name, effect]) => [
        name,
        defineDesktopOperation(effect as AnyDesktopEffectOperation)
      ])
    )
  ) as DesktopApi<Operations>

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
