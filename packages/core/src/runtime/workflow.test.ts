import { expect, test } from "bun:test"
import { Data, Effect, Schema } from "effect"
import { Activity, DurableClock, DurableDeferred, Workflow, WorkflowEngine } from "./workflow.js"

class FetchFailed extends Data.TaggedError("FetchFailed")<{
  readonly url: string
}> {}

const provideEngine = <A, E, R>(
  effect: Effect.Effect<A, E, R | WorkflowEngine.WorkflowEngine>
): Effect.Effect<A, E, Exclude<R, WorkflowEngine.WorkflowEngine>> =>
  effect.pipe(Effect.provide(WorkflowEngine.layerMemory))

test("Workflow.make executes a workflow to completion via memory engine", async () => {
  const Ping = Workflow.make({
    name: "Ping",
    payload: { message: Schema.String },
    idempotencyKey: (p) => p.message,
    success: Schema.String
  })

  const layer = Ping.toLayer((payload) => Effect.succeed(`pong:${payload.message}`))

  const result = await Effect.runPromise(
    Ping.execute({ message: "hello" }).pipe(Effect.provide(layer), provideEngine)
  )

  expect(result).toBe("pong:hello")
})

test("Activity.make checkpoints inside a workflow", async () => {
  const steps: string[] = []

  const Seq = Workflow.make({
    name: "Seq",
    payload: { id: Schema.String },
    idempotencyKey: (p) => p.id,
    success: Schema.String
  })

  const stepA = Activity.make({
    name: "step-a",
    success: Schema.String,
    execute: Effect.sync(() => {
      steps.push("a")
      return "A"
    })
  })

  const stepB = Activity.make({
    name: "step-b",
    success: Schema.String,
    execute: Effect.sync(() => {
      steps.push("b")
      return "B"
    })
  })

  const layer = Seq.toLayer(() =>
    Effect.gen(function* () {
      const a = yield* stepA
      const b = yield* stepB
      return `${a}+${b}`
    })
  )

  const result = await Effect.runPromise(
    Seq.execute({ id: "seq-1" }).pipe(Effect.provide(layer), provideEngine)
  )

  expect(result).toBe("A+B")
  expect(steps).toEqual(["a", "b"])
})

test("Activity.retry retries a transient failure", async () => {
  let attempts = 0

  const Retried = Workflow.make({
    name: "Retried",
    payload: { id: Schema.String },
    idempotencyKey: (p) => p.id,
    success: Schema.Number,
    error: Schema.TaggedStruct("FetchFailed", { url: Schema.String })
  })

  const flaky = Activity.make({
    name: "flaky-fetch",
    success: Schema.Number,
    error: Schema.TaggedStruct("FetchFailed", { url: Schema.String }),
    execute: Effect.sync(() => {
      attempts += 1
      return attempts
    }).pipe(
      Effect.flatMap((attempt) =>
        attempt < 3
          ? Effect.fail(new FetchFailed({ url: "https://example.com" }))
          : Effect.succeed(attempt)
      )
    )
  })

  const layer = Retried.toLayer(() => flaky.pipe(Activity.retry({ times: 5 })))

  const result = await Effect.runPromise(
    Retried.execute({ id: "retried-1" }).pipe(Effect.provide(layer), provideEngine)
  )

  expect(result).toBe(3)
  expect(attempts).toBe(3)
})

test("Workflow.withCompensation runs compensation on workflow failure", async () => {
  const compensated: string[] = []

  const Comp = Workflow.make({
    name: "Comp",
    payload: { id: Schema.String },
    idempotencyKey: (p) => p.id,
    error: Schema.TaggedStruct("FetchFailed", { url: Schema.String })
  })

  const layer = Comp.toLayer((_payload, _executionId) =>
    Comp.withCompensation(Effect.succeed("acquired"), (value, _cause) =>
      Effect.sync(() => {
        compensated.push(`rollback:${value}`)
      })
    ).pipe(Effect.andThen(Effect.fail(new FetchFailed({ url: "https://example.com" }))))
  )

  const exit = await Effect.runPromiseExit(
    Comp.execute({ id: "comp-1" }).pipe(Effect.provide(layer), provideEngine)
  )

  expect(exit._tag).toBe("Failure")
  expect(compensated).toContain("rollback:acquired")
})

test("DurableClock.sleep completes within the memory engine threshold", async () => {
  const Timed = Workflow.make({
    name: "Timed",
    payload: { id: Schema.String },
    idempotencyKey: (p) => p.id,
    success: Schema.String
  })

  const layer = Timed.toLayer(() =>
    Effect.gen(function* () {
      yield* DurableClock.sleep({ name: "short-wait", duration: "10 millis" })
      return "done"
    })
  )

  const result = await Effect.runPromise(
    Timed.execute({ id: "timed-1" }).pipe(Effect.provide(layer), provideEngine)
  )

  expect(result).toBe("done")
})

test("DurableDeferred.make constructs a named deferred with the correct schema", () => {
  const approval = DurableDeferred.make<typeof Schema.String>("approval-check", {
    success: Schema.String
  })

  expect(approval.name).toBe("approval-check")
  expect(approval.successSchema).toBe(Schema.String)
})
