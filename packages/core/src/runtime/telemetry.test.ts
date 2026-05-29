import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Metric, Option, Schema, Stream } from "effect"

import {
  CausePayload,
  InspectorTelemetryEvent,
  makeEffectTelemetryCollector,
  makeTelemetry,
  TelemetryInvalidArgumentError,
  withDesktopSpan
} from "./telemetry.js"

test("Telemetry records redacted structured logs and publishes bounded snapshots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ maxLogs: 1, now: () => 100 })

      const observed = yield* telemetry
        .observeLogs()
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow
      yield* telemetry.log({
        level: "info",
        subsystem: "bridge",
        operation: "Bridge.call",
        traceId: "trace-1",
        resourceId: "resource-1",
        message: "called bridge",
        fields: { token: "secret-token", safe: "value" }
      })
      yield* telemetry.log({
        level: "warn",
        subsystem: "process",
        operation: "Process.spawn",
        traceId: "trace-2",
        message: "spawned process"
      })

      const snapshots = Array.from(yield* Fiber.join(observed))
      const logs = yield* telemetry.listLogs()

      expect(snapshots.at(-1)?.map((record) => record.traceId)).toEqual(["trace-1"])
      expect(logs.map((record) => record.traceId)).toEqual(["trace-2"])
      const snapshotsJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
        snapshots
      )
      expect(snapshotsJson).not.toContain("secret-token")
      expect(snapshots.at(-1)?.[0]?.fields).toEqual(
        Option.some({ token: "<redacted:redacted>", safe: "value" })
      )
    })
  ))

test("Telemetry applies configured redaction policy to structured logs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({
        now: () => 100,
        redaction: {
          additionalPatterns: ["customerSsn"],
          allowlist: ["sessionLabel"]
        }
      })

      yield* telemetry.log({
        level: "info",
        subsystem: "bridge",
        operation: "Bridge.call",
        traceId: "trace-1",
        message: "called bridge",
        fields: {
          customerSsn: "123-45-6789",
          sessionLabel: "safe-session"
        }
      })

      const logs = yield* telemetry.listLogs()
      expect(logs[0]?.fields).toEqual(
        Option.some({
          customerSsn: "<redacted:redacted>",
          sessionLabel: "safe-session"
        })
      )
    })
  ))

test("Telemetry records trace spans in a bounded ring and can disable tracing explicitly", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ traceRingSize: 1 })
      yield* telemetry.recordSpan({
        traceId: "trace-old",
        spanId: "old",
        subsystem: "bridge",
        operation: "Bridge.call",
        name: "old span",
        startedAt: 1,
        endedAt: 3
      })
      yield* telemetry.recordSpan({
        traceId: "trace-new",
        parentSpanId: "root",
        subsystem: "process",
        operation: "Process.spawn",
        name: "new span",
        startedAt: 10,
        endedAt: 25,
        attributes: { apiKey: "secret-key" }
      })

      const spans = yield* telemetry.listTraces()
      expect(spans[0]?.traceId).toEqual(expect.any(String))
      expect(spans[0]?.traceId).not.toBe("trace-new")
      expect(spans[0]?.spanId).toEqual(expect.any(String))
      expect(spans[0]?.parentSpanId).toEqual(Option.some("root"))
      expect(spans[0]?.durationMs).toEqual(Option.some(15))
      expect(spans[0]?.attributes).toEqual(Option.some({ apiKey: "<redacted:redacted>" }))
      expect(spans[0]?.safety.redacted).toBeGreaterThan(0)

      const disabled = yield* makeTelemetry({ tracingEnabled: false })
      yield* disabled.recordSpan({
        traceId: "trace-disabled",
        subsystem: "bridge",
        operation: "Bridge.call",
        name: "disabled",
        startedAt: 1
      })
      expect(yield* disabled.listTraces()).toEqual([])
    })
  ))

