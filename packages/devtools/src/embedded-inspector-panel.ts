import {
  InspectorSafetyPolicy,
  type InspectorSafetyPolicyApi,
  type InspectorSafetySummary
} from "@orika/core"
import { Context, Effect, Layer, Option, Schedule, Stream } from "effect"

import {
  type DevtoolsSnapshotClientApi,
  DevtoolsSnapshotClient,
  type DevtoolsSnapshotSafetyError
} from "./snapshot-client.js"
import { type InspectorViewsSnapshot, toInspectorViewsSnapshot } from "./inspector-views.js"
import { positiveFrameInterval } from "./panel-options.js"
import type { EventLogPanelError } from "./event-log-panel.js"

export type EmbeddedInspectorMode = "disabled" | "embedded-devtools"
export type EmbeddedInspectorProfile = "development" | "production"

export interface EmbeddedInspectorPanelOptions {
  readonly mode?: EmbeddedInspectorMode
  readonly profile?: EmbeddedInspectorProfile
  readonly frameInterval?: `${number} millis`
  readonly snapshotClient?: DevtoolsSnapshotClientApi
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export interface EmbeddedInspectorPanelSnapshot {
  readonly enabled: boolean
  readonly reason: "disabled" | "production-disabled" | "enabled"
  readonly views: Option.Option<InspectorViewsSnapshot>
  readonly safety: InspectorSafetySummary
}

export interface EmbeddedInspectorPanelApi {
  readonly list: () => Effect.Effect<
    EmbeddedInspectorPanelSnapshot,
    EventLogPanelError | DevtoolsSnapshotSafetyError,
    never
  >
  readonly observe: () => Stream.Stream<
    EmbeddedInspectorPanelSnapshot,
    EventLogPanelError | DevtoolsSnapshotSafetyError,
    never
  >
}

export class EmbeddedInspectorPanel extends Context.Service<
  EmbeddedInspectorPanel,
  EmbeddedInspectorPanelApi
>()("@orika/devtools/embedded-inspector-panel/EmbeddedInspectorPanel") {}

export const EmbeddedInspectorPanelLive = (
  options: EmbeddedInspectorPanelOptions = {}
): Layer.Layer<EmbeddedInspectorPanel, never, DevtoolsSnapshotClient | InspectorSafetyPolicy> =>
  Layer.effect(EmbeddedInspectorPanel)(makeEmbeddedInspectorPanel(options))

export const makeEmbeddedInspectorPanel = (
  options: EmbeddedInspectorPanelOptions = {}
): Effect.Effect<
  EmbeddedInspectorPanelApi,
  never,
  DevtoolsSnapshotClient | InspectorSafetyPolicy
> =>
  Effect.gen(function* () {
    const snapshotClient = options.snapshotClient ?? (yield* DevtoolsSnapshotClient)
    const inspectorSafety = options.inspectorSafety ?? (yield* InspectorSafetyPolicy)
    const mode = options.mode ?? "disabled"
    const profile = options.profile ?? "production"
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<
      EmbeddedInspectorPanelSnapshot,
      EventLogPanelError | DevtoolsSnapshotSafetyError,
      never
    > =>
      Effect.gen(function* () {
        const gate = embeddedInspectorGate({ mode, profile })
        if (gate.enabled === false) {
          const safety = yield* inspectorSafety.snapshot()
          return disabledEmbeddedInspectorPanelSnapshot(gate.reason, safety)
        }

        const snapshot = yield* snapshotClient.exportSnapshot()
        const views = toInspectorViewsSnapshot(snapshot)
        return {
          enabled: true,
          reason: "enabled",
          views: Option.some(views),
          safety: snapshot.safety
        } satisfies EmbeddedInspectorPanelSnapshot
      })

    return Object.freeze({
      list,
      observe: () => Stream.fromEffectSchedule(list(), Schedule.spaced(frameInterval))
    } satisfies EmbeddedInspectorPanelApi)
  })

export interface EmbeddedInspectorGateInput {
  readonly mode: EmbeddedInspectorMode
  readonly profile: EmbeddedInspectorProfile
}

export type EmbeddedInspectorGateDecision =
  | {
      readonly enabled: true
      readonly reason: "enabled"
    }
  | {
      readonly enabled: false
      readonly reason: "disabled" | "production-disabled"
    }

export const embeddedInspectorGate = (
  input: EmbeddedInspectorGateInput
): EmbeddedInspectorGateDecision => {
  if (input.mode === "disabled") {
    return { enabled: false, reason: "disabled" }
  }
  if (input.profile === "production") {
    return { enabled: false, reason: "production-disabled" }
  }
  return { enabled: true, reason: "enabled" }
}

const disabledEmbeddedInspectorPanelSnapshot = (
  reason: "disabled" | "production-disabled",
  safety: InspectorSafetySummary
): EmbeddedInspectorPanelSnapshot => ({
  enabled: false,
  reason,
  views: Option.none(),
  safety
})
