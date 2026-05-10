import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"

import { makeTelemetry, TelemetryInvalidArgumentError } from "./telemetry.js"

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
  expect(snapshots.at(-1)?.[0]?.fields).toEqual(Option.some({ token: "[REDACTED]", safe: "value" }))
})

test("Telemetry records trace spans in a bounded ring and can disable tracing explicitly", async () => {
  const telemetry = await Effect.runPromise(
    makeTelemetry({ traceRingSize: 1, nextSpanId: () => "generated-span" })
  )
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
  expect(spans.map((span) => span.traceId)).toEqual(["trace-new"])
  expect(spans[0]?.spanId).toBe("generated-span")
  expect(spans[0]?.durationMs).toEqual(Option.some(15))

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

  const generated = await Effect.runPromise(
    makeTelemetry({ nextSpanId: () => `gen${String.fromCharCode(10)}forged` })
  )
  expectInvalid(
    await Effect.runPromiseExit(generated.recordSpan({ ...baseInput, traceId: "trace-1" })),
    "spanId"
  )

  expect(await Effect.runPromise(telemetry.listTraces())).toEqual([])
  expect(await Effect.runPromise(generated.listTraces())).toEqual([])
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