test("Telemetry drops sampled-out inspector payloads before storage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({
        inspectorSafetyPolicy: { sampleRate: 0, nextSample: () => 1 }
      })

      yield* telemetry.log({
        level: "info",
        subsystem: "bridge",
        operation: "Bridge.call",
        traceId: "trace-1",
        message: "sampled out"
      })
      yield* telemetry.recordSpan({
        traceId: "trace-1",
        subsystem: "bridge",
        operation: "Bridge.call",
        name: "sampled out",
        startedAt: 1
      })

      expect(yield* telemetry.listLogs()).toEqual([])
      expect(yield* telemetry.listTraces()).toEqual([])
      expect((yield* telemetry.snapshot()).safety.sampledOut).toBe(2)
    })
  ))

test("Telemetry normalizes non-JSON field containers before storage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ now: () => 1 })
      yield* telemetry.log({
        level: "info",
        subsystem: "bridge",
        operation: "Bridge.call",
        traceId: "trace-map",
        message: "map fields",
        fields: new Map<string, unknown>([
          ["safe", "value"],
          ["bytes", new Uint8Array([1, 2, 3])]
        ])
      })

      const logs = yield* telemetry.listLogs()
      expect(logs[0]?.fields).toEqual(Option.some({ safe: "value", bytes: "<omitted:binary>" }))
      expect(logs[0]?.safety.omitted).toBeGreaterThan(0)
    })
  ))

test("Telemetry aggregates counters and histograms by metric name and tags", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let timestamp = 1_000
      const telemetry = yield* makeTelemetry({
        maxHistogramSamples: 2,
        maxMetrics: 2,
        now: () => timestamp++
      })
      yield* telemetry.incrementCounter({
        name: "bridge.calls",
        by: 2,
        tags: { subsystem: "bridge" }
      })
      yield* telemetry.incrementCounter({
        name: "bridge.calls",
        tags: { subsystem: "bridge" }
      })
      yield* telemetry.recordHistogram({ name: "bridge.latency", value: 10 })
      yield* telemetry.recordHistogram({ name: "bridge.latency", value: 30 })
      yield* telemetry.recordHistogram({ name: "bridge.latency", value: 20 })
      yield* telemetry.incrementCounter({ name: "process.spawn" })

      const metrics = yield* telemetry.listMetrics()

      expect(metrics.map((metric) => metric.name).sort()).toEqual([
        "bridge.latency",
        "process.spawn"
      ])
      expect(metrics.find((metric) => metric.name === "bridge.latency")).toMatchObject({
        kind: "histogram",
        count: 3,
        sum: 60,
        min: 10,
        max: 30
      })
      expect(metrics.find((metric) => metric.name === "bridge.latency")).toMatchObject({
        p50: 20,
        p95: 30,
        p99: 30,
        samples: [30, 20]
      })
    })
  ))

test("Telemetry histogram percentiles use nearest-rank raw samples", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ maxHistogramSamples: 100 })

      for (let sample = 1; sample <= 100; sample += 1) {
        yield* telemetry.recordHistogram({ name: "bridge.latency", value: sample })
      }

      const metrics = yield* telemetry.listMetrics()
      const histogram = metrics.find((metric) => metric.name === "bridge.latency")

      expect(histogram).toMatchObject({
        kind: "histogram",
        p50: 50,
        p95: 95,
        p99: 99
      })
    })
  ))

test("EffectTelemetryCollector captures Effect logs, spans, metrics, and causes as schema-coded Inspector events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ now: () => 1_000 })
      const failures = Metric.counter("inspector.failures")
      const collector = yield* makeEffectTelemetryCollector(telemetry)

      const exit = yield* Effect.exit(
        collector.instrument(
          Effect.gen(function* () {
            yield* Effect.logInfo("before failure", { safe: "field" })
            yield* Metric.update(failures, 1)
            return yield* new TelemetryInvalidArgumentError({
              operation: "sample",
              field: "input",
              message: "bad input"
            })
          }).pipe(Effect.withSpan("sample.effect"))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      yield* Effect.yieldNow
      yield* telemetry.collectEffectMetrics()

      const snapshot = yield* telemetry.snapshot()
      const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(InspectorTelemetryEvent))(
        snapshot.events
      )

      expect(decoded.map((event) => event.kind)).toContain("log")
      expect(decoded.map((event) => event.kind)).toContain("trace")
      expect(decoded.map((event) => event.kind)).toContain("metric")
      expect(decoded.map((event) => event.kind)).toContain("cause")
      expect(snapshot.traces[0]).toMatchObject({
        traceId: expect.any(String),
        spanId: expect.any(String),
        subsystem: "effect",
        operation: "sample.effect",
        name: "sample.effect"
      })
      expect(snapshot.metrics.find((metric) => metric.name === "inspector.failures")).toMatchObject(
        {
          kind: "counter",
          value: 1
        }
      )
      const causeEvent = decoded.find((event) => event.kind === "cause")
      expect(causeEvent?.cause).toBeInstanceOf(CausePayload)
      expect(causeEvent?.cause.failed).toBe(true)
      expect(causeEvent?.cause.reasons[0]).toMatchObject({
        kind: "failure",
        tag: "InvalidArgument",
        message: "bad input"
      })
    })
  ))

