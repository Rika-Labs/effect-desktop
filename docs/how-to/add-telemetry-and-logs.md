---
title: How to add telemetry and logs
description: Emit structured logs, trace spans, and metrics through the Telemetry service.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to add telemetry and logs

`Telemetry` owns the runtime's structured logs, trace spans, and metric snapshots. Logs are redacted before storage. Traces tie to Effect's tracing. Metrics aggregate by name and tags.

## 1. Log

Use Effect's `Effect.log`, `logInfo`, `logWarning`, `logError` — they integrate with the desktop logger:

```ts
import { Effect } from "effect"

yield* Effect.logInfo("Imported notes").pipe(
  Effect.annotateLogs({ count: 12, source: "Notes.import" })
)
```

The log carries level, timestamp, subsystem, operation, trace id, message, and your annotations. Secret-shaped fields in annotations are redacted before storage.

## 2. Trace

Effect's tracing is wired automatically — every Effect span is captured in `Telemetry`'s trace ring (default 10,000 spans). To add custom spans:

```ts
import { Effect, Tracer } from "effect"

yield* Effect.gen(function* () {
  // ... work
}).pipe(
  Effect.withSpan("Notes.import.process_file", { attributes: { path } })
)
```

## 3. Metrics

```ts
import { Metric } from "effect"

const importedNotes = Metric.counter("notes.imported")
const importDuration = Metric.histogram("notes.import.duration", { boundaries: [10, 100, 1000] })

yield* importedNotes(Effect.succeed(1))
yield* importDuration(Effect.succeed(elapsedMs))
```

Counters increment by tags. Histograms retain bounded samples and publish p50, p95, p99.

## 4. Read

```ts
const telemetry = yield* Telemetry
const snapshot = yield* telemetry.snapshot()
const recentLogs = yield* telemetry.listLogs({ limit: 100 })
const recentSpans = yield* telemetry.listTraces({ limit: 50 })
const metrics = yield* telemetry.listMetrics()
```

Devtools' logs panel renders these live. `observeLogs()`, `observeTraces()`, `observeMetrics()` stream new entries.

## 5. Configure bounds

```ts
import { makeTelemetry } from "@effect-desktop/core"

const TelemetryLive = makeTelemetry({
  logRingSize: 5000,
  traceRingSize: 1000,
  maxMetrics: 200,
  histogramSampleSize: 256
})
```

The ring sizes prevent unbounded memory growth from chatty handlers. `maxMetrics` caps the metric snapshot map so high-cardinality metrics don't explode the snapshot.

## When to log vs. emit an audit event

- **Log** — anything humans should read to understand what happened. App fetched 12 records. Index complete in 3.2s.
- **Audit** — privileged operations that must be _provable_ later. User granted permission. Secret accessed. Update installed. Audit events are emitted by the framework's services automatically; you rarely emit them yourself.

## Related

- Reference: [`Telemetry`](../reference/services/telemetry.md), [`AuditEvents`](../reference/services/audit-events.md)
- Explanation: [Audit and redaction](../explanation/audit-and-redaction.md)
