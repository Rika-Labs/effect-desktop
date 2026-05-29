---
title: Telemetry
description: Structured logs, trace spans, metrics with bounded buffers.
kind: reference
audience: app-developers
effect_version: 4
---

# `Telemetry`

Owns the runtime diagnostic stream — structured logs, trace spans, and metric snapshots. Logs are redacted before storage. Traces tie to Effect's tracing. Metrics aggregate by name and tags with bounded sample buffers for histogram percentiles.

## Import

```ts
import {
  Telemetry,
  type TelemetryApi,
  type TelemetryOptions,
  type TelemetryLogRecord,
  type TelemetryTraceSpan,
  type TelemetryMetricSnapshot,
  type TelemetrySnapshot,
  type InspectorTelemetryEvent,
  makeTelemetry,
  EffectTelemetryCollector,
  EffectTelemetryCollectorLive,
  EffectTelemetryRuntimeLive
} from "@orika/core"
```

`makeTelemetry(options)` returns an `Effect<TelemetryApi>` — wrap it in `Layer.effect(Telemetry, ...)` if you want to provide a custom-configured instance. The default `Telemetry` service is constructed with no options.

## API

| Method                 | Signature                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `log`                  | `(input: TelemetryLogInput) => Effect<void, InvalidArgument>`                         |
| `listLogs`             | `() => Effect<readonly TelemetryLogRecord[]>`                                         |
| `observeLogs`          | `() => Stream<readonly TelemetryLogRecord[]>`                                         |
| `recordSpan`           | `(input: TelemetryTraceSpanInput) => Effect<void, InvalidArgument>`                   |
| `listTraces`           | `() => Effect<readonly TelemetryTraceSpan[]>`                                         |
| `observeTraces`        | `() => Stream<readonly TelemetryTraceSpan[]>`                                         |
| `incrementCounter`     | `(input: TelemetryCounterInput) => Effect<void, InvalidArgument>`                     |
| `recordHistogram`      | `(input: TelemetryHistogramInput) => Effect<void, InvalidArgument>`                   |
| `listMetrics`          | `() => Effect<readonly TelemetryMetricSnapshot[]>`                                    |
| `observeMetrics`       | `() => Stream<readonly TelemetryMetricSnapshot[]>`                                    |
| `captureCause`         | `(input: { traceId, operation, cause, timestamp? }) => Effect<void, InvalidArgument>` |
| `collectEffectMetrics` | `() => Effect<void, InvalidArgument>` — pulls `Metric.snapshot`                       |
| `listEvents`           | `() => Effect<readonly InspectorTelemetryEvent[]>`                                    |
| `observeEvents`        | `() => Stream<readonly InspectorTelemetryEvent[]>`                                    |
| `eventFeed`            | `Stream<InspectorTelemetryEvent>` (replayed PubSub feed)                              |
| `snapshot`             | `() => Effect<TelemetrySnapshot>`                                                     |

`TelemetrySnapshot` is `{ logs, traces, metrics, events, safety }` — every payload pre-redacted by `InspectorSafetyPolicy`.

## `TelemetryLogRecord`

`{ id, level, timestamp, subsystem, operation, traceId, resourceId: Option, windowId: Option, message, fields: Option, safety }` — sanitized through `InspectorSafetyPolicy` before storage.

## `TelemetryTraceSpan`

Captured from Effect's tracer (`EffectTelemetryCollector` wires `Tracer.Tracer` into the runtime). Stored in a bounded ring (`traceRingSize`, default 10,000). When `tracingEnabled: false`, `recordSpan` is a no-op rather than silently failing — the trace ring stays empty.

## `TelemetryMetricSnapshot`

Union of `TelemetryCounterSnapshot` (`{ kind: "counter", value, ... }`) and `TelemetryHistogramSnapshot` (`{ kind: "histogram", count, sum, min, max, p50, p95, p99, samples, ... }`). Counters merge by `(name, tags)` key; histograms keep a bounded sample buffer.

## `InspectorTelemetryEvent`

Tagged union (`log`, `trace`, `metric`, `cause`) republished on `eventFeed` and consumed by `DesktopDevtools` for the unified inspector stream.

## Configuration

`makeTelemetry(options)`:

```ts
{
  maxLogs?: number              // default 1024
  maxMetrics?: number           // default 1024
  maxHistogramSamples?: number  // default 1024
  traceRingSize?: number        // default 10000
  eventRingSize?: number        // default 10000
  tracingEnabled?: boolean      // default true
  redaction?: RedactionFilterOptions
  inspectorSafety?: InspectorSafetyPolicyApi
  inspectorSafetyPolicy?: InspectorSafetyPolicyOptions
  now?: () => number
}
```

`maxMetrics` caps the snapshot map for high-cardinality callers; oldest-by-`updatedAt` is evicted first.

## Effect runtime wiring

`EffectTelemetryRuntimeLive` installs a `Logger` and `Tracer` that route every `Effect.log*` call and `Effect.withSpan` into `Telemetry`. `DesktopObservability.layer` provides it automatically — you only build it by hand for embedded scenarios.

## Errors

- `InvalidArgument` on construction (bad buffer sizes) and on log/span/metric input (non-printable metadata, non-finite timestamps, empty names).

## Example

```ts
import { Effect } from "effect"
import { Telemetry } from "@orika/core"

yield *
  Effect.logInfo("Imported notes").pipe(Effect.annotateLogs({ count: 12, source: "Notes.import" }))

const telemetry = yield * Telemetry
const recent = yield * telemetry.listLogs()
```

## Related

- How-to: [Add telemetry and logs](../../how-to/add-telemetry-and-logs.md)
- Reference: [`AuditEvents`](audit-events.md)
- Source: [`packages/core/src/runtime/telemetry.ts`](../../../packages/core/src/runtime/telemetry.ts)
