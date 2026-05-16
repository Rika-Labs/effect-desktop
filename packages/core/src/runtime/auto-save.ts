import { Context, Data, Duration, Effect, Layer, Schedule } from "effect"

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

export interface AutoSaveOptions {
  readonly target: string
  readonly interval?: Duration.Input
  readonly retries?: number
}

const defaultAutoSaveInterval = "30 seconds"
const defaultAutoSaveRetries = 3

export const makeAutoSaveLayer = (
  options: AutoSaveOptions
): Layer.Layer<never, never, AutoSaveService> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const svc = yield* AutoSaveService
      const interval = options.interval ?? defaultAutoSaveInterval
      const retries = options.retries ?? defaultAutoSaveRetries

      const flush = svc.flush(options.target).pipe(Effect.retry(Schedule.recurs(retries)))
      const scheduledFlush = Effect.sleep(interval).pipe(
        Effect.andThen(flush),
        Effect.repeat(Schedule.spaced(interval))
      )

      yield* scheduledFlush.pipe(Effect.forkScoped)
    })
  )
