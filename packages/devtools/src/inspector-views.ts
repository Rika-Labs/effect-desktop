import type { DevtoolsSnapshot } from "./snapshot-client.js"

export type InspectorPanelId =
  | "live-runtime"
  | "diagnostics"
  | "performance"
  | "event-log"
  | "workflows"
  | "reactivity"
  | "persistence"
  | "logs"

export interface InspectorViewPanel<A> {
  readonly id: InspectorPanelId
  readonly title: string
  readonly snapshot: A
}

export interface InspectorViewsSnapshot {
  readonly panels: readonly [
    InspectorViewPanel<DevtoolsSnapshot["liveRuntime"]>,
    InspectorViewPanel<DevtoolsSnapshot["diagnostics"]>,
    InspectorViewPanel<DevtoolsSnapshot["performance"]>,
    InspectorViewPanel<DevtoolsSnapshot["eventLog"]>,
    InspectorViewPanel<DevtoolsSnapshot["workflows"]>,
    InspectorViewPanel<DevtoolsSnapshot["reactivity"]>,
    InspectorViewPanel<DevtoolsSnapshot["persistence"]>,
    InspectorViewPanel<DevtoolsSnapshot["logs"]>
  ]
  readonly safety: DevtoolsSnapshot["safety"]
}

export const toInspectorViewsSnapshot = (snapshot: DevtoolsSnapshot): InspectorViewsSnapshot => ({
  panels: [
    { id: "live-runtime", title: "Live runtime", snapshot: snapshot.liveRuntime },
    { id: "diagnostics", title: "Diagnostics", snapshot: snapshot.diagnostics },
    { id: "performance", title: "Performance", snapshot: snapshot.performance },
    { id: "event-log", title: "Event log", snapshot: snapshot.eventLog },
    { id: "workflows", title: "Workflows", snapshot: snapshot.workflows },
    { id: "reactivity", title: "Reactivity", snapshot: snapshot.reactivity },
    { id: "persistence", title: "Persistence", snapshot: snapshot.persistence },
    { id: "logs", title: "Logs", snapshot: snapshot.logs }
  ],
  safety: snapshot.safety
})
