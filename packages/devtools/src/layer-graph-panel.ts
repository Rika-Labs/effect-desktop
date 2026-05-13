import {
  DesktopRuntime,
  InspectorSafetyPolicy,
  type InspectorSafetyPolicyApi,
  type InspectorSafetySummary,
  LayerGraphSnapshot,
  layerGraphSnapshotFromGraph
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Stream } from "effect"

import { positiveFrameInterval } from "./panel-options.js"

export interface LayerGraphPanelSnapshot {
  readonly layerGraph: LayerGraphSnapshot
  readonly safety: InspectorSafetySummary
}

export interface LayerGraphPanelApi {
  readonly list: () => Effect.Effect<LayerGraphPanelSnapshot, never, never>
  readonly observe: () => Stream.Stream<LayerGraphPanelSnapshot, never, never>
}

export interface LayerGraphPanelOptions {
  readonly frameInterval?: `${number} millis`
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export class LayerGraphPanel extends Context.Service<LayerGraphPanel, LayerGraphPanelApi>()(
  "@effect-desktop/devtools/LayerGraphPanel"
) {}

export const LayerGraphPanelLive = (
  options: LayerGraphPanelOptions = {}
): Layer.Layer<LayerGraphPanel, never, DesktopRuntime | InspectorSafetyPolicy> =>
  Layer.effect(LayerGraphPanel)(makeLayerGraphPanel(options))

export const makeLayerGraphPanel = (
  options: LayerGraphPanelOptions = {}
): Effect.Effect<LayerGraphPanelApi, never, DesktopRuntime | InspectorSafetyPolicy> =>
  Effect.gen(function* () {
    const runtime = yield* DesktopRuntime
    const inspectorSafety = options.inspectorSafety ?? (yield* InspectorSafetyPolicy)
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<LayerGraphPanelSnapshot, never, never> =>
      Effect.gen(function* () {
        const layerGraph = layerGraphSnapshotFromGraph(runtime.graph)
        const decision = yield* inspectorSafety.sanitize({
          source: "devtools.layerGraph",
          payload: { layerGraph } satisfies Omit<LayerGraphPanelSnapshot, "safety">
        })
        if (Option.isNone(decision.value)) {
          return {
            layerGraph: new LayerGraphSnapshot({
              appId: runtime.appId,
              providers: runtime.providers,
              nodes: [],
              providerFacts: [],
              failures: []
            }),
            safety: decision.summary
          } satisfies LayerGraphPanelSnapshot
        }
        return {
          ...decision.value.value,
          safety: decision.summary
        } satisfies LayerGraphPanelSnapshot
      })

    return Object.freeze({
      list,
      observe: () =>
        Stream.fromEffect(list()).pipe(
          Stream.concat(
            Stream.fromEffectRepeat(Effect.sleep(frameInterval).pipe(Effect.andThen(list())))
          )
        )
    } satisfies LayerGraphPanelApi)
  })
