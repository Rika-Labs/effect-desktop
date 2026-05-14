import { runFrameworkPromiseExit, type FrameworkRuntime } from "@effect-desktop/core/renderer"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
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

const defaultRuntime: FrameworkRuntime = ManagedRuntime.make(Layer.empty)

export const useMutation = <I, A, E, R = never, ER = never>(
  makeEffect: (input: I) => Effect.Effect<A, E, R>,
  runtime: FrameworkRuntime<R, ER> = defaultRuntime as FrameworkRuntime<R, ER>
): MutationResult<I, A, E | ER> => {
  const [state, setState] = useState<MutationState<A, E | ER>>({ status: "idle" })
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

  const runPromiseImpl = useCallback(
    async (input?: I): Promise<Exit.Exit<A, E | ER>> => {
      const runId = runIdRef.current + 1
      runIdRef.current = runId
      setState({ status: "running" })

      const exit = await runFrameworkPromiseExit(runtime, makeEffectRef.current(input as I))
      if (!mountedRef.current || runIdRef.current !== runId) {
        return exit
      }

      if (Exit.isSuccess(exit)) {
        setState({ status: "success", value: exit.value })
      } else {
        setState({ status: "failure", cause: exit.cause })
      }

      return exit
    },
    [runtime]
  )

  const runPromise = runPromiseImpl as MutationRunPromise<I, A, E | ER>

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
