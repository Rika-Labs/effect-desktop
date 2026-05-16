import {
  CollectorRegistry,
  DesktopObservability as CoreDesktopObservability,
  type DesktopObservabilityConfigError,
  type DesktopObservabilityLayerOptions,
  InspectorSafetyPolicy,
  Telemetry
} from "@effect-desktop/core"
import { Layer } from "effect"

import {
  type EmbeddedInspectorPanelOptions,
  EmbeddedInspectorPanel,
  EmbeddedInspectorPanelLive
} from "./embedded-inspector-panel.js"
import { DevtoolsSnapshotClient } from "./snapshot-client.js"

export interface DesktopInspectorLayerOptions extends DesktopObservabilityLayerOptions {
  readonly profile?: EmbeddedInspectorPanelOptions["profile"]
  readonly frameInterval?: EmbeddedInspectorPanelOptions["frameInterval"]
  readonly snapshotClient?: EmbeddedInspectorPanelOptions["snapshotClient"]
}

export const DesktopInspectorLive = (
  options: DesktopInspectorLayerOptions
): Layer.Layer<
  | CoreDesktopObservability
  | CollectorRegistry
  | InspectorSafetyPolicy
  | Telemetry
  | EmbeddedInspectorPanel,
  DesktopObservabilityConfigError,
  DevtoolsSnapshotClient
> => {
  const observabilityLayer = CoreDesktopObservability.layer(options)
  const panelOptions: EmbeddedInspectorPanelOptions = {
    mode: options.mode === "embedded-devtools" ? "embedded-devtools" : "disabled",
    profile:
      options.profile ?? (options.mode === "embedded-devtools" ? "development" : "production")
  }
  const panelLayer = EmbeddedInspectorPanelLive({
    ...panelOptions,
    ...(options.frameInterval === undefined ? {} : { frameInterval: options.frameInterval }),
    ...(options.snapshotClient === undefined ? {} : { snapshotClient: options.snapshotClient })
  })

  return Layer.provideMerge(panelLayer, observabilityLayer)
}

export namespace DesktopInspector {
  export const layer = DesktopInspectorLive
}
