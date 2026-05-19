import {
  InspectorSafetyPolicy,
  type InspectorSafetyPolicyApi,
  type InspectorSafetySummary,
  Telemetry,
  type TelemetryHistogramSnapshot
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schedule, Stream } from "effect"

import { positiveFrameInterval } from "./panel-options.js"

export type PerformanceBudgetMode = "development" | "production"
export type PerformanceOverlayStatus = "missing" | "within-budget" | "over-budget"

export interface PerformanceBudget {
  readonly id: string
  readonly label: string
  readonly metricName: string
  readonly budgetMs: number
}

export interface PerformanceOverlayRow {
  readonly id: string
  readonly label: string
  readonly valueMs: Option.Option<number>
  readonly budgetMs: number
  readonly ratio: Option.Option<number>
  readonly status: PerformanceOverlayStatus
  readonly samples: readonly number[]
}

export interface BridgeP99OverlayRow extends PerformanceOverlayRow {
  readonly contractTag: string
}

export interface PerformanceOverlaySnapshot {
  readonly startup: readonly PerformanceOverlayRow[]
  readonly bridgeP99: readonly BridgeP99OverlayRow[]
  readonly renderFrame: PerformanceOverlayRow
  readonly safety: InspectorSafetySummary
}

export interface PerformanceOverlayApi {
  readonly list: () => Effect.Effect<PerformanceOverlaySnapshot, never, never>
  readonly observe: () => Stream.Stream<PerformanceOverlaySnapshot, never, never>
}

