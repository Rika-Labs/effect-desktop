import type { RedactionFilterOptions } from "@effect-desktop/bridge"
import {
  Clock,
  Context,
  Data,
  Effect,
  Option,
  Random,
  Ref,
  Schema,
  Stream,
  SubscriptionRef
} from "effect"

import {
  emptyInspectorSafetySummary,
  makeInspectorSafetyPolicy,
  type InspectorSafetyPolicyApi,
  type InspectorSafetyPolicyOptions,
  type InspectorSafetySummary
} from "./inspector-safety-policy.js"

const TelemetryMetadataText = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)

export type TelemetryLogLevel = "debug" | "info" | "warn" | "error"

export interface TelemetryLogInput {
  readonly level: TelemetryLogLevel
  readonly subsystem: string
  readonly operation: string
  readonly traceId: string
  readonly message: string
  readonly timestamp?: number
  readonly resourceId?: string
  readonly windowId?: string
  readonly fields?: unknown
}

export interface TelemetryLogRecord {
  readonly id: number
  readonly level: TelemetryLogLevel
  readonly timestamp: number
  readonly subsystem: string
  readonly operation: string
  readonly traceId: string
  readonly resourceId: Option.Option<string>
  readonly windowId: Option.Option<string>
  readonly message: string
  readonly fields: Option.Option<unknown>
  readonly safety: InspectorSafetySummary
}

export interface TelemetryTraceSpanInput {
  readonly traceId: string
  readonly spanId?: string
  readonly parentSpanId?: string
  readonly subsystem: string
  readonly operation: string
  readonly name: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly attributes?: unknown
}

export interface TelemetryTraceSpan {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: Option.Option<string>
  readonly subsystem: string
  readonly operation: string
  readonly name: string
  readonly startedAt: number
  readonly endedAt: Option.Option<number>
  readonly durationMs: Option.Option<number>
  readonly attributes: Option.Option<unknown>
  readonly safety: InspectorSafetySummary
}

export interface TelemetryCounterInput {
  readonly name: string
  readonly by?: number
  readonly timestamp?: number
  readonly tags?: Readonly<Record<string, string>>
}

export interface TelemetryHistogramInput {
  readonly name: string
  readonly value: number
  readonly timestamp?: number
  readonly tags?: Readonly<Record<string, string>>
}

export interface TelemetryMetricBase {
  readonly name: string
  readonly tags: Readonly<Record<string, string>>
  readonly updatedAt: number
  readonly safety: InspectorSafetySummary
}

export interface TelemetryCounterSnapshot extends TelemetryMetricBase {
  readonly kind: "counter"
  readonly value: number
}

export interface TelemetryHistogramSnapshot extends TelemetryMetricBase {
  readonly kind: "histogram"
  readonly count: number
  readonly sum: number
  readonly min: number
  readonly max: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly samples: readonly number[]
}

export type TelemetryMetricSnapshot = TelemetryCounterSnapshot | TelemetryHistogramSnapshot

export interface TelemetrySnapshot {
  readonly logs: readonly TelemetryLogRecord[]
  readonly traces: readonly TelemetryTraceSpan[]
  readonly metrics: readonly TelemetryMetricSnapshot[]
  readonly safety: InspectorSafetySummary
}

export interface TelemetryApi {
  readonly log: (
    input: TelemetryLogInput
  ) => Effect.Effect<void, TelemetryInvalidArgumentError, never>
  readonly listLogs: () => Effect.Effect<readonly TelemetryLogRecord[], never, never>
  readonly observeLogs: () => Stream.Stream<readonly TelemetryLogRecord[], never, never>
  readonly recordSpan: (
    input: TelemetryTraceSpanInput
  ) => Effect.Effect<void, TelemetryInvalidArgumentError, never>
  readonly listTraces: () => Effect.Effect<readonly TelemetryTraceSpan[], never, never>
  readonly observeTraces: () => Stream.Stream<readonly TelemetryTraceSpan[], never, never>
  readonly incrementCounter: (
    input: TelemetryCounterInput
  ) => Effect.Effect<void, TelemetryInvalidArgumentError, never>
  readonly recordHistogram: (
    input: TelemetryHistogramInput
  ) => Effect.Effect<void, TelemetryInvalidArgumentError, never>
  readonly listMetrics: () => Effect.Effect<readonly TelemetryMetricSnapshot[], never, never>
  readonly observeMetrics: () => Stream.Stream<readonly TelemetryMetricSnapshot[], never, never>
  readonly snapshot: () => Effect.Effect<TelemetrySnapshot, never, never>
}