test("EffectTelemetryCollector preserves warning severity from Effect.logWarning", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ now: () => 2_000 })
      const collector = yield* makeEffectTelemetryCollector(telemetry)

      yield* collector.instrument(Effect.logWarning("high memory"))
      yield* Effect.yieldNow

      const snapshot = yield* telemetry.snapshot()
      const record = snapshot.logs.find((log) => log.message === "high memory")
      expect(record?.level).toBe("warn")
    })
  ))

test("withDesktopSpan attaches Effect span and log annotations to telemetry snapshots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ now: () => 2_000 })
      const collector = yield* makeEffectTelemetryCollector(telemetry)

      yield* collector.instrument(
        Effect.logInfo("desktop operation").pipe(
          withDesktopSpan("Desktop.Operation", {
            resourceId: "resource-1",
            windowId: "window-1",
            traceId: "caller-trace"
          })
        )
      )
      yield* Effect.yieldNow

      const snapshot = yield* telemetry.snapshot()
      const span = snapshot.traces.find((trace) => trace.name === "Desktop.Operation")
      const log = snapshot.logs.find((record) => record.operation === "Desktop.Operation")

      expect(span?.attributes).toEqual(
        Option.some({
          resourceId: "resource-1",
          windowId: "window-1",
          traceId: "caller-trace"
        })
      )
      expect(log?.traceId).toBe(span?.traceId)
      expect(log?.fields).toEqual(
        Option.some({
          fiberId: expect.any(Number),
          spanId: span?.spanId,
          resourceId: "resource-1",
          windowId: "window-1",
          traceId: "caller-trace"
        })
      )
    })
  ))

test("Telemetry rejects invalid metric timestamps before mutating bounded metrics", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]

      for (const timestamp of invalidTimestamps) {
        const telemetry = yield* makeTelemetry({ maxMetrics: 2, now: () => timestamp })

        expectInvalid(
          yield* Effect.exit(telemetry.incrementCounter({ name: "first" })),
          "timestamp"
        )
        expectInvalid(
          yield* Effect.exit(telemetry.incrementCounter({ name: "second" })),
          "timestamp"
        )
        expectInvalid(
          yield* Effect.exit(telemetry.incrementCounter({ name: "third" })),
          "timestamp"
        )

        expect(yield* telemetry.listMetrics()).toEqual([])
      }
    })
  ))

test("Telemetry rejects explicit invalid metric timestamps before mutating bounded metrics", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry({ maxMetrics: 2, now: () => 1 })

      expectInvalid(
        yield* Effect.exit(telemetry.incrementCounter({ name: "first", timestamp: Number.NaN })),
        "timestamp"
      )
      expectInvalid(
        yield* Effect.exit(
          telemetry.recordHistogram({
            name: "latency",
            value: 1,
            timestamp: Number.POSITIVE_INFINITY
          })
        ),
        "timestamp"
      )

      expect(yield* telemetry.listMetrics()).toEqual([])
    })
  ))

test("Telemetry rejects invalid buffer sizes as typed values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const error = yield* Effect.flip(makeTelemetry({ traceRingSize: 0 }))

      expect(error).toMatchObject({
        _tag: "InvalidArgument",
        operation: "Telemetry.make",
        field: "traceRingSize"
      })
    })
  ))

