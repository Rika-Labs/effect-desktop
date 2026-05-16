import { expect, test } from "bun:test"
import { DateTime, Effect, Exit, Option } from "effect"

import {
  decodeUnknownInspectorEvent,
  encodeInspectorEvent,
  InspectorBridgeFramePayload,
  InspectorEvent,
  InspectorFailurePayload,
  InspectorFiberPayload,
  InspectorLayerGraphPayload,
  InspectorLogPayload,
  InspectorMetricPayload,
  InspectorNativeHostPayload,
  InspectorPermissionPayload,
  InspectorPersistencePayload,
  InspectorProviderPayload,
  InspectorRedactionState,
  InspectorRendererPayload,
  InspectorResourcePayload,
  InspectorRpcPayload,
  InspectorSpanPayload,
  InspectorWorkflowPayload,
  makeInspectorEvent,
  replayInspectorFixture
} from "./index.js"

const occurredAt = DateTime.makeUnsafe("2026-05-13T12:00:00.000Z")

test("InspectorEvent codecs round-trip every planned payload category", async () => {
  const payloads = [
    new InspectorSpanPayload({ tag: "span", name: "boot", state: "started" }),
    new InspectorLogPayload({ tag: "log", level: "Info", message: "ready" }),
    new InspectorMetricPayload({ tag: "metric", name: "bridge.p99", value: 12.5, unit: "ms" }),
    new InspectorLayerGraphPayload({
      tag: "layer-graph",
      dependencies: ["layer-runtime"],
      label: "Commands",
      layerId: "layer-commands",
      state: "acquired"
    }),
    new InspectorProviderPayload({
      tag: "provider",
      capability: "native.invoke",
      providerId: "provider-commands",
      state: "available"
    }),
    new InspectorRpcPayload({
      tag: "rpc",
      method: "open",
      requestId: "request-1",
      service: "Project",
      state: "completed"
    }),
    new InspectorBridgeFramePayload({
      tag: "bridge-frame",
      direction: "renderer-to-host",
      frameKind: "request",
      payloadBytes: 64,
      requestId: "request-1"
    }),
    new InspectorPermissionPayload({
      tag: "permission",
      actor: "window:main",
      capability: "native.invoke",
      decision: "denied",
      reason: "missing grant"
    }),
    new InspectorResourcePayload({
      tag: "resource",
      ownerScope: "scope-main",
      resourceId: "resource-1",
      resourceKind: "window",
      state: "opened"
    }),
    new InspectorFiberPayload({ tag: "fiber", fiberId: "fiber-1", state: "started" }),
    new InspectorNativeHostPayload({ tag: "native-host", event: "app.ready", platform: "macos" }),
    new InspectorRendererPayload({ tag: "renderer", event: "navigation", windowId: "main" }),
    new InspectorPersistencePayload({
      tag: "persistence",
      operation: "set",
      state: "completed",
      store: "settings"
    }),
    new InspectorWorkflowPayload({
      tag: "workflow",
      executionId: "execution-1",
      state: "retrying",
      workflowName: "Backup"
    }),
    new InspectorFailurePayload({
      tag: "failure",
      errorTag: "Timeout",
      message: "deadline exceeded",
      recoverable: true
    })
  ] as const

  const events = payloads.map((payload, index) =>
    makeInspectorEvent({
      id: `event-${index + 1}`,
      occurredAt,
      payload,
      severity: payload.tag === "failure" ? "Error" : "Info",
      source: payload.tag === "bridge-frame" ? "bridge" : "runtime",
      traceId: Option.some("trace-1")
    })
  )

  const encoded = await Effect.runPromise(
    Effect.forEach(events, (event) => encodeInspectorEvent(event))
  )
  const decoded = await Effect.runPromise(replayInspectorFixture(encoded))

  expect(decoded.map((event) => event.payload.tag)).toEqual(payloads.map((payload) => payload.tag))
  expect(decoded.every((event) => Option.isSome(event.traceId))).toBe(true)
})

test("InspectorEvent rejects untyped or unknown payload shapes", async () => {
  const invalid = {
    id: "event-invalid",
    source: "runtime",
    occurredAt: "2026-05-13T12:00:00.000Z",
    traceId: Option.none(),
    spanId: Option.none(),
    layerId: Option.none(),
    providerId: Option.none(),
    severity: "Info",
    redaction: new InspectorRedactionState({
      evidenceCount: 0,
      omitted: false,
      redacted: false
    }),
    payload: { tag: "unknown", value: "not schema-coded" }
  }

  const exit = await Effect.runPromiseExit(decodeUnknownInspectorEvent(invalid))

  expect(Exit.isFailure(exit)).toBe(true)
})

test("InspectorEvent encoded fixtures replay without live runtime dependencies", async () => {
  const event = new InspectorEvent({
    id: "event-fixture",
    layerId: Option.some("layer-commands"),
    occurredAt,
    payload: new InspectorLogPayload({
      tag: "log",
      level: "Warn",
      message: "redacted input omitted"
    }),
    providerId: Option.none(),
    redaction: new InspectorRedactionState({
      evidenceCount: 1,
      omitted: true,
      redacted: false
    }),
    severity: "Warn",
    source: "telemetry",
    spanId: Option.none(),
    traceId: Option.some("trace-fixture")
  })

  const encoded = await Effect.runPromise(encodeInspectorEvent(event))
  const replayed = await Effect.runPromise(replayInspectorFixture([encoded]))

  expect(replayed[0]?.id).toBe("event-fixture")
  expect(replayed[0]?.payload.tag).toBe("log")
  expect(replayed[0]?.redaction.omitted).toBe(true)
})
