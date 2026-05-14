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

test("Telemetry records redacted structured logs and publishes bounded snapshots", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ maxLogs: 1, now: () => 100 }))

  const observed = Effect.runFork(telemetry.observeLogs().pipe(Stream.take(2), Stream.runCollect))
  await Bun.sleep(0)
  await Effect.runPromise(
    telemetry.log({
      level: "info",
      subsystem: "bridge",
      operation: "Bridge.call",
      traceId: "trace-1",
      resourceId: "resource-1",
      message: "called bridge",
      fields: { token: "secret-token", safe: "value" }
    })
  )
  await Effect.runPromise(
    telemetry.log({
      level: "warn",
      subsystem: "process",
      operation: "Process.spawn",
      traceId: "trace-2",
      message: "spawned process"
    })
  )

  const snapshots = Array.from(await Effect.runPromise(Fiber.join(observed)))
  const logs = await Effect.runPromise(telemetry.listLogs())

  expect(snapshots.at(-1)?.map((record) => record.traceId)).toEqual(["trace-1"])
  expect(logs.map((record) => record.traceId)).toEqual(["trace-2"])
  expect(JSON.stringify(snapshots)).not.toContain("secret-token")
  expect(snapshots.at(-1)?.[0]?.fields).toEqual(
    Option.some({ token: "<redacted:redacted>", safe: "value" })
  )
})

test("Telemetry applies configured redaction policy to structured logs", async () => {
  const telemetry = await Effect.runPromise(
    makeTelemetry({
      now: () => 100,
      redaction: {
        additionalPatterns: ["customerSsn"],
        allowlist: ["sessionLabel"]
      }
    })
  )

  await Effect.runPromise(
    telemetry.log({
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
  )

  const logs = await Effect.runPromise(telemetry.listLogs())
  expect(logs[0]?.fields).toEqual(
    Option.some({
      customerSsn: "<redacted:redacted>",
      sessionLabel: "safe-session"
    })
  )
})

test("Telemetry records trace spans in a bounded ring and can disable tracing explicitly", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ traceRingSize: 1 }))
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-old",
      spanId: "old",
      subsystem: "bridge",
      operation: "Bridge.call",
      name: "old span",
      startedAt: 1,
      endedAt: 3
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-new",
      parentSpanId: "root",
      subsystem: "process",
      operation: "Process.spawn",
      name: "new span",
      startedAt: 10,
      endedAt: 25,
      attributes: { apiKey: "secret-key" }
    })
  )

  const spans = await Effect.runPromise(telemetry.listTraces())
  expect(spans[0]?.traceId).toEqual(expect.any(String))
  expect(spans[0]?.traceId).not.toBe("trace-new")
  expect(spans[0]?.spanId).toEqual(expect.any(String))
  expect(spans[0]?.parentSpanId).toEqual(Option.some("root"))
  expect(spans[0]?.durationMs).toEqual(Option.some(15))
  expect(spans[0]?.attributes).toEqual(Option.some({ apiKey: "<redacted:redacted>" }))
  expect(spans[0]?.safety.redacted).toBeGreaterThan(0)

  const disabled = await Effect.runPromise(makeTelemetry({ tracingEnabled: false }))
  await Effect.runPromise(
    disabled.recordSpan({
      traceId: "trace-disabled",
      subsystem: "bridge",
      operation: "Bridge.call",
      name: "disabled",
      startedAt: 1
    })
  )
  expect(await Effect.runPromise(disabled.listTraces())).toEqual([])
})

test("Telemetry drops sampled-out inspector payloads before storage", async () => {
  const telemetry = await Effect.runPromise(
    makeTelemetry({ inspectorSafetyPolicy: { sampleRate: 0, nextSample: () => 1 } })
  )

  await Effect.runPromise(
    telemetry.log({
      level: "info",
      subsystem: "bridge",
      operation: "Bridge.call",
      traceId: "trace-1",
      message: "sampled out"
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-1",
      subsystem: "bridge",
      operation: "Bridge.call",
      name: "sampled out",
      startedAt: 1
    })
  )

  expect(await Effect.runPromise(telemetry.listLogs())).toEqual([])
  expect(await Effect.runPromise(telemetry.listTraces())).toEqual([])
  expect((await Effect.runPromise(telemetry.snapshot())).safety.sampledOut).toBe(2)
})

