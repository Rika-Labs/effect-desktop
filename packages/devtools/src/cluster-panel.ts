import { Context, Effect, Layer, Schedule, Stream } from "effect"
import { Sharding } from "effect/unstable/cluster"

export interface ClusterPanelDisabledSnapshot {
  readonly enabled: false
  readonly reason: "cluster-not-enabled"
}

export interface ClusterPanelEnabledSnapshot {
  readonly enabled: true
  readonly activeEntityCount: number
  readonly isShutdown: boolean
}

export type ClusterPanelSnapshot = ClusterPanelDisabledSnapshot | ClusterPanelEnabledSnapshot

export interface ClusterPanelApi {
  readonly list: () => Effect.Effect<ClusterPanelSnapshot, never, never>
  readonly observe: () => Stream.Stream<ClusterPanelSnapshot, never, never>
}

export class ClusterPanel extends Context.Service<ClusterPanel, ClusterPanelApi>()(
  "@orika/devtools/cluster-panel/ClusterPanel"
) {}

const DISABLED_SNAPSHOT: ClusterPanelDisabledSnapshot = {
  enabled: false,
  reason: "cluster-not-enabled"
} as const

const readClusterSnapshot = Effect.fn("readClusterSnapshot")(function* (
  sharding: Sharding.Sharding["Service"]
): Effect.fn.Return<ClusterPanelEnabledSnapshot> {
  const activeEntityCount = yield* sharding.activeEntityCount
  const isShutdown = yield* sharding.isShutdown
  return {
    enabled: true,
    activeEntityCount,
    isShutdown
  }
})

export const ClusterPanelDisabled: Layer.Layer<ClusterPanel> = Layer.succeed(ClusterPanel)(
  Object.freeze({
    list: () => Effect.succeed(DISABLED_SNAPSHOT),
    observe: () => Stream.make(DISABLED_SNAPSHOT)
  } satisfies ClusterPanelApi)
)

export const ClusterPanelLive: Layer.Layer<ClusterPanel, never, Sharding.Sharding> = Layer.effect(
  ClusterPanel
)(
  Effect.gen(function* () {
    const sharding = yield* Sharding.Sharding
    return Object.freeze({
      list: () => readClusterSnapshot(sharding),
      observe: () =>
        Stream.fromEffectSchedule(readClusterSnapshot(sharding), Schedule.spaced("1 second"))
    } satisfies ClusterPanelApi)
  })
)
