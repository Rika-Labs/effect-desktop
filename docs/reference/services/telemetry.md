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
  type LogEntry,
  type TraceSpan,
  type MetricSnapshot,
  makeTelemetry
} from "@orika/core"
```

## API

| Method           | Signature                                 |
| ---------------- | ----------------------------------------- |
| `snapshot`       | `() => Effect<{ logs, traces, metrics }>` |
| `listLogs`       | `(filter?) => Effect<LogEntry[]>`         |
| `listTraces`     | `(filter?) => Effect<TraceSpan[]>`        |
| `listMetrics`    | `() => Effect<MetricSnapshot[]>`          |
| `observeLogs`    | `() => Stream<LogEntry>`                  |
| `observeTraces`  | `() => Stream<TraceSpan>`                 |
| `observeMetrics` | `() => Stream<MetricSnapshot>`            |

## `LogEntry`

`{ level, timestamp, subsystem, operation, traceId, resourceId?, windowId?, message, details }` — redacted before storage.

## `TraceSpan`

Captured from Effect tracing. Stored in a bounded ring (`traceRingSize` default 10,000). Tracing can be explicitly disabled (leaves the trace panel empty rather than pretending it succeeded).

## `MetricSnapshot`

`{ name, tags, kind: "counter" | "histogram", value }` — counters by tag, histograms with p50, p95, p99 plus bounded samples.

## Configuration

`makeTelemetry(options)`:

```ts
{
  logRingSize?: number          // default 10000
  traceRingSize?: number        // default 10000
  maxMetrics?: number           // default 1000
  histogramSampleSize?: number  // default 256
  tracingEnabled?: boolean      // default true
}
```

`maxMetrics` caps the snapshot map for high-cardinality callers.

## Errors

- `InvalidArgument` on construction with bad buffer sizes.

## Example

```ts
import { Effect } from "effect"

yield *
  Effect.logInfo("Imported notes").pipe(Effect.annotateLogs({ count: 12, source: "Notes.import" }))

const telemetry = yield * Telemetry
const recent = yield * telemetry.listLogs({ limit: 100 })
```

## Related

- How-to: [Add telemetry and logs](../../how-to/add-telemetry-and-logs.md)
- Reference: [`AuditEvents`](audit-events.md)
- Source: [`packages/core/src/runtime/telemetry.ts`](../../../packages/core/src/runtime/telemetry.ts)