export interface PerformanceOverlayOptions {
  readonly mode?: PerformanceBudgetMode
  readonly frameInterval?: `${number} millis`
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export class PerformanceOverlay extends Context.Service<
  PerformanceOverlay,
  PerformanceOverlayApi
>()("@effect-desktop/devtools/performance-overlay/PerformanceOverlay") {}

export const PerformanceOverlayLive = (
  options: PerformanceOverlayOptions = {}
): Layer.Layer<PerformanceOverlay, never, Telemetry | InspectorSafetyPolicy> =>
  Layer.effect(PerformanceOverlay)(makePerformanceOverlay(options))

export const makePerformanceOverlay = (
  options: PerformanceOverlayOptions = {}
): Effect.Effect<PerformanceOverlayApi, never, Telemetry | InspectorSafetyPolicy> =>
  Effect.gen(function* () {
    const telemetry = yield* Telemetry
    const inspectorSafety = options.inspectorSafety ?? (yield* InspectorSafetyPolicy)
    const mode = options.mode ?? "development"
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<PerformanceOverlaySnapshot, never, never> =>
      Effect.gen(function* () {
        const metrics = yield* telemetry.listMetrics()
        const histograms = metrics.filter(isHistogram)
        const decision = yield* inspectorSafety.sanitize({
          source: "devtools.performance",
          payload: {
            startup: startupBudgets(mode).map((budget) =>
              toBudgetRow(
                budget.id,
                budget.label,
                findHistogram(histograms, budget.metricName),
                budget.budgetMs
              )
            ),
            bridgeP99: bridgeP99Rows(histograms, BRIDGE_P99_BUDGET_MS),
            renderFrame: toBudgetRow(
              "renderer.frame",
              "Renderer frame",
              findHistogram(histograms, "renderer.frame"),
              RENDER_FRAME_BUDGET_MS
            )
          } satisfies Omit<PerformanceOverlaySnapshot, "safety">
        })
        if (Option.isNone(decision.value)) {
          return {
            startup: [],
            bridgeP99: [],
            renderFrame: emptyPerformanceOverlayRow("renderer.frame", "Renderer frame"),
            safety: decision.summary
          } satisfies PerformanceOverlaySnapshot
        }
        return {
          ...decision.value.value,
          safety: decision.summary
        } satisfies PerformanceOverlaySnapshot
      })

    return Object.freeze({
      list,
      observe: () => Stream.fromEffectSchedule(list(), Schedule.spaced(frameInterval))
    } satisfies PerformanceOverlayApi)
  })

const startupBudgets = (mode: PerformanceBudgetMode): readonly PerformanceBudget[] =>
  mode === "development" ? DEVELOPMENT_STARTUP_BUDGETS : PRODUCTION_STARTUP_BUDGETS

const BRIDGE_P99_BUDGET_MS = 50
const RENDER_FRAME_BUDGET_MS = 16.7

const emptyPerformanceOverlayRow = (id: string, label: string): PerformanceOverlayRow => ({
  id,
  label,
  valueMs: Option.none(),
  budgetMs: 0,
  ratio: Option.none(),
  status: "missing",
  samples: []
})

const DEVELOPMENT_STARTUP_BUDGETS: readonly PerformanceBudget[] = [
  {
    id: "cli.config-load",
    label: "CLI config load",
    metricName: "startup.cli.config_load",
    budgetMs: 100
  },
  {
    id: "native.host-boot",
    label: "Native host boot",
    metricName: "startup.native_host_boot",
    budgetMs: 150
  },
  {
    id: "runtime.boot",
    label: "Runtime boot",
    metricName: "startup.runtime_boot",
    budgetMs: 250
  },
  {
    id: "first.window-created",
    label: "First window created",
    metricName: "startup.first_window_created",
    budgetMs: 500
  },
  {
    id: "bridge.ready",
    label: "Bridge ready",
    metricName: "startup.bridge_ready",
    budgetMs: 100
  }
]

const PRODUCTION_STARTUP_BUDGETS: readonly PerformanceBudget[] = [
  {
    id: "native.host-boot",
    label: "Native host boot",
    metricName: "startup.native_host_boot",
    budgetMs: 100
  },
  {
    id: "runtime.boot",
    label: "Runtime boot",
    metricName: "startup.runtime_boot",
    budgetMs: 200
  },
  {
    id: "first.window-visible",
    label: "First window visible",
    metricName: "startup.first_window_visible",
    budgetMs: 700
  },
  {
    id: "bridge.ready",
    label: "Initial bridge ready",
    metricName: "startup.bridge_ready",
    budgetMs: 100
  },
  {
    id: "basic.interactive",
    label: "Basic app interactive",
    metricName: "startup.basic_interactive",
    budgetMs: 1_200
  }
]

const isHistogram = (metric: unknown): metric is TelemetryHistogramSnapshot =>
  typeof metric === "object" && metric !== null && "kind" in metric && metric.kind === "histogram"

const findHistogram = (
  histograms: readonly TelemetryHistogramSnapshot[],
  metricName: string
): TelemetryHistogramSnapshot | undefined =>
  histograms.find((histogram) => histogram.name === metricName)

const bridgeP99Rows = (
  histograms: readonly TelemetryHistogramSnapshot[],
  budgetMs: number
): readonly BridgeP99OverlayRow[] => {
  const samplesByContract = new Map<string, number[]>()
  for (const histogram of histograms) {
    if (histogram.name !== "bridge.latency") {
      continue
    }

    const contractTag = histogram.tags["contractTag"] ?? "unknown"
    const samples = samplesByContract.get(contractTag) ?? []
    samples.push(...histogram.samples)
    samplesByContract.set(contractTag, samples)
  }

  return Array.from(samplesByContract, ([contractTag, samples]) => {
    const valueMs = percentile(samples, 0.99)
    return {
      id: `bridge.${contractTag}`,
      label: `Bridge ${contractTag} p99`,
      valueMs: Option.some(valueMs),
      budgetMs,
      ratio: Option.some(valueMs / budgetMs),
      status: valueMs > budgetMs ? "over-budget" : "within-budget",
      samples,
      contractTag
    }
  })
}

const toBudgetRow = (
  id: string,
  label: string,
  histogram: TelemetryHistogramSnapshot | undefined,
  budgetMs: number
): PerformanceOverlayRow => {
  if (histogram === undefined) {
    return {
      id,
      label,
      valueMs: Option.none(),
      budgetMs,
      ratio: Option.none(),
      status: "missing",
      samples: []
    }
  }

  const valueMs = histogram.p99
  return {
    id,
    label,
    valueMs: Option.some(valueMs),
    budgetMs,
    ratio: Option.some(valueMs / budgetMs),
    status: valueMs > budgetMs ? "over-budget" : "within-budget",
    samples: histogram.samples
  }
}

const percentile = (samples: readonly number[], percentile: number): number => {
  const sorted = samples.toSorted((left, right) => left - right)
  const lastIndex = sorted.length - 1
  if (lastIndex < 0) {
    return 0
  }
  const index = Math.min(lastIndex, Math.max(0, Math.ceil(sorted.length * percentile) - 1))
  return sorted[index] ?? 0
}
