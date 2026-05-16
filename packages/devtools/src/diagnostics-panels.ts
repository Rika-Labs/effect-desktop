import {
  emptyInspectorSafetySummary,
  InspectorSafetyPolicy,
  type InspectorSafetyPolicyApi,
  type InspectorSafetySummary,
  Telemetry,
  type TelemetryLogRecord,
  type TelemetryMetricSnapshot,
  type TelemetryTraceSpan
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schedule, Stream } from "effect"

import { positiveFrameInterval, positiveRowLimit } from "./panel-options.js"

export interface TraceGroup {
  readonly traceId: string
  readonly spans: readonly TelemetryTraceSpan[]
}

export interface DiagnosticsPanelsSnapshot {
  readonly logs: readonly TelemetryLogRecord[]
  readonly traces: readonly TraceGroup[]
  readonly metrics: readonly TelemetryMetricSnapshot[]
  readonly safety: InspectorSafetySummary
}

export interface DiagnosticsPanelsApi {
  readonly list: () => Effect.Effect<DiagnosticsPanelsSnapshot, never, never>
  readonly observe: () => Stream.Stream<DiagnosticsPanelsSnapshot, never, never>
}

export interface DiagnosticsPanelsOptions {
  readonly maxRows?: number
  readonly frameInterval?: `${number} millis`
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export class DiagnosticsPanels extends Context.Service<DiagnosticsPanels, DiagnosticsPanelsApi>()(
  "@effect-desktop/devtools/DiagnosticsPanels"
) {}

export const DiagnosticsPanelsLive = (
  options: DiagnosticsPanelsOptions = {}
): Layer.Layer<DiagnosticsPanels, never, Telemetry | InspectorSafetyPolicy> =>
  Layer.effect(DiagnosticsPanels)(makeDiagnosticsPanels(options))

export const makeDiagnosticsPanels = (
  options: DiagnosticsPanelsOptions = {}
): Effect.Effect<DiagnosticsPanelsApi, never, Telemetry | InspectorSafetyPolicy> =>
  Effect.gen(function* () {
    const telemetry = yield* Telemetry
    const inspectorSafety = options.inspectorSafety ?? (yield* InspectorSafetyPolicy)
    const maxRows = positiveRowLimit(options.maxRows, 256)
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<DiagnosticsPanelsSnapshot, never, never> =>
      Effect.gen(function* () {
        const snapshot = yield* telemetry.snapshot()
        const decision = yield* inspectorSafety.sanitize({
          source: "devtools.diagnostics",
          payload: {
            logs: snapshot.logs.slice(-maxRows),
            traces: groupTraceSpans(selectTraceProjectionSpans(snapshot.traces, maxRows)),
            metrics: snapshot.metrics.slice(-maxRows)
          } satisfies Omit<DiagnosticsPanelsSnapshot, "safety">
        })
        if (Option.isNone(decision.value)) {
          return {
            logs: [],
            traces: [],
            metrics: [],
            safety: decision.summary
          } satisfies DiagnosticsPanelsSnapshot
        }
        return {
          ...decision.value.value,
          safety: decision.summary
        } satisfies DiagnosticsPanelsSnapshot
      })

    return Object.freeze({
      list,
      observe: () => Stream.fromEffectSchedule(list(), Schedule.spaced(frameInterval))
    } satisfies DiagnosticsPanelsApi)
  })

const groupTraceSpans = (spans: readonly TelemetryTraceSpan[]): readonly TraceGroup[] => {
  const groups = new Map<string, TelemetryTraceSpan[]>()
  for (const span of spans) {
    const group = groups.get(span.traceId) ?? []
    group.push(span)
    groups.set(span.traceId, group)
  }
  return Array.from(groups, ([traceId, group]) => ({
    traceId,
    spans: group.toSorted((left, right) => left.startedAt - right.startedAt)
  }))
}

const selectTraceProjectionSpans = (
  spans: readonly TelemetryTraceSpan[],
  maxRows: number
): readonly TelemetryTraceSpan[] => {
  const windowStart = Math.max(0, spans.length - maxRows)
  const selected = new Set<number>()
  const pendingParents = new Set<string>()

  for (let index = windowStart; index < spans.length; index += 1) {
    const span = spans[index]
    if (span === undefined) {
      continue
    }

    selected.add(index)
    addPendingParent(pendingParents, span)
  }

  for (let index = windowStart - 1; index >= 0 && pendingParents.size > 0; index -= 1) {
    const span = spans[index]
    if (span === undefined) {
      continue
    }

    const key = traceSpanKey(span)
    if (!pendingParents.has(key)) {
      continue
    }

    selected.add(index)
    pendingParents.delete(key)
    addPendingParent(pendingParents, span)
  }

  return spans.filter((_, index) => selected.has(index))
}

const addPendingParent = (pendingParents: Set<string>, span: TelemetryTraceSpan): void => {
  if (Option.isSome(span.parentSpanId)) {
    pendingParents.add(`${span.traceId}\u0000${span.parentSpanId.value}`)
  }
}

const traceSpanKey = (span: TelemetryTraceSpan): string => `${span.traceId}\u0000${span.spanId}`

export const emptyDiagnosticsPanelsSnapshot = Object.freeze({
  logs: [],
  traces: [],
  metrics: [],
  safety: emptyInspectorSafetySummary
} satisfies DiagnosticsPanelsSnapshot)
