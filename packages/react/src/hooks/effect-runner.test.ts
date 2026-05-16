import { expect, test } from "bun:test"
import { Cause, Effect } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"

import { runAsyncResult } from "./effect-runner.js"

test("runAsyncResult returns AsyncResult success", async () => {
  const result = await Effect.runPromise(runAsyncResult(Effect.succeed("ok")))

  expect(AsyncResult.isSuccess(result)).toBe(true)
  if (AsyncResult.isSuccess(result)) {
    expect(result.value).toBe("ok")
  }
})

test("runAsyncResult returns AsyncResult failure", async () => {
  const result = await Effect.runPromise(runAsyncResult(Effect.fail("failed")))

  expect(AsyncResult.isFailure(result)).toBe(true)
  if (AsyncResult.isFailure(result)) {
    const failures = result.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)
    expect(failures).toEqual(["failed"])
  }
})

test("runAsyncResult models interruption as AsyncResult failure", async () => {
  const result = await Effect.runPromise(runAsyncResult(Effect.interrupt))

  expect(AsyncResult.isInterrupted(result)).toBe(true)
})
