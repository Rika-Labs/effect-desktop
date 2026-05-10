import { Context, Data, Effect, Layer, Schedule, Schema } from "effect"
import { Activity, DurableClock, Workflow, WorkflowEngine } from "effect/unstable/workflow"

export class AutoSaveError extends Data.TaggedError("AutoSaveError")<{
  readonly target: string
  readonly message: string
  readonly cause: unknown
}> {}

export interface AutoSavePort {
  readonly flush: (target: string) => Effect.Effect<void, AutoSaveError, never>
}

export class AutoSaveService extends Context.Service<AutoSaveService, AutoSavePort>()(
  "AutoSaveService"
) {}

export const AutoSaveWorkflow = Workflow.make({
  name: "AutoSave",
  payload: { target: Schema.NonEmptyString },
  idempotencyKey: (p) => p.target,
  error: Schema.TaggedStruct("AutoSaveError", {
    target: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown
  })
})

export const AutoSaveWorkflowLayer: Layer.Layer<
  never,
  never,
  WorkflowEngine.WorkflowEngine | AutoSaveService
> = AutoSaveWorkflow.toLayer((payload) =>
  Effect.gen(function* () {
    const svc = yield* AutoSaveService

    const flush = Activity.make({
      name: "flush",
      error: Schema.TaggedStruct("AutoSaveError", {
        target: Schema.String,
        message: Schema.String,
        cause: Schema.Unknown
      }),
      execute: svc.flush(payload.target)
    })

    yield* Effect.repeat(
      Effect.gen(function* () {
        yield* DurableClock.sleep({
          name: `autosave-tick-${payload.target}`,
          duration: "30 seconds"
        })
        yield* flush.pipe(Activity.retry({ times: 3 }))
      }),
      Schedule.forever
    )
  })
)