export class TelemetryInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
}> {}

export interface TelemetryOptions {
  readonly maxLogs?: number
  readonly maxMetrics?: number
  readonly maxHistogramSamples?: number
  readonly redaction?: RedactionFilterOptions
  readonly inspectorSafety?: InspectorSafetyPolicyApi
  readonly inspectorSafetyPolicy?: InspectorSafetyPolicyOptions
  readonly traceRingSize?: number
  readonly tracingEnabled?: boolean
  readonly now?: () => number
  readonly nextSpanId?: () => string
}

const DEFAULT_MAX_LOGS = 1_024
const DEFAULT_MAX_METRICS = 1_024
const DEFAULT_MAX_HISTOGRAM_SAMPLES = 1_024
const DEFAULT_TRACE_RING_SIZE = 10_000

export const makeTelemetry = (
  options: TelemetryOptions = {}
): Effect.Effect<TelemetryApi, TelemetryInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const maxLogs = yield* positiveIntegerOption(options.maxLogs, DEFAULT_MAX_LOGS, "maxLogs")
    const maxMetrics = yield* positiveIntegerOption(
      options.maxMetrics,
      DEFAULT_MAX_METRICS,
      "maxMetrics"
    )
    const maxHistogramSamples = yield* positiveIntegerOption(
      options.maxHistogramSamples,
      DEFAULT_MAX_HISTOGRAM_SAMPLES,
      "maxHistogramSamples"
    )
    const traceRingSize = yield* positiveIntegerOption(
      options.traceRingSize,
      DEFAULT_TRACE_RING_SIZE,
      "traceRingSize"
    )
    const tracingEnabled = options.tracingEnabled ?? true
    const now =
      options.now === undefined
        ? Clock.currentTimeMillis
        : Effect.sync(options.now).pipe(
            Effect.catchDefect(() =>
              Effect.fail(
                new TelemetryInvalidArgumentError({
                  operation: "Telemetry.clock",
                  field: "timestamp",
                  message: "clock callback failed"
                })
              )
            )
          )
    const nextSpanId =
      options.nextSpanId === undefined
        ? Random.nextUUIDv4.pipe(Effect.map((uuid) => `span-${uuid}`))
        : Effect.sync(options.nextSpanId)
    const redaction = options.inspectorSafetyPolicy?.redaction ?? options.redaction
    const safetyOptions: InspectorSafetyPolicyOptions =
      redaction === undefined
        ? { ...options.inspectorSafetyPolicy }
        : { ...options.inspectorSafetyPolicy, redaction }
    const inspectorSafety =
      options.inspectorSafety ??
      (yield* makeInspectorSafetyPolicy(safetyOptions).pipe(
        Effect.mapError(
          (error) =>
            new TelemetryInvalidArgumentError({
              operation: error.operation,
              field: error.field,
              message: error.message
            })
        )
      ))
    const nextLogId = yield* Ref.make(0)
    const logs = yield* SubscriptionRef.make<readonly TelemetryLogRecord[]>([])
    const traces = yield* SubscriptionRef.make<readonly TelemetryTraceSpan[]>([])
    const metrics = yield* SubscriptionRef.make<ReadonlyMap<string, TelemetryMetricSnapshot>>(
      new Map()
    )

    const listMetrics = (): Effect.Effect<readonly TelemetryMetricSnapshot[], never, never> =>
      SubscriptionRef.get(metrics).pipe(Effect.map((snapshot) => Array.from(snapshot.values())))

    return Object.freeze({
      log: (input) =>
        Effect.gen(function* () {
          yield* validateMetadataField(input.traceId, "Telemetry.log", "traceId")
          yield* validateOptionalMetadataField(input.resourceId, "Telemetry.log", "resourceId")
          yield* validateOptionalMetadataField(input.windowId, "Telemetry.log", "windowId")
          const id = yield* Ref.getAndUpdate(nextLogId, (current) => current + 1)
          const fieldsDecision =
            input.fields === undefined
              ? undefined
              : yield* inspectorSafety.sanitize({
                  source: "telemetry.logs.fields",
                  payload: input.fields
                })
          const fields =
            fieldsDecision === undefined || Option.isNone(fieldsDecision.value)
              ? Option.none()
              : Option.some(fieldsDecision.value.value)
          const decision = yield* inspectorSafety.sanitize({
            source: "telemetry.logs",
            payload: {
              id,
              level: input.level,
              timestamp: input.timestamp ?? (yield* now),
              subsystem: input.subsystem,
              operation: input.operation,
              traceId: input.traceId,
              resourceId: optionFrom(input.resourceId),
              windowId: optionFrom(input.windowId),
              message: input.message,
              fields
            } satisfies Omit<TelemetryLogRecord, "safety">
          })
          if (Option.isNone(decision.value)) {
            return
          }
          const record = {
            ...decision.value.value,
            safety: inspectorSafety.summarize([
              ...(fieldsDecision?.evidence ?? []),
              ...decision.evidence
            ])
          } satisfies TelemetryLogRecord
          yield* SubscriptionRef.update(logs, (current) => appendBounded(current, record, maxLogs))
        }),
      listLogs: () => SubscriptionRef.get(logs),
      observeLogs: () => SubscriptionRef.changes(logs),
      recordSpan: (input) =>
        Effect.gen(function* () {
          yield* validateMetadataField(input.traceId, "Telemetry.recordSpan", "traceId")
          yield* validateMetadataField(input.subsystem, "Telemetry.recordSpan", "subsystem")
          yield* validateMetadataField(input.operation, "Telemetry.recordSpan", "operation")
          yield* validateMetadataField(input.name, "Telemetry.recordSpan", "name")
          yield* validateOptionalMetadataField(input.spanId, "Telemetry.recordSpan", "spanId")
          yield* validateOptionalMetadataField(
            input.parentSpanId,
            "Telemetry.recordSpan",
            "parentSpanId"
          )
          const resolvedSpanId = input.spanId ?? (yield* nextSpanId)
          yield* validateMetadataField(resolvedSpanId, "Telemetry.recordSpan", "spanId")
          if (!tracingEnabled) {
            return
          }
          const attributesDecision =
            input.attributes === undefined
              ? undefined
              : yield* inspectorSafety.sanitize({
                  source: "telemetry.traces.attributes",
                  payload: input.attributes
                })
          const decision = yield* inspectorSafety.sanitize({
            source: "telemetry.traces",
            payload: toTraceSpan(
              {
                ...input,
                attributes:
                  attributesDecision === undefined || Option.isNone(attributesDecision.value)
                    ? undefined
                    : attributesDecision.value.value
              },
              resolvedSpanId
            )
          })
          if (Option.isNone(decision.value)) {
            return
          }
          const span = {
            ...decision.value.value,
            safety: inspectorSafety.summarize([
              ...(attributesDecision?.evidence ?? []),
              ...decision.evidence
            ])
          } satisfies TelemetryTraceSpan
          yield* SubscriptionRef.update(traces, (current) =>
            appendBounded(current, span, traceRingSize)
          )
        }),
      listTraces: () => SubscriptionRef.get(traces),
      observeTraces: () => SubscriptionRef.changes(traces),
      incrementCounter: (input) =>
        Effect.gen(function* () {
          const operation = "Telemetry.incrementCounter"
          yield* validateMetricMetadata(input.name, input.tags, operation)
          const timestamp = yield* metricTimestamp(input.timestamp, now, operation)
          const decision = yield* inspectorSafety.sanitize({
            source: "telemetry.metrics",
            payload: toCounterSnapshot(input, timestamp)
          })
          if (Option.isNone(decision.value)) {
            return
          }
          const metric = {
            ...decision.value.value,
            safety: decision.summary
          } satisfies TelemetryCounterSnapshot
          yield* SubscriptionRef.update(metrics, (current) =>
            upsertMetric(current, metric, maxMetrics)
          )
        }),
      recordHistogram: (input) =>
        Effect.gen(function* () {
          const operation = "Telemetry.recordHistogram"
          yield* validateMetricMetadata(input.name, input.tags, operation)
          const timestamp = yield* metricTimestamp(input.timestamp, now, operation)
          const decision = yield* inspectorSafety.sanitize({
            source: "telemetry.metrics",
            payload: toHistogramSnapshot(input, timestamp, maxHistogramSamples)
          })
          if (Option.isNone(decision.value)) {
            return
          }
          const metric = {
            ...decision.value.value,
            safety: decision.summary
          } satisfies TelemetryHistogramSnapshot
          yield* SubscriptionRef.update(metrics, (current) =>
            upsertMetric(current, metric, maxMetrics, maxHistogramSamples)
          )
        }),
      listMetrics,
      observeMetrics: () =>
        SubscriptionRef.changes(metrics).pipe(
          Stream.map((snapshot) => Array.from(snapshot.values()))
        ),
      snapshot: () =>
        Effect.gen(function* () {
          const logRows = yield* SubscriptionRef.get(logs)
          const traceRows = yield* SubscriptionRef.get(traces)
          const metricRows = yield* listMetrics()
          const safety = yield* inspectorSafety.snapshot()
          return { logs: logRows, traces: traceRows, metrics: metricRows, safety }
        })
    } satisfies TelemetryApi)
  })

