import { Deferred, Effect, Option, RcMap, Scope, Semaphore } from "effect"

export const holdScopedExecutionPermit = <BusyError>(options: {
  readonly budgets: RcMap.RcMap<string, Semaphore.Semaphore>
  readonly scope: Scope.Closeable
  readonly ownerScope: string
  readonly maxConcurrent: number
  readonly onBusy: (ownerScope: string, maxConcurrent: number) => BusyError
}): Effect.Effect<void, BusyError, never> =>
  Effect.gen(function* holdScopedExecutionPermit() {
    const semaphore = yield* RcMap.get(options.budgets, options.ownerScope).pipe(
      Scope.provide(options.scope)
    )
    const acquired = yield* Deferred.make<boolean, never>()
    const holder = semaphore.withPermitsIfAvailable(1)(
      Deferred.succeed(acquired, true).pipe(Effect.andThen(Effect.never))
    )
    yield* holder.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Deferred.succeed(acquired, false),
          onSome: () => Effect.void
        })
      ),
      Effect.forkScoped({ startImmediately: true }),
      Scope.provide(options.scope)
    )
    const reserved = yield* Deferred.await(acquired)
    if (reserved) {
      return
    }

    return yield* Effect.fail(options.onBusy(options.ownerScope, options.maxConcurrent))
  })
