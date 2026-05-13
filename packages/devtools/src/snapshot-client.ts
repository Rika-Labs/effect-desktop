import { InspectorSafetyPolicy, type InspectorSafetySummary } from "@effect-desktop/core"
import { Context, Data, Effect, Layer, Option } from "effect"

import type { ClusterPanelSnapshot } from "./cluster-panel.js"
import { ClusterPanel } from "./cluster-panel.js"
import type { DiagnosticsPanelsSnapshot } from "./diagnostics-panels.js"
import { DiagnosticsPanels } from "./diagnostics-panels.js"
import type { EventLogPanelError, EventLogPanelSnapshot } from "./event-log-panel.js"
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
  readonly safety: InspectorSafetySummary
}

export interface DevtoolsSnapshotClientApi {
  readonly exportSnapshot: () => Effect.Effect<
    DevtoolsSnapshot,
    EventLogPanelError | DevtoolsSnapshotSafetyError,
    never
  >
}

export class DevtoolsSnapshotSafetyError extends Data.TaggedError("SnapshotSafetyError")<{
  readonly operation: string
  readonly safety: InspectorSafetySummary
}> {}

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
  | InspectorSafetyPolicy

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
    const inspectorSafety = yield* InspectorSafetyPolicy

    return Object.freeze({
      exportSnapshot: () =>
        Effect.gen(function* () {
          const snapshot = yield* Effect.all({
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
          const decision = yield* inspectorSafety.sanitize({
            source: "devtools.snapshot",
            payload: snapshot satisfies Omit<DevtoolsSnapshot, "safety">
          })
          if (Option.isNone(decision.value)) {
            return yield* Effect.fail(
              new DevtoolsSnapshotSafetyError({
                operation: "DevtoolsSnapshotClient.exportSnapshot",
                safety: decision.summary
              })
            )
          }
          return {
            ...decision.value.value,
            safety: decision.summary
          } satisfies DevtoolsSnapshot
        })
    } satisfies DevtoolsSnapshotClientApi)
  })
)
