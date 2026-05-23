import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  HostProtocolEventEnvelope,
  type HostProtocolRequestEnvelope
} from "@orika/bridge"
import { AuditEvent, type AuditEventsApi } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Stream } from "effect"
import { expect, test } from "bun:test"

import {
  DiagnosticsBundle,
  DiagnosticsBundleLive,
  DiagnosticsBundleMethodNames,
  DiagnosticsBundleRpcEvents,
  DiagnosticsBundleRpcs,
  Native,
  NativeCapabilities,
  makeDiagnosticsBundleMemoryClient,
  makeDiagnosticsBundlePermissionDeniedError,
  makeDiagnosticsBundleServiceLayer,
  makeDiagnosticsBundleUnsupportedClient,
  makeNativeCapabilitiesLayer,
  DiagnosticsBundleSurface
} from "./index.js"
import {
  DiagnosticsBundleCollectInput,
  DiagnosticsBundleCollectStartedEvent,
  DiagnosticsBundleIdentity,
  DiagnosticsBundleRedactInput,
  DiagnosticsBundleSourceRedactedEvent,
  DiagnosticsBundleSupportedResult,
  DiagnosticsBundleWriteInput
} from "./contracts/index.js"

test("DiagnosticsBundle declares a narrow RPC and event surface", () => {
  expect([...DiagnosticsBundleMethodNames]).toEqual(["collect", "redact", "write", "isSupported"])
  expect([...DiagnosticsBundleRpcs.requests.keys()]).toEqual([
    "DiagnosticsBundle.collect",
    "DiagnosticsBundle.redact",
    "DiagnosticsBundle.write",
    "DiagnosticsBundle.isSupported"
  ])
  expect(Object.keys(DiagnosticsBundleRpcEvents)).toEqual([
    "CollectStarted",
    "SourceRedacted",
    "WriteCompleted",
    "Failed"
  ])
})

test("DiagnosticsBundle memory client collects, redacts, writes, streams, and audits", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeDiagnosticsBundleMemoryClient()
      const audits: AuditEvent[] = []
      const layer = makeDiagnosticsBundleServiceLayer(client, {
        audit: memoryAudit(audits),
        nextTraceId: () => "trace-audit"
      })
      const runtime = ManagedRuntime.make(layer)
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const diagnostics = yield* DiagnosticsBundle
            const collect = yield* diagnostics.collect(
              new DiagnosticsBundleCollectInput({
                bundleId: "bundle-1",
                sources: ["logs", "audit-events"],
                traceId: "trace-1"
              })
            )
            const redact = yield* diagnostics.redact(
              new DiagnosticsBundleRedactInput({
                bundleId: "bundle-1",
                source: "logs",
                payload: {
                  apiKey: "secret",
                  nested: { safe: "ok" }
                }
              })
            )
            const events = yield* diagnostics
              .events(new DiagnosticsBundleIdentity({ bundleId: "bundle-1" }))
              .pipe(Stream.take(2), Stream.runCollect)
            const write = yield* diagnostics.write(
              new DiagnosticsBundleWriteInput({
                bundleId: "bundle-1",
                destinationPath: "/tmp/diagnostics-bundle.json",
                traceId: "trace-1"
              })
            )
            return { collect, events, redact, write }
          })
        )
      )

      expect(result.collect.bundleId).toBe("bundle-1")
      expect(result.collect.artifactCount).toBe(2)
      expect(result.redact.payload).toEqual({
        apiKey: "<redacted:redacted>",
        nested: { safe: "ok" }
      })
      expect(result.redact.redactionPolicy.id).toBe("default-secret-patterns")
      expect(result.redact.redactionPolicy.evidence.map((entry) => entry.reason)).toEqual([
        "secret-pattern",
        "redacted-value"
      ])
      const events = Array.from(result.events)
      expect(events).toEqual([
        new DiagnosticsBundleCollectStartedEvent({
          type: "collect-started",
          bundleId: "bundle-1",
          timestamp: result.collect.collectedAt,
          sources: ["logs", "audit-events"]
        }),
        new DiagnosticsBundleSourceRedactedEvent({
          type: "source-redacted",
          bundleId: "bundle-1",
          timestamp: events[1]?.timestamp ?? 0,
          source: "logs",
          redactionPolicy: result.redact.redactionPolicy
        })
      ])
      expect(result.write).toMatchObject({
        bundleId: "bundle-1",
        destinationPath: "/tmp/diagnostics-bundle.json"
      })
      expect(result.write.bytesWritten).toBeGreaterThan(0)
      expect(audits.map((event) => [event.source, event.outcome])).toEqual([
        ["DiagnosticsBundle.collect", "success"],
        ["DiagnosticsBundle.redact", "success"],
        ["DiagnosticsBundle.write", "success"]
      ])
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DiagnosticsBundle memory client exposes typed permission-denied failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeDiagnosticsBundleMemoryClient({
        failure: {
          collect: makeDiagnosticsBundlePermissionDeniedError("DiagnosticsBundle.collect")
        }
      })
      const runtime = ManagedRuntime.make(makeDiagnosticsBundleServiceLayer(client))
      const error = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const diagnostics = yield* DiagnosticsBundle
            return yield* Effect.flip(
              diagnostics.collect(new DiagnosticsBundleCollectInput({ bundleId: "bundle-1" }))
            )
          })
        )
      )

      expect(error).toMatchObject({
        tag: "PermissionDenied",
        operation: "DiagnosticsBundle.collect"
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DiagnosticsBundle memory client rejects redact before collect", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeDiagnosticsBundleMemoryClient()
      const runtime = ManagedRuntime.make(makeDiagnosticsBundleServiceLayer(client))
      const error = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const diagnostics = yield* DiagnosticsBundle
            return yield* Effect.flip(
              diagnostics.redact(
                new DiagnosticsBundleRedactInput({
                  bundleId: "missing-bundle",
                  source: "logs",
                  payload: { token: "secret" }
                })
              )
            )
          })
        )
      )

      expect(error).toMatchObject({
        tag: "InvalidState",
        operation: "DiagnosticsBundle.redact"
      })
      yield* Effect.promise(() => runtime.dispose())
    })
  ))