export class Telemetry extends Context.Service<Telemetry, TelemetryApi>()("Telemetry", {
  make: makeTelemetry()
}) {}

const positiveIntegerOption = (
  value: number | undefined,
  fallback: number,
  field: string
): Effect.Effect<number, TelemetryInvalidArgumentError, never> => {
  const resolved = value ?? fallback
  return Number.isInteger(resolved) && resolved > 0
    ? Effect.succeed(resolved)
    : Effect.fail(
        new TelemetryInvalidArgumentError({
          operation: "Telemetry.make",
          field,
          message: "must be a positive integer"
        })
      )
}

const validateMetadataField = (
  value: string,
  operation: string,
  field: string
): Effect.Effect<void, TelemetryInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(TelemetryMetadataText)(value).pipe(
    Effect.asVoid,
    Effect.mapError(
      () =>
        new TelemetryInvalidArgumentError({
          operation,
          field,
          message: "must be a printable non-empty string"
        })
    )
  )

const validateOptionalMetadataField = (
  value: string | undefined,
  operation: string,
  field: string
): Effect.Effect<void, TelemetryInvalidArgumentError, never> =>
  value === undefined ? Effect.void : validateMetadataField(value, operation, field)

const validateMetricMetadata = (
  name: string,
  tags: Readonly<Record<string, string>> | undefined,
  operation: string
): Effect.Effect<void, TelemetryInvalidArgumentError, never> =>
  Effect.gen(function* () {
    yield* validateMetadataField(name, operation, "name")
    if (tags === undefined) {
      return
    }
    for (const [key, value] of Object.entries(tags)) {
      yield* validateMetadataField(key, operation, "tags.key")
      yield* validateMetadataField(value, operation, "tags.value")
    }
  })

