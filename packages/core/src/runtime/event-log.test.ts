import { describe, expect, test } from "bun:test"

import { Effect, Layer } from "effect"
import { EventJournal, EventLog as EL, EventLogEncryption } from "effect/unstable/eventlog"

import {
  AuditEvent,
  AuditGroup,
  AuditGroupLayer,
  AuditReactivityLayer,
  makeAuditEvents
} from "./audit-events.js"

const AuditSchema = EL.schema(AuditGroup)

const identityLayer = Layer.effect(EL.Identity, EL.makeIdentity).pipe(
  Layer.provide(EventLogEncryption.layerSubtle)
)

const auditLayer = Layer.mergeAll(
  EventJournal.layerMemory,
  identityLayer,
  AuditGroupLayer,
  AuditReactivityLayer
).pipe(Layer.provideMerge(EL.layerRegistry))

const eventLogLayer = Layer.provide(EL.layerEventLog, auditLayer)

describe("EventLog (effect/unstable/eventlog)", () => {
  test("write publishes an audit event to the journal", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* EL.EventLog
        yield* log.write({
          schema: AuditSchema,
          event: "permission-granted",
          payload: { traceId: "t1", source: "test", outcome: "granted" }
        })
        const entries = yield* log.entries
        expect(entries).toHaveLength(1)
        expect(entries[0]?.event).toBe("permission-granted")
      }).pipe(Effect.provide(eventLogLayer))
    )
  })

  test("write publishes multiple audit events with distinct entries", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* EL.EventLog
        yield* log.write({
          schema: AuditSchema,
          event: "permission-granted",
          payload: { traceId: "t1", source: "test", outcome: "granted" }
        })
        yield* log.write({
          schema: AuditSchema,
          event: "permission-denied",
          payload: { traceId: "t2", source: "test", outcome: "denied" }
        })
        const entries = yield* log.entries
        expect(entries).toHaveLength(2)
        expect(entries.map((e: EventJournal.Entry) => e.event)).toEqual([
          "permission-granted",
          "permission-denied"
        ])
      }).pipe(Effect.provide(eventLogLayer))
    )
  })

  test("makeAuditEvents emit delegates to EventLog write", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* EL.EventLog
        const audit = makeAuditEvents(log)
        yield* audit.emit(
          new AuditEvent({
            kind: "permission-granted",
            source: "test",
            traceId: "trace-audit",
            outcome: "granted"
          })
        )
        const entries = yield* log.entries
        expect(entries).toHaveLength(1)
        expect(entries[0]?.event).toBe("permission-granted")
        expect(entries[0]?.primaryKey).toBe("trace-audit")
      }).pipe(Effect.provide(eventLogLayer))
    )
  })
})
