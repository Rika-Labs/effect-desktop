import { Context, Effect, Layer } from "effect"

import type { ClusterPanelSnapshot } from "./cluster-panel.js"
import { ClusterPanel } from "./cluster-panel.js"
import type { DiagnosticsPanelsSnapshot } from "./diagnostics-panels.js"
import { DiagnosticsPanels } from "./diagnostics-panels.js"
import type { EventLogPanelSnapshot } from "./event-log-panel.js"
import { EventLogPanel } from "./event-log-panel.js"
import type { LiveRuntimePanelsSnapshot } from "./live-panels.js"
import { LiveRuntimePanels } from "./live-panels.js"
import type { LogsPanelSnapshot } from "./logs-panel.js"
import { LogsPanel } from "./logs-panel.js"
import type { PerformanceOverlaySnapshot } from "./performance-overlay.js"
import { PerformanceOverlay } from "./performance-overlay.js"
import type { PersistencePanelSnapshot } from "./persistence-panel.js"
import { PersistencePanel } from "./persistence-panel.js"
import type { ReactivityPanelSnapshot } from "./reactivity-panel.js"
import { ReactivityPanel } from "./reactivity-panel.js"
import type { WorkflowsPanelSnapshot } from "./workflows-panel.js"
import { WorkflowsPanel } from "./workflows-panel.js"

export interface DevtoolsSnapshot {
  readonly liveRuntime: LiveRuntimePanelsSnapshot
  readonly diagnostics: DiagnosticsPanelsSnapshot
  readonly performance: PerformanceOverlaySnapshot
  readonly eventLog: EventLogPanelSnapshot
  readonly workflows: WorkflowsPanelSnapshot
  readonly reactivity: ReactivityPanelSnapshot
  readonly persistence: PersistencePanelSnapshot
  readonly logs: LogsPanelSnapshot
  readonly cluster: ClusterPanelSnapshot
}

export interface DevtoolsSnapshotClientApi {
  readonly exportSnapshot: () => Effect.Effect<DevtoolsSnapshot, never, never>
}

export class DevtoolsSnapshotClient extends Context.Service<
  DevtoolsSnapshotClient,
  DevtoolsSnapshotClientApi
>()("@effect-desktop/devtools/DevtoolsSnapshotClient") {}

export type DevtoolsSnapshotClientRequirements =
  | LiveRuntimePanels
  | DiagnosticsPanels
  | PerformanceOverlay
  | EventLogPanel
  | WorkflowsPanel
  | ReactivityPanel
  | PersistencePanel
  | LogsPanel
  | ClusterPanel

export const DevtoolsSnapshotClientLive: Layer.Layer<
  DevtoolsSnapshotClient,
  never,
  DevtoolsSnapshotClientRequirements
> = Layer.effect(DevtoolsSnapshotClient)(
  Effect.gen(function* () {
    const liveRuntime = yield* LiveRuntimePanels
    const diagnostics = yield* DiagnosticsPanels
    const performance = yield* PerformanceOverlay
    const eventLog = yield* EventLogPanel
    const workflows = yield* WorkflowsPanel
    const reactivity = yield* ReactivityPanel
    const persistence = yield* PersistencePanel
    const logs = yield* LogsPanel
    const cluster = yield* ClusterPanel

    return Object.freeze({
      exportSnapshot: () =>
        Effect.all({
          liveRuntime: liveRuntime.list(),
          diagnostics: diagnostics.list(),
          performance: performance.list(),
          eventLog: eventLog.list(),
          workflows: workflows.list(),
          reactivity: reactivity.list(),
          persistence: persistence.list(),
          logs: logs.list(),
          cluster: cluster.list()
        })
    } satisfies DevtoolsSnapshotClientApi)
  })
)
