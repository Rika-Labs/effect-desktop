import { expect, test } from "bun:test"
import { Effect, ManagedRuntime, Option, Schema, Stream } from "effect"

import {
  assertRecordedSessionFixture,
  CollectorLaws,
  collectorPayloadsDecode,
  decodeRecordedSession,
  InspectorTest,
  InspectorTestWithPolicy,
  RecordedInspectorFrame,
  RecordedSession,
  recordedDiagnosticsSession,
  ReplayTransport,
  ReplayTransportFromSession
} from "./index.js"

const DiagnosticsPayload = Schema.Struct({
  logs: Schema.Array(Schema.Struct({ message: Schema.String })),
  traces: Schema.Array(Schema.Unknown),
  metrics: Schema.Array(Schema.Unknown)
})

test("InspectorTest records redacted frames through an Effect layer", () => {
  const runtime = ManagedRuntime.make(
    InspectorTestWithPolicy({ id: "session-test", startedAt: 1_000 })
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const inspector = yield* InspectorTest
      const recorded = yield* inspector.record(
        "diagnostics",
        {
          logs: [
            {
              message: "failed",
              fields: { token: "secret-token", safe: "value" }
            }
          ]
        },
        { atMs: 1_010 }
      )
      const session = yield* inspector.session()

      expect(Option.isSome(recorded)).toBe(true)
      expect(session.id).toBe("session-test")
      expect(session.frames[0]?.surface).toBe("diagnostics")
      expect(JSON.stringify(session)).not.toContain("secret-token")
      expect(JSON.stringify(session)).toContain("<redacted:redacted>")
    })
  )
})

test("ReplayTransport serves recorded sessions on the same fixture stream", () => {
  const runtime = ManagedRuntime.make(ReplayTransportFromSession(recordedDiagnosticsSession))
  return runtime.runPromise(
    Effect.gen(function* () {
      const transport = yield* ReplayTransport
      const frames = yield* transport.surface("diagnostics").pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk))
      )

      expect(frames).toHaveLength(1)
      expect(frames[0]?.surface).toBe("diagnostics")
      expect(JSON.stringify(frames)).not.toContain("secret-token")
    })
  )
})

test("CollectorLaws reject invalid event shapes and unredacted fixture payloads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidShape = yield* Effect.exit(
        decodeRecordedSession({
          id: "bad-shape",
          startedAt: 1,
          frames: [{ atMs: 1, surface: "unknown", payload: {} }]
        })
      )
      const unsafeFixture = yield* Effect.exit(
        CollectorLaws.fixturesAreRedacted.check(
          new RecordedSession({
            id: "unsafe",
            startedAt: 1,
            frames: [
              new RecordedInspectorFrame({
                atMs: 1,
                surface: "diagnostics",
                payload: { token: "secret-token" }
              })
            ]
          })
        )
      )
      const invalidPayload = yield* Effect.exit(
        collectorPayloadsDecode("diagnostics", DiagnosticsPayload).check(
          new RecordedSession({
            id: "invalid-payload",
            startedAt: 1,
            frames: [
              new RecordedInspectorFrame({
                atMs: 1,
                surface: "diagnostics",
                payload: { logs: [{ message: 42 }], traces: [], metrics: [] }
              })
            ]
          })
        )
      )
      const validFixture = yield* assertRecordedSessionFixture(recordedDiagnosticsSession)

      expect(invalidShape._tag).toBe("Failure")
      expect(invalidPayload._tag).toBe("Failure")
      expect(unsafeFixture._tag).toBe("Failure")
      expect(validFixture.id).toBe("diagnostics-redacted")
    })
  ))