test("Telemetry normalizes non-JSON field containers before storage", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ now: () => 1 }))
  await Effect.runPromise(
    telemetry.log({
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
  )

  const logs = await Effect.runPromise(telemetry.listLogs())
  expect(logs[0]?.fields).toEqual(Option.some({ safe: "value", bytes: "<omitted:binary>" }))
  expect(logs[0]?.safety.omitted).toBeGreaterThan(0)
})

test("Telemetry aggregates counters and histograms by metric name and tags", async () => {
  let timestamp = 1_000
  const telemetry = await Effect.runPromise(
    makeTelemetry({ maxHistogramSamples: 2, maxMetrics: 2, now: () => timestamp++ })
  )
  await Effect.runPromise(
    telemetry.incrementCounter({
      name: "bridge.calls",
      by: 2,
      tags: { subsystem: "bridge" }
    })
  )
  await Effect.runPromise(
    telemetry.incrementCounter({
      name: "bridge.calls",
      tags: { subsystem: "bridge" }
    })
  )
  await Effect.runPromise(telemetry.recordHistogram({ name: "bridge.latency", value: 10 }))
  await Effect.runPromise(telemetry.recordHistogram({ name: "bridge.latency", value: 30 }))
  await Effect.runPromise(telemetry.recordHistogram({ name: "bridge.latency", value: 20 }))
  await Effect.runPromise(telemetry.incrementCounter({ name: "process.spawn" }))

  const metrics = await Effect.runPromise(telemetry.listMetrics())

  expect(metrics.map((metric) => metric.name).sort()).toEqual(["bridge.latency", "process.spawn"])
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

test("Telemetry histogram percentiles use nearest-rank raw samples", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ maxHistogramSamples: 100 }))

  for (let sample = 1; sample <= 100; sample += 1) {
    await Effect.runPromise(telemetry.recordHistogram({ name: "bridge.latency", value: sample }))
  }

  const metrics = await Effect.runPromise(telemetry.listMetrics())
  const histogram = metrics.find((metric) => metric.name === "bridge.latency")

  expect(histogram).toMatchObject({
    kind: "histogram",
    p50: 50,
    p95: 95,
    p99: 99
  })
})

test("EffectTelemetryCollector captures Effect logs, spans, metrics, and causes as schema-coded Inspector events", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ now: () => 1_000 }))
  const failures = Metric.counter("inspector.failures")
  const collector = await Effect.runPromise(makeEffectTelemetryCollector(telemetry))

  const exit = await Effect.runPromiseExit(
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
  await Bun.sleep(0)
  await Effect.runPromise(telemetry.collectEffectMetrics())

  const snapshot = await Effect.runPromise(telemetry.snapshot())
  const decoded = await Effect.runPromise(
    Schema.decodeUnknownEffect(Schema.Array(InspectorTelemetryEvent))(snapshot.events)
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
  expect(snapshot.metrics.find((metric) => metric.name === "inspector.failures")).toMatchObject({
    kind: "counter",
    value: 1
  })
  const causeEvent = decoded.find((event) => event.kind === "cause")
  expect(causeEvent?.cause).toBeInstanceOf(CausePayload)
  expect(causeEvent?.cause.failed).toBe(true)
  expect(causeEvent?.cause.reasons[0]).toMatchObject({
    kind: "failure",
    tag: "InvalidArgument",
    message: "bad input"
  })
})

test("withDesktopSpan attaches Effect span and log annotations to telemetry snapshots", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ now: () => 2_000 }))
  const collector = await Effect.runPromise(makeEffectTelemetryCollector(telemetry))

  await Effect.runPromise(
    collector.instrument(
      Effect.logInfo("desktop operation").pipe(
        withDesktopSpan("Desktop.Operation", {
          resourceId: "resource-1",
          windowId: "window-1",
          traceId: "caller-trace"
        })
      )
    )
  )
  await Bun.sleep(0)

  const snapshot = await Effect.runPromise(telemetry.snapshot())
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

test("Telemetry rejects invalid metric timestamps before mutating bounded metrics", async () => {
  const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]

  for (const timestamp of invalidTimestamps) {
    const telemetry = await Effect.runPromise(
      makeTelemetry({ maxMetrics: 2, now: () => timestamp })
    )

    expectInvalid(
      await Effect.runPromiseExit(telemetry.incrementCounter({ name: "first" })),
      "timestamp"
    )
    expectInvalid(
      await Effect.runPromiseExit(telemetry.incrementCounter({ name: "second" })),
      "timestamp"
    )
    expectInvalid(
      await Effect.runPromiseExit(telemetry.incrementCounter({ name: "third" })),
      "timestamp"
    )

    expect(await Effect.runPromise(telemetry.listMetrics())).toEqual([])
  }
})

