import {
  CommandRegistry,
  type CommandInvocationRecord,
  type CommandSnapshot,
  InspectorSafetyPolicy,
  type InspectorSafetySummary,
  Worker,
  type WorkerSnapshot
} from "@orika/core"
import { Context, Effect, Layer, Option, Schedule, Stream } from "effect"

export * from "./shell.js"
export * from "./live-panels.js"
export * from "./diagnostics-panels.js"
export * from "./performance-overlay.js"
export * from "./event-log-panel.js"
export * from "./workflows-panel.js"
export * from "./reactivity-panel.js"
export * from "./persistence-panel.js"
export * from "./logs-panel.js"
export * from "./cluster-panel.js"
export * from "./layer-graph-panel.js"
export * from "./snapshot-client.js"
export * from "./inspector-events.js"
export * from "./testing.js"
export * from "./lifecycle-collectors.js"
export * from "./inspector-views.js"
export * from "./embedded-inspector-panel.js"
export * from "./desktop-inspector.js"

export interface CommandsDevtoolsApi {
  readonly list: () => Effect.Effect<readonly CommandSnapshot[], never, never>
  readonly observeInvocations: () => Stream.Stream<CommandInvocationRecord, never, never>
}

export class CommandsDevtools extends Context.Service<CommandsDevtools, CommandsDevtoolsApi>()(
  "@orika/devtools/CommandsDevtools"
) {}

export const CommandsDevtoolsLive = Layer.effect(CommandsDevtools)(
  Effect.gen(function* () {
    const commands = yield* CommandRegistry
    return Object.freeze({
      list: () => commands.list(),
      observeInvocations: () => commands.observeInvocations()
    } satisfies CommandsDevtoolsApi)
  })
)

export interface WorkersSnapshot {
  readonly workers: readonly WorkerSnapshot[]
  readonly safety: InspectorSafetySummary
}

export interface WorkersDevtoolsApi {
  readonly list: () => Effect.Effect<WorkersSnapshot, never, never>
  readonly observe: () => Stream.Stream<WorkersSnapshot, never, never>
}

export class WorkersDevtools extends Context.Service<WorkersDevtools, WorkersDevtoolsApi>()(
  "@orika/devtools/WorkersDevtools"
) {}

export const WorkersDevtoolsLive: Layer.Layer<
  WorkersDevtools,
  never,
  Worker | InspectorSafetyPolicy
> = Layer.effect(WorkersDevtools)(
  Effect.gen(function* () {
    const workers = yield* Worker
    const inspectorSafety = yield* InspectorSafetyPolicy
    const list = (): Effect.Effect<WorkersSnapshot, never, never> =>
      Effect.gen(function* () {
        const workerRows = yield* workers.list()
        const decision = yield* inspectorSafety.sanitize({
          source: "devtools.workers",
          payload: { workers: workerRows } satisfies Omit<WorkersSnapshot, "safety">
        })
        if (Option.isNone(decision.value)) {
          return { workers: [], safety: decision.summary } satisfies WorkersSnapshot
        }
        return {
          ...decision.value.value,
          safety: decision.summary
        } satisfies WorkersSnapshot
      })

    return Object.freeze({
      list,
      observe: () => Stream.fromEffectSchedule(list(), Schedule.spaced("16 millis"))
    } satisfies WorkersDevtoolsApi)
  })
)
