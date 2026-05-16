import { expect, test } from "bun:test"
import { Effect, Option, Schema, Stream } from "effect"

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

test("InspectorTest records redacted frames through an Effect layer", async () => {
  const result = await Effect.runPromise(
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
      return { recorded, session }
    }).pipe(Effect.provide(InspectorTestWithPolicy({ id: "session-test", startedAt: 1_000 })))
  )

  expect(Option.isSome(result.recorded)).toBe(true)
  expect(result.session.id).toBe("session-test")
  expect(result.session.frames[0]?.surface).toBe("diagnostics")
  expect(JSON.stringify(result.session)).not.toContain("secret-token")
  expect(JSON.stringify(result.session)).toContain("<redacted:redacted>")
})

test("ReplayTransport serves recorded sessions on the same fixture stream", async () => {
  const frames = await Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* ReplayTransport
      return yield* transport.surface("diagnostics").pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk))
      )
    }).pipe(Effect.provide(ReplayTransportFromSession(recordedDiagnosticsSession)))
  )

  expect(frames).toHaveLength(1)
  expect(frames[0]?.surface).toBe("diagnostics")
  expect(JSON.stringify(frames)).not.toContain("secret-token")
})

test("CollectorLaws reject invalid event shapes and unredacted fixture payloads", async () => {
  const invalidShape = await Effect.runPromiseExit(
    decodeRecordedSession({
      id: "bad-shape",
      startedAt: 1,
      frames: [{ atMs: 1, surface: "unknown", payload: {} }]
    })
  )
  const unsafeFixture = await Effect.runPromiseExit(
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
  const invalidPayload = await Effect.runPromiseExit(
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
  const validFixture = await Effect.runPromise(
    assertRecordedSessionFixture(recordedDiagnosticsSession)
  )

  expect(invalidShape._tag).toBe("Failure")
  expect(invalidPayload._tag).toBe("Failure")
  expect(unsafeFixture._tag).toBe("Failure")
  expect(validFixture.id).toBe("diagnostics-redacted")
})