test("Telemetry rejects explicit invalid metric timestamps before mutating bounded metrics", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ maxMetrics: 2, now: () => 1 }))

  expectInvalid(
    await Effect.runPromiseExit(
      telemetry.incrementCounter({ name: "first", timestamp: Number.NaN })
    ),
    "timestamp"
  )
  expectInvalid(
    await Effect.runPromiseExit(
      telemetry.recordHistogram({ name: "latency", value: 1, timestamp: Number.POSITIVE_INFINITY })
    ),
    "timestamp"
  )

  expect(await Effect.runPromise(telemetry.listMetrics())).toEqual([])
})

test("Telemetry rejects invalid buffer sizes as typed values", async () => {
  const error = await Effect.runPromise(Effect.flip(makeTelemetry({ traceRingSize: 0 })))

  expect(error).toMatchObject({
    _tag: "InvalidArgument",
    operation: "Telemetry.make",
    field: "traceRingSize"
  })
})

test("Telemetry log rejects control bytes in correlation metadata", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())
  const baseInput = {
    level: "info" as const,
    subsystem: "bridge",
    operation: "Bridge.call",
    message: "called bridge"
  }

  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const sample = `id${String.fromCharCode(codePoint)}forged`
    expectInvalid(
      await Effect.runPromiseExit(telemetry.log({ ...baseInput, traceId: sample })),
      "traceId"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.log({ ...baseInput, traceId: "trace-1", resourceId: sample })
      ),
      "resourceId"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.log({ ...baseInput, traceId: "trace-1", windowId: sample })
      ),
      "windowId"
    )
  }
  const delSample = `id${String.fromCharCode(127)}forged`
  expectInvalid(
    await Effect.runPromiseExit(telemetry.log({ ...baseInput, traceId: delSample })),
    "traceId"
  )

  expect(await Effect.runPromise(telemetry.listLogs())).toEqual([])
})

test("Telemetry recordSpan rejects control bytes in span identifiers", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())
  const baseInput = {
    subsystem: "bridge",
    operation: "Bridge.call",
    name: "call",
    startedAt: 1
  }

  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const sample = `id${String.fromCharCode(codePoint)}forged`
    expectInvalid(
      await Effect.runPromiseExit(telemetry.recordSpan({ ...baseInput, traceId: sample })),
      "traceId"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.recordSpan({ ...baseInput, traceId: "trace-1", spanId: sample })
      ),
      "spanId"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.recordSpan({ ...baseInput, traceId: "trace-1", parentSpanId: sample })
      ),
      "parentSpanId"
    )
  }

  expect(await Effect.runPromise(telemetry.listTraces())).toEqual([])
})

test("Telemetry rejects empty trace span identifiers", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())
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
    expectInvalid(
      await Effect.runPromiseExit(telemetry.recordSpan({ ...baseInput, ...patch })),
      field
    )
  }

  expect(await Effect.runPromise(telemetry.listTraces())).toEqual([])
})

test("Telemetry counter rejects control bytes in metric name and tag entries", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())

  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const sample = `id${String.fromCharCode(codePoint)}forged`
    expectInvalid(await Effect.runPromiseExit(telemetry.incrementCounter({ name: sample })), "name")
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.incrementCounter({ name: "ok", tags: { [sample]: "value" } })
      ),
      "tags.key"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.incrementCounter({ name: "ok", tags: { route: sample } })
      ),
      "tags.value"
    )
  }

  expect(await Effect.runPromise(telemetry.listMetrics())).toEqual([])
})

test("Telemetry histogram rejects control bytes in metric name and tag entries", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())

  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const sample = `id${String.fromCharCode(codePoint)}forged`
    expectInvalid(
      await Effect.runPromiseExit(telemetry.recordHistogram({ name: sample, value: 1 })),
      "name"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.recordHistogram({ name: "ok", value: 1, tags: { [sample]: "value" } })
      ),
      "tags.key"
    )
    expectInvalid(
      await Effect.runPromiseExit(
        telemetry.recordHistogram({ name: "ok", value: 1, tags: { route: sample } })
      ),
      "tags.value"
    )
  }

  expect(await Effect.runPromise(telemetry.listMetrics())).toEqual([])
})

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
