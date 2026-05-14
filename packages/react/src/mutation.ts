import { makeFrameworkScopedOperation, type FrameworkRuntime } from "@effect-desktop/core/renderer"
import { Effect, Exit, Layer, ManagedRuntime } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { asyncResultFromExit, asyncResultStatusOf, runAsyncResult } from "./hooks/effect-runner.js"
import type { DesktopAsyncStatus } from "./hooks/desktop.js"

export type MutationStatus = DesktopAsyncStatus

export type MutationState<A, E> = AsyncResult.AsyncResult<A, E>

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
  const [state, setState] = useState<MutationState<A, E | ER>>(AsyncResult.initial<A, E | ER>())
  const makeEffectRef = useRef(makeEffect)
  const operation = useMemo(() => makeFrameworkScopedOperation(runtime), [runtime])
  makeEffectRef.current = makeEffect

  useEffect(() => {
    return () => {
      operation.dispose()
    }
  }, [operation])

  const runPromiseImpl = useCallback(
    async (input?: I): Promise<Exit.Exit<A, E | ER>> => {
      setState(AsyncResult.initial<A, E | ER>(true))

      const [resultExit, isLatest] = await operation.runLatestPromiseExit(
        runAsyncResult(makeEffectRef.current(input as I))
      )
      const stateResult = asyncResultFromExit(resultExit)
      if (!isLatest) {
        return exitFromAsyncResult(stateResult)
      }

      setState(stateResult)

      return exitFromAsyncResult(stateResult)
    },
    [operation]
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
    operation.reset()
    setState(AsyncResult.initial<A, E | ER>())
  }, [operation])

  const status = asyncResultStatusOf(state)

  return {
    state,
    status,
    isIdle: status === "idle",
    isRunning: status === "running",
    isSuccess: status === "success",
    isFailure: status === "failure" || status === "unavailable",
    run,
    runPromise,
    reset
  }
}

const exitFromAsyncResult = <A, E>(result: AsyncResult.AsyncResult<A, E>): Exit.Exit<A, E> => {
  if (AsyncResult.isSuccess(result)) {
    return Exit.succeed(result.value)
  }
  if (AsyncResult.isFailure(result)) {
    return Exit.failCause(result.cause)
  }
  return Exit.die("mutation completed without a result")
}
