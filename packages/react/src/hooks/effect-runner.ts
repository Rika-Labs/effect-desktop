import { Cause, Effect, Exit, Fiber, FiberSet } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"

export const runAsyncResult = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<AsyncResult.AsyncResult<A, E>, never, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fibers = yield* FiberSet.make<A, E>()
      const fiber = yield* FiberSet.run(fibers, effect)
      const exit = yield* Fiber.await(fiber)
      return AsyncResult.fromExit(exit)
    })
  )

export const asyncResultFromExit = <A, E, ER>(
  exit: Exit.Exit<AsyncResult.AsyncResult<A, E>, ER>
): AsyncResult.AsyncResult<A, E | ER> =>
  Exit.isSuccess(exit) ? exit.value : AsyncResult.failure(exit.cause)

export type AsyncResultStatus =
  | "idle"
  | "running"
  | "success"
  | "failure"
  | "canceled"
  | "unavailable"

export const asyncResultStatusOf = <A, E>(
  state: AsyncResult.AsyncResult<A, E>
): AsyncResultStatus => {
  if (AsyncResult.isWaiting(state)) {
    return "running"
  }

  switch (state._tag) {
    case "Initial":
      return "idle"
    case "Success":
      return "success"
    case "Failure":
      if (Cause.hasInterruptsOnly(state.cause)) {
        return "canceled"
      }
      return unavailableMessageFromCause(state.cause) === undefined ? "failure" : "unavailable"
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

  const tag = "tag" in error ? error.tag : undefined
  const current = "current" in error ? error.current : undefined
  const message = "message" in error ? error.message : undefined
  const isUnavailable =
    tag === "HostUnavailable" ||
    tag === "RuntimeUnavailable" ||
    (tag === "InvalidState" && current === "missing host bridge")

  if (!isUnavailable) {
    return undefined
  }

  return typeof message === "string" ? message : "desktop host is unavailable"
}
