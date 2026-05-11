import { Cause, Effect, Exit } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"

export type MutationStatus = "idle" | "running" | "success" | "failure"

export type MutationState<A, E> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "success"; readonly value: A }
  | { readonly status: "failure"; readonly cause: Cause.Cause<E> }

export type MutationRun<I> = [I] extends [void]
  ? () => void
  : undefined extends I
    ? (input?: I) => void
    : (input: I) => void

export type MutationRunPromise<I, A, E> = [I] extends [void]
  ? () => Promise<Exit.Exit<A, E>>
  : undefined extends I
    ? (input?: I) => Promise<Exit.Exit<A, E>>
    : (input: I) => Promise<Exit.Exit<A, E>>

export interface MutationResult<I, A, E> {
  readonly state: MutationState<A, E>
  readonly status: MutationStatus
  readonly isIdle: boolean
  readonly isRunning: boolean
  readonly isSuccess: boolean
  readonly isFailure: boolean
  readonly run: MutationRun<I>
  readonly runPromise: MutationRunPromise<I, A, E>
  readonly reset: () => void
}

export const useMutation = <I, A, E>(
  makeEffect: (input: I) => Effect.Effect<A, E, never>
): MutationResult<I, A, E> => {
  const [state, setState] = useState<MutationState<A, E>>({ status: "idle" })
  const makeEffectRef = useRef(makeEffect)
  const mountedRef = useRef(true)
  const runIdRef = useRef(0)
  makeEffectRef.current = makeEffect

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
    }
  }, [])

  const runPromiseImpl = useCallback(async (input?: I): Promise<Exit.Exit<A, E>> => {
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setState({ status: "running" })

    const exit = await Effect.runPromiseExit(makeEffectRef.current(input as I))
    if (!mountedRef.current || runIdRef.current !== runId) {
      return exit
    }

    if (Exit.isSuccess(exit)) {
      setState({ status: "success", value: exit.value })
    } else {
      setState({ status: "failure", cause: exit.cause })
    }

    return exit
  }, [])

  const runPromise = runPromiseImpl as MutationRunPromise<I, A, E>

  const runImpl = useCallback(
    (input?: I): void => {
      void runPromiseImpl(input)
    },
    [runPromiseImpl]
  )

  const run = runImpl as MutationRun<I>

  const reset = useCallback((): void => {
    runIdRef.current += 1
    setState({ status: "idle" })
  }, [])

  return {
    state,
    status: state.status,
    isIdle: state.status === "idle",
    isRunning: state.status === "running",
    isSuccess: state.status === "success",
    isFailure: state.status === "failure",
    run,
    runPromise,
    reset
  }
}