test("DiagnosticsBundle unsupported client validates malformed input before unsupported", () => {
  const runtime = ManagedRuntime.make(
    makeDiagnosticsBundleServiceLayer(makeDiagnosticsBundleUnsupportedClient())
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      const exit = yield* Effect.exit(diagnostics.write(invalidWriteInput()))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          tag: "InvalidArgument",
          operation: "DiagnosticsBundle.write"
        })
      }
    })
  )
})

test("DiagnosticsBundle bridge client sends typed envelopes and decodes events", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = diagnosticsBundleExchange(requests, (request) => ({
    kind: "success",
    payload:
      request.method === "DiagnosticsBundle.isSupported"
        ? { supported: true }
        : request.method === "DiagnosticsBundle.collect"
          ? {
              bundleId: "bundle-1",
              collectedAt: 1710000000000,
              sources: [],
              artifactCount: 0
            }
          : request.method === "DiagnosticsBundle.redact"
            ? {
                bundleId: "bundle-1",
                source: "logs",
                payload: { token: "<redacted>" },
                redactionPolicy: {
                  id: "default-secret-patterns",
                  evidence: [
                    { path: "<redacted-key>", action: "redacted", reason: "secret-pattern" }
                  ]
                }
              }
            : {
                bundleId: "bundle-1",
                destinationPath: "/tmp/diagnostics-bundle.json",
                bytesWritten: 42,
                sources: []
              }
  }))
  const runtime = ManagedRuntime.make(
    Layer.provide(DiagnosticsBundleLive, DiagnosticsBundleSurface.bridgeClientLayer(exchange))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      const supported = yield* diagnostics.isSupported()
      const collect = yield* diagnostics.collect(
        new DiagnosticsBundleCollectInput({ bundleId: "bundle-1", sources: ["logs"] })
      )
      const redact = yield* diagnostics.redact(
        new DiagnosticsBundleRedactInput({
          bundleId: "bundle-1",
          source: "logs",
          payload: { token: "secret" }
        })
      )
      const event = yield* diagnostics
        .events(new DiagnosticsBundleIdentity({ bundleId: "bundle-1" }))
        .pipe(Stream.take(1), Stream.runCollect)
      const write = yield* diagnostics.write(
        new DiagnosticsBundleWriteInput({
          bundleId: "bundle-1",
          destinationPath: "/tmp/diagnostics-bundle.json"
        })
      )

      expect(supported).toEqual(
        new DiagnosticsBundleSupportedResult({
          supported: true
        })
      )
      expect(Array.from(event)).toEqual([
        new DiagnosticsBundleCollectStartedEvent({
          type: "collect-started",
          bundleId: "bundle-1",
          timestamp: 1710000000800,
          sources: ["logs"]
        })
      ])
      expect(collect.bundleId).toBe("bundle-1")
      expect(redact.redactionPolicy.evidence).toHaveLength(1)
      expect(write.bytesWritten).toBe(42)
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["DiagnosticsBundle.isSupported", null],
        ["DiagnosticsBundle.collect", { bundleId: "bundle-1", sources: ["logs"] }],
        [
          "DiagnosticsBundle.redact",
          { bundleId: "bundle-1", source: "logs", payload: { token: "secret" } }
        ],
        [
          "DiagnosticsBundle.write",
          { bundleId: "bundle-1", destinationPath: "/tmp/diagnostics-bundle.json" }
        ]
      ])
    })
  )
})

