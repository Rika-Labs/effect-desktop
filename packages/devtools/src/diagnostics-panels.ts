import {
  redact,
  Telemetry,
  type TelemetryLogRecord,
  type TelemetryMetricSnapshot,
  type TelemetryTraceSpan
} from "@effect-desktop/core"
import { Context, Effect, Layer, Stream } from "effect"

export interface TraceGroup {
  readonly traceId: string
  readonly spans: readonly TelemetryTraceSpan[]
}

export interface DiagnosticsPanelsSnapshot {
  readonly logs: readonly TelemetryLogRecord[]
  readonly traces: readonly TraceGroup[]
  readonly metrics: readonly TelemetryMetricSnapshot[]
}

export interface DiagnosticsPanelsApi {
  readonly list: () => Effect.Effect<DiagnosticsPanelsSnapshot, never, never>
  readonly observe: () => Stream.Stream<DiagnosticsPanelsSnapshot, never, never>
}

export interface DiagnosticsPanelsOptions {
  readonly maxRows?: number
  readonly frameInterval?: `${number} millis`
}

export class DiagnosticsPanels extends Context.Service<DiagnosticsPanels, DiagnosticsPanelsApi>()(
  "@effect-desktop/devtools/DiagnosticsPanels"
) {}

export const DiagnosticsPanelsLive = (
  options: DiagnosticsPanelsOptions = {}
): Layer.Layer<DiagnosticsPanels, never, Telemetry> =>
  Layer.effect(DiagnosticsPanels)(makeDiagnosticsPanels(options))

export const makeDiagnosticsPanels = (
  options: DiagnosticsPanelsOptions = {}
): Effect.Effect<DiagnosticsPanelsApi, never, Telemetry> =>
  Effect.gen(function* () {
    const telemetry = yield* Telemetry
    const maxRows = options.maxRows ?? 256
    const frameInterval = options.frameInterval ?? "16 millis"

    const list = (): Effect.Effect<DiagnosticsPanelsSnapshot, never, never> =>
      Effect.gen(function* () {
        const snapshot = yield* telemetry.snapshot()
        return redact({
          logs: snapshot.logs.slice(-maxRows),
          traces: groupTraceSpans(snapshot.traces).slice(-maxRows),
          metrics: snapshot.metrics.slice(-maxRows)
        } satisfies DiagnosticsPanelsSnapshot)
      })

    return Object.freeze({
      list,
      observe: () =>
        Stream.fromEffect(list()).pipe(
          Stream.concat(
            Stream.fromEffectRepeat(Effect.sleep(frameInterval).pipe(Effect.andThen(list())))
          )
        )
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