const appendBounded = <A>(current: readonly A[], value: A, maxRows: number): readonly A[] =>
  [...current, value].slice(-maxRows)

const optionFrom = <A>(value: A | undefined): Option.Option<A> =>
  value === undefined ? Option.none() : Option.some(value)

const toTraceSpan = (input: TelemetryTraceSpanInput, spanId: string): TelemetryTraceSpan => ({
  traceId: input.traceId,
  spanId,
  parentSpanId: optionFrom(input.parentSpanId),
  subsystem: input.subsystem,
  operation: input.operation,
  name: input.name,
  startedAt: input.startedAt,
  endedAt: optionFrom(input.endedAt),
  durationMs:
    input.endedAt === undefined
      ? Option.none()
      : Option.some(Math.max(0, input.endedAt - input.startedAt)),
  attributes: optionFrom(input.attributes),
  safety: emptyInspectorSafetySummary
})

const metricKey = (name: string, tags: Readonly<Record<string, string>>): string =>
  `${name}\u0000${Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000")}`

const metricTimestamp = (
  inputTimestamp: number | undefined,
  now: Effect.Effect<number, TelemetryInvalidArgumentError, never>,
  operation: string
): Effect.Effect<number, TelemetryInvalidArgumentError, never> =>
  (inputTimestamp === undefined ? now : Effect.succeed(inputTimestamp)).pipe(
    Effect.flatMap((timestamp) =>
      Number.isSafeInteger(timestamp) && timestamp >= 0
        ? Effect.succeed(timestamp)
        : Effect.fail(
            new TelemetryInvalidArgumentError({
              operation,
              field: "timestamp",
              message: "must be a finite non-negative safe integer"
            })
          )
    ),
    Effect.catchDefect(() =>
      Effect.fail(
        new TelemetryInvalidArgumentError({
          operation,
          field: "timestamp",
          message: "timestamp clock failed"
        })
      )
    )
  )