test("DiagnosticsBundle bridge client rejects malformed input before native transport", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const runtime = ManagedRuntime.make(
    Layer.provide(
      DiagnosticsBundleLive,
      DiagnosticsBundleSurface.bridgeClientLayer(
        diagnosticsBundleExchange(requests, () => ({ kind: "success", payload: undefined }))
      )
    )
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      const exit = yield* Effect.exit(diagnostics.write(invalidWriteInput()))

      expect(requests).toEqual([])
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          tag: "InvalidArgument",
          operation: "DiagnosticsBundle.write"
        })
      }
    })
  )
})

test("DiagnosticsBundle bridge client rejects non-JSON redact payloads before native transport", () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const runtime = ManagedRuntime.make(
    Layer.provide(
      DiagnosticsBundleLive,
      DiagnosticsBundleSurface.bridgeClientLayer(
        diagnosticsBundleExchange(requests, () => ({ kind: "success", payload: undefined }))
      )
    )
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      const exit = yield* Effect.exit(diagnostics.redact(invalidRedactInput()))

      expect(requests).toEqual([])
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toMatchObject({
          tag: "InvalidArgument",
          operation: "DiagnosticsBundle.redact"
        })
      }
    })
  )
})

test("NativeCapabilities reports diagnostics bundle privileged operations as supported", () => {
  const runtime = ManagedRuntime.make(
    makeNativeCapabilitiesLayer(Native.available(Native.DiagnosticsBundle))
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* NativeCapabilities
      const support = yield* capabilities.support("DiagnosticsBundle.collect")
      yield* capabilities.require("DiagnosticsBundle.collect")

      expect(support).toEqual({ status: "supported" })
    })
  )
})

const diagnosticsBundleExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "DiagnosticsBundle.CollectStarted"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000800,
            traceId: "event-trace",
            method,
            payload: {
              type: "collect-started",
              bundleId: "bundle-1",
              timestamp: 1710000000800,
              sources: ["logs"]
            }
          })
        )
      : Stream.empty
})

const invalidWriteInput = (): DiagnosticsBundleWriteInput => {
  const input = new DiagnosticsBundleWriteInput({
    bundleId: "bundle-1",
    destinationPath: "/tmp/diagnostics-bundle.json"
  })
  Object.defineProperty(input, "destinationPath", { value: "" })
  return input
}

const invalidRedactInput = (): DiagnosticsBundleRedactInput => {
  const input = new DiagnosticsBundleRedactInput({
    bundleId: "bundle-1",
    source: "logs",
    payload: { safe: "ok" }
  })
  Object.defineProperty(input, "payload", { value: () => "not-json" })
  return input
}

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})