test("Telemetry log rejects control bytes in correlation metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry()
      const baseInput = {
        level: "info" as const,
        subsystem: "bridge",
        operation: "Bridge.call",
        message: "called bridge"
      }

      for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
        const sample = `id${String.fromCharCode(codePoint)}forged`
        expectInvalid(
          yield* Effect.exit(telemetry.log({ ...baseInput, traceId: sample })),
          "traceId"
        )
        expectInvalid(
          yield* Effect.exit(
            telemetry.log({ ...baseInput, traceId: "trace-1", resourceId: sample })
          ),
          "resourceId"
        )
        expectInvalid(
          yield* Effect.exit(telemetry.log({ ...baseInput, traceId: "trace-1", windowId: sample })),
          "windowId"
        )
      }
      const delSample = `id${String.fromCharCode(127)}forged`
      expectInvalid(
        yield* Effect.exit(telemetry.log({ ...baseInput, traceId: delSample })),
        "traceId"
      )

      expect(yield* telemetry.listLogs()).toEqual([])
    })
  ))

test("Telemetry recordSpan rejects control bytes in span identifiers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry()
      const baseInput = {
        subsystem: "bridge",
        operation: "Bridge.call",
        name: "call",
        startedAt: 1
      }

      for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
        const sample = `id${String.fromCharCode(codePoint)}forged`
        expectInvalid(
          yield* Effect.exit(telemetry.recordSpan({ ...baseInput, traceId: sample })),
          "traceId"
        )
        expectInvalid(
          yield* Effect.exit(
            telemetry.recordSpan({ ...baseInput, traceId: "trace-1", spanId: sample })
          ),
          "spanId"
        )
        expectInvalid(
          yield* Effect.exit(
            telemetry.recordSpan({ ...baseInput, traceId: "trace-1", parentSpanId: sample })
          ),
          "parentSpanId"
        )
      }

      expect(yield* telemetry.listTraces()).toEqual([])
    })
  ))

test("Telemetry rejects empty trace span identifiers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry()
      const baseInput = {
        traceId: "trace-1",
        subsystem: "bridge",
        operation: "Bridge.call",
        name: "call",
        startedAt: 1
      }

      for (const [field, patch] of [
        ["traceId", { traceId: "" }],
        ["spanId", { spanId: "" }],
        ["parentSpanId", { parentSpanId: "" }],
        ["subsystem", { subsystem: "" }],
        ["operation", { operation: "" }],
        ["name", { name: "" }]
      ] as const) {
        expectInvalid(yield* Effect.exit(telemetry.recordSpan({ ...baseInput, ...patch })), field)
      }

      expect(yield* telemetry.listTraces()).toEqual([])
    })
  ))

test("Telemetry counter rejects control bytes in metric name and tag entries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry()

      for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
        const sample = `id${String.fromCharCode(codePoint)}forged`
        expectInvalid(yield* Effect.exit(telemetry.incrementCounter({ name: sample })), "name")
        expectInvalid(
          yield* Effect.exit(
            telemetry.incrementCounter({ name: "ok", tags: { [sample]: "value" } })
          ),
          "tags.key"
        )
        expectInvalid(
          yield* Effect.exit(telemetry.incrementCounter({ name: "ok", tags: { route: sample } })),
          "tags.value"
        )
      }

      expect(yield* telemetry.listMetrics()).toEqual([])
    })
  ))

test("Telemetry histogram rejects control bytes in metric name and tag entries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const telemetry = yield* makeTelemetry()

      for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
        const sample = `id${String.fromCharCode(codePoint)}forged`
        expectInvalid(
          yield* Effect.exit(telemetry.recordHistogram({ name: sample, value: 1 })),
          "name"
        )
        expectInvalid(
          yield* Effect.exit(
            telemetry.recordHistogram({ name: "ok", value: 1, tags: { [sample]: "value" } })
          ),
          "tags.key"
        )
        expectInvalid(
          yield* Effect.exit(
            telemetry.recordHistogram({ name: "ok", value: 1, tags: { route: sample } })
          ),
          "tags.value"
        )
      }

      expect(yield* telemetry.listMetrics()).toEqual([])
    })
  ))

const expectInvalid = (exit: Exit.Exit<unknown, unknown>, field: string): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(TelemetryInvalidArgumentError)
    if (failure?.error instanceof TelemetryInvalidArgumentError) {
      expect(failure.error.field).toBe(field)
    }
  }
}
