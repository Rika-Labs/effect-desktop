import { Context, Effect, Layer, Stream } from "effect"

export interface ClusterPanelSnapshot {
  readonly enabled: false
  readonly reason: "cluster-not-enabled"
}

export interface ClusterPanelApi {
  readonly list: () => Effect.Effect<ClusterPanelSnapshot, never, never>
  readonly observe: () => Stream.Stream<ClusterPanelSnapshot, never, never>
}

export class ClusterPanel extends Context.Service<ClusterPanel, ClusterPanelApi>()(
  "@effect-desktop/devtools/ClusterPanel"
) {}

const DISABLED_SNAPSHOT: ClusterPanelSnapshot = {
  enabled: false,
  reason: "cluster-not-enabled"
} as const

export const ClusterPanelLive: Layer.Layer<ClusterPanel> = Layer.succeed(ClusterPanel)(
  Object.freeze({
    list: () => Effect.succeed(DISABLED_SNAPSHOT),
    observe: () => Stream.make(DISABLED_SNAPSHOT)
  } satisfies ClusterPanelApi)
)
