import { Context, Effect, Layer, Option, Result, Schedule, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import { positiveFrameInterval } from "./panel-options.js"

export interface PersistencePanelSnapshot {
  readonly kvSize: Option.Option<number>
  readonly kvHealthy: boolean
  readonly kvError: Option.Option<string>
}

export interface PersistencePanelApi {
  readonly list: () => Effect.Effect<PersistencePanelSnapshot, never, never>
  readonly observe: () => Stream.Stream<PersistencePanelSnapshot, never, never>
}

export interface PersistencePanelOptions {
  readonly frameInterval?: `${number} millis`
}

export class PersistencePanel extends Context.Service<PersistencePanel, PersistencePanelApi>()(
  "@orika/devtools/persistence-panel/PersistencePanel"
) {}

export const PersistencePanelLive = (
  options: PersistencePanelOptions = {}
): Layer.Layer<PersistencePanel, never, KeyValueStore.KeyValueStore> =>
  Layer.effect(PersistencePanel)(makePersistencePanel(options))

export const makePersistencePanel = (
  options: PersistencePanelOptions = {}
): Effect.Effect<PersistencePanelApi, never, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const kv = yield* KeyValueStore.KeyValueStore
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<PersistencePanelSnapshot, never, never> =>
      kv.size.pipe(
        Effect.result,
        Effect.map((result) =>
          Result.match(result, {
            onFailure: (error: KeyValueStore.KeyValueStoreError) => ({
              kvSize: Option.none(),
              kvHealthy: false,
              kvError: Option.some(`${error.method}: ${error.message}`)
            }),
            onSuccess: (size) => ({
              kvSize: Option.some(size),
              kvHealthy: true,
              kvError: Option.none()
            })
          })
        )
      )

    return Object.freeze({
      list,
      observe: () => Stream.fromEffectSchedule(list(), Schedule.spaced(frameInterval))
    } satisfies PersistencePanelApi)
  })
