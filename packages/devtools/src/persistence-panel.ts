import { Context, Effect, Layer, Option, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

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
  "@effect-desktop/devtools/PersistencePanel"
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
    const frameInterval = options.frameInterval ?? "16 millis"

    const list = (): Effect.Effect<PersistencePanelSnapshot, never, never> =>
      kv.size.pipe(
        Effect.map((size: number) => ({
          kvSize: Option.some(size),
          kvHealthy: true,
          kvError: Option.none()
        })),
        Effect.catch((error: KeyValueStore.KeyValueStoreError) =>
          Effect.succeed({
            kvSize: Option.none(),
            kvHealthy: false,
            kvError: Option.some(`${error.method}: ${error.message}`)
          })
        )
      )

    return Object.freeze({
      list,
      observe: () =>
        Stream.fromEffect(list()).pipe(
          Stream.concat(
            Stream.fromEffectRepeat(Effect.sleep(frameInterval).pipe(Effect.andThen(list())))
          )
        )
    } satisfies PersistencePanelApi)
  })
