import { expect, test } from "bun:test"
import { Effect, Fiber, Option, Stream } from "effect"

import { makeTelemetry } from "./telemetry.js"

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
    makeTelemetry({ maxMetrics: 2, now: () => timestamp++ })
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
  await Effect.runPromise(telemetry.incrementCounter({ name: "process.spawn" }))

  const metrics = await Effect.runPromise(telemetry.listMetrics())

  expect(metrics.map((metric) => metric.name).sort()).toEqual(["bridge.latency", "process.spawn"])
  expect(metrics.find((metric) => metric.name === "bridge.latency")).toMatchObject({
    kind: "histogram",
    count: 2,
    sum: 40,
    min: 10,
    max: 30
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
