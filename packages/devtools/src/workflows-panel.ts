import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect"

import { positiveRowLimit } from "./panel-options.js"

export type WorkflowExecutionState = "running" | "completed" | "failed" | "interrupted"

export interface WorkflowExecutionRecord {
  readonly executionId: string
  readonly workflowName: string
  readonly state: WorkflowExecutionState
  readonly startedAt: number
  readonly endedAt: Option.Option<number>
  readonly durationMs: Option.Option<number>
  readonly errorTag: Option.Option<string>
}

export interface WorkflowsPanelSnapshot {
  readonly executions: readonly WorkflowExecutionRecord[]
  readonly runningCount: number
  readonly completedCount: number
  readonly failedCount: number
}

export interface WorkflowsPanelApi {
  readonly list: () => Effect.Effect<WorkflowsPanelSnapshot, never, never>
  readonly observe: () => Stream.Stream<WorkflowsPanelSnapshot, never, never>
}

export interface WorkflowExecutionRegistryApi {
  readonly record: (event: WorkflowExecutionEvent) => Effect.Effect<void, never, never>
  readonly list: () => Effect.Effect<readonly WorkflowExecutionRecord[], never, never>
  readonly observe: () => Stream.Stream<readonly WorkflowExecutionRecord[], never, never>
}

export type WorkflowExecutionEvent =
  | {
      readonly tag: "Started"
      readonly executionId: string
      readonly workflowName: string
      readonly startedAt: number
    }
  | { readonly tag: "Completed"; readonly executionId: string; readonly endedAt: number }
  | {
      readonly tag: "Failed"
      readonly executionId: string
      readonly endedAt: number
      readonly errorTag: string
    }
  | { readonly tag: "Interrupted"; readonly executionId: string; readonly endedAt: number }

export class WorkflowExecutionRegistry extends Context.Service<
  WorkflowExecutionRegistry,
  WorkflowExecutionRegistryApi
>()("@effect-desktop/devtools/WorkflowExecutionRegistry") {}

export const makeWorkflowExecutionRegistry = (
  options: { readonly maxRows?: number; readonly now?: () => number } = {}
): Effect.Effect<WorkflowExecutionRegistryApi, never, never> =>
  Effect.gen(function* () {
    const maxRows = positiveRowLimit(options.maxRows, 512)
    const ref = yield* SubscriptionRef.make<readonly WorkflowExecutionRecord[]>([])

    const record = (event: WorkflowExecutionEvent): Effect.Effect<void, never, never> =>
      SubscriptionRef.update(ref, (rows) => applyEvent(rows, event, maxRows))

    return Object.freeze({
      record,
      list: () => SubscriptionRef.get(ref),
      observe: () => SubscriptionRef.changes(ref)
    } satisfies WorkflowExecutionRegistryApi)
  })

export const WorkflowExecutionRegistryLive: Layer.Layer<WorkflowExecutionRegistry> = Layer.effect(
  WorkflowExecutionRegistry
)(makeWorkflowExecutionRegistry())

export interface WorkflowsPanelOptions {
  readonly maxRows?: number
}

export class WorkflowsPanel extends Context.Service<WorkflowsPanel, WorkflowsPanelApi>()(
  "@effect-desktop/devtools/WorkflowsPanel"
) {}

export const WorkflowsPanelLive = (
  options: WorkflowsPanelOptions = {}
): Layer.Layer<WorkflowsPanel, never, WorkflowExecutionRegistry> =>
  Layer.effect(WorkflowsPanel)(makeWorkflowsPanel(options))

export const makeWorkflowsPanel = (
  options: WorkflowsPanelOptions = {}
): Effect.Effect<WorkflowsPanelApi, never, WorkflowExecutionRegistry> =>
  Effect.gen(function* () {
    const registry = yield* WorkflowExecutionRegistry
    const maxRows = positiveRowLimit(options.maxRows, 256)

    const list = (): Effect.Effect<WorkflowsPanelSnapshot, never, never> =>
      Effect.gen(function* () {
        const executions = yield* registry.list()
        const visible = executions.slice(-maxRows)
        return toSnapshot(visible)
      })

    return Object.freeze({
      list,
      observe: () =>
        registry.observe().pipe(Stream.map((executions) => toSnapshot(executions.slice(-maxRows))))
    } satisfies WorkflowsPanelApi)
  })

const applyEvent = (
  rows: readonly WorkflowExecutionRecord[],
  event: WorkflowExecutionEvent,
  maxRows: number
): readonly WorkflowExecutionRecord[] => {
  if (event.tag === "Started") {
    const record: WorkflowExecutionRecord = {
      executionId: event.executionId,
      workflowName: event.workflowName,
      state: "running",
      startedAt: event.startedAt,
      endedAt: Option.none(),
      durationMs: Option.none(),
      errorTag: Option.none()
    }
    return [...rows, record].slice(-maxRows)
  }

  return rows.map((row) => {
    if (row.executionId !== event.executionId) {
      return row
    }
    if (event.tag === "Completed") {
      return {
        ...row,
        state: "completed" as const,
        endedAt: Option.some(event.endedAt),
        durationMs: Option.some(Math.max(0, event.endedAt - row.startedAt))
      }
    }
    if (event.tag === "Failed") {
      return {
        ...row,
        state: "failed" as const,
        endedAt: Option.some(event.endedAt),
        durationMs: Option.some(Math.max(0, event.endedAt - row.startedAt)),
        errorTag: Option.some(event.errorTag)
      }
    }
    return {
      ...row,
      state: "interrupted" as const,
      endedAt: Option.some(event.endedAt),
      durationMs: Option.some(Math.max(0, event.endedAt - row.startedAt))
    }
  })
}

const toSnapshot = (executions: readonly WorkflowExecutionRecord[]): WorkflowsPanelSnapshot => ({
  executions,
  runningCount: executions.filter((r) => r.state === "running").length,
  completedCount: executions.filter((r) => r.state === "completed").length,
  failedCount: executions.filter((r) => r.state === "failed").length
})