const toCounterSnapshot = (
  input: TelemetryCounterInput,
  timestamp: number
): TelemetryCounterSnapshot => ({
  kind: "counter",
  name: input.name,
  tags: input.tags ?? {},
  updatedAt: timestamp,
  safety: emptyInspectorSafetySummary,
  value: input.by ?? 1
})

const toHistogramSnapshot = (
  input: TelemetryHistogramInput,
  timestamp: number,
  maxSamples: number
): TelemetryHistogramSnapshot => ({
  kind: "histogram",
  name: input.name,
  tags: input.tags ?? {},
  updatedAt: timestamp,
  safety: emptyInspectorSafetySummary,
  count: 1,
  sum: input.value,
  min: input.value,
  max: input.value,
  p50: input.value,
  p95: input.value,
  p99: input.value,
  samples: [input.value].slice(-maxSamples)
})

const upsertMetric = (
  current: ReadonlyMap<string, TelemetryMetricSnapshot>,
  nextMetric: TelemetryMetricSnapshot,
  maxMetrics: number,
  maxHistogramSamples = DEFAULT_MAX_HISTOGRAM_SAMPLES
): ReadonlyMap<string, TelemetryMetricSnapshot> => {
  const key = metricKey(nextMetric.name, nextMetric.tags)
  const existing = current.get(key)
  const next = new Map(current)
  next.set(key, mergeMetric(existing, nextMetric, maxHistogramSamples))
  while (next.size > maxMetrics) {
    const oldest = oldestMetricKey(next)
    if (oldest === undefined) {
      break
    }
    next.delete(oldest)
  }
  return next
}

const oldestMetricKey = (
  metrics: ReadonlyMap<string, TelemetryMetricSnapshot>
): string | undefined => {
  let oldestKey: string | undefined
  let oldestUpdatedAt = Number.POSITIVE_INFINITY
  for (const [key, metric] of metrics) {
    if (metric.updatedAt < oldestUpdatedAt) {
      oldestKey = key
      oldestUpdatedAt = metric.updatedAt
    }
  }
  return oldestKey
}

const mergeMetric = (
  existing: TelemetryMetricSnapshot | undefined,
  next: TelemetryMetricSnapshot,
  maxHistogramSamples: number
): TelemetryMetricSnapshot => {
  if (existing === undefined || existing.kind !== next.kind) {
    return next
  }

  if (existing.kind === "counter" && next.kind === "counter") {
    return {
      ...existing,
      value: existing.value + next.value,
      updatedAt: next.updatedAt
    }
  }

  if (existing.kind === "histogram" && next.kind === "histogram") {
    const samples = [...existing.samples, ...next.samples].slice(-maxHistogramSamples)
    return {
      ...existing,
      count: existing.count + next.count,
      sum: existing.sum + next.sum,
      min: Math.min(existing.min, next.min),
      max: Math.max(existing.max, next.max),
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
      samples,
      updatedAt: next.updatedAt
    }
  }

  return next
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
