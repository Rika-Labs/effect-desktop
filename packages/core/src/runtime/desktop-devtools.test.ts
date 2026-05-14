import { expect, test } from "bun:test"
import { Effect, Fiber, Schema, Stream } from "effect"

import {
  DesktopRuntimeEvent,
  makeDesktopDevtools,
  streamDevtoolsToTransport
} from "./desktop-devtools.js"
import { makeInspectorCollectors, RendererInspectorEvent } from "./inspector-events.js"
import { makeInspectorTransport } from "./inspector-transport.js"
import { makeTelemetry } from "./telemetry.js"

const now = 1_715_000_000_000

test("DesktopDevtools streams inspector and Effect telemetry runtime events through one feed", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const collectors = yield* makeInspectorCollectors()
      const telemetry = yield* makeTelemetry({ now: () => now })
      const devtools = makeDesktopDevtools(collectors, telemetry)
      const fiber = yield* devtools.events.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* collectors.renderer.publish(
        new RendererInspectorEvent({
          kind: "rpc",
          status: "start",
          operation: "Window.create",
          traceId: "trace-rpc",
          timestamp: now
        })
      )
      yield* telemetry.log({
        level: "info",
        subsystem: "effect",
        operation: "DesktopRpc.Window.create",
        traceId: "trace-rpc",
        message: "rpc started",
        timestamp: now + 1
      })

      const events = Array.from(yield* Fiber.join(fiber))
      const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(DesktopRuntimeEvent))(events)

      expect(decoded.map((event) => event.source).sort()).toEqual(["inspector", "telemetry"])
      expect(
        decoded.some((event) => event.inspector?.renderer?.operation === "Window.create")
      ).toBe(true)
      expect(decoded.some((event) => event.telemetry?.kind === "log")).toBe(true)
    })
  )
})

test("DesktopDevtools forwards the shared runtime feed into InspectorTransport", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const collectors = yield* makeInspectorCollectors()
      const telemetry = yield* makeTelemetry({ now: () => now })
      const transport = yield* makeInspectorTransport({ sessionId: "session-devtools" })
      const devtools = makeDesktopDevtools(collectors, telemetry)
      const received = yield* transport
        .subscribe()
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      const pump = yield* streamDevtoolsToTransport(devtools, transport).pipe(
        Effect.forkChild({ startImmediately: true })
      )

      yield* collectors.renderer.publish(
        new RendererInspectorEvent({
          kind: "rpc",
          status: "failure",
          operation: "Window.create",
          traceId: "trace-rpc",
          errorTag: "InvalidArgument",
          message: "bad bounds",
          timestamp: now
        })
      )
      yield* telemetry.recordSpan({
        traceId: "trace-rpc",
        spanId: "span-rpc",
        subsystem: "effect",
        operation: "DesktopRpc.Window.create",
        name: "DesktopRpc.Window.create",
        startedAt: now,
        endedAt: now + 7
      })

      const events = Array.from(yield* Fiber.join(received))
      yield* Fiber.interrupt(pump)

      expect(events.map((event) => event.source).sort()).toEqual([
        "runtime.inspector",
        "runtime.telemetry"
      ])
      expect(events.every((event) => event.payload instanceof DesktopRuntimeEvent)).toBe(true)
    })
  )
})
