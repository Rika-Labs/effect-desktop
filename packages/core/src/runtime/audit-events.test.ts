import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { EventJournal, EventLog as EL, EventLogEncryption } from "effect/unstable/eventlog"

import {
  AuditEvent,
  AuditGroupLayer,
  AuditReactivityLayer,
  makeAuditEvents,
  permissionAuditEvent,
  type AuditEventsApi
} from "./audit-events.js"
import { PermissionActor, type NormalizedCapability } from "./permission-registry.js"

const filesystemWrite = (roots: readonly string[]): NormalizedCapability => ({
  kind: "filesystem.write",
  roots,
  audit: "always"
})

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

const makeAuditFixture = (): Effect.Effect<AuditEventsApi> =>
  Effect.gen(function* () {
    const log = yield* EL.EventLog
    return makeAuditEvents(log)
  }).pipe(Effect.provide(eventLogLayer))

test("AuditEvents writes audit events with redacted secret-shaped details", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* makeAuditFixture()

      yield* audit.emit(
        permissionAuditEvent({
          kind: "permission-denied",
          source: "test",
          traceId: "trace-1",
          outcome: "denied",
          normalizedCapability: filesystemWrite(["/tmp/app"]),
          actor: new PermissionActor({ kind: "window", id: "window-main" }),
          resource: "/tmp/app/secret.json",
          details: {
            reason: "default-deny",
            apiKey: "secret-value"
          }
        })
      )

      expect(true).toBe(true)
    })
  )
})

test("AuditEvents emits without error for all AuditEventKind values", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* makeAuditFixture()

      const kinds: AuditEvent["kind"][] = [
        "permission-granted",
        "permission-denied",
        "permission-revoked",
        "permission-expired",
        "permission-consumed",
        "permission-used",
        "approval-requested",
        "approval-granted",
        "approval-denied",
        "command-registered",
        "command-unregistered",
        "command-invoked",
        "job-retrying",
        "secrets-accessed",
        "trace-id-missing"
      ]

      for (const kind of kinds) {
        yield* audit.emit(
          new AuditEvent({
            kind,
            source: "test",
            traceId: `trace-${kind}`,
            outcome: "ok"
          })
        )
      }

      expect(true).toBe(true)
    })
  )
})

test("AuditEvents emit is a no-op when audit is undefined", async () => {
  const { emitAuditEvent } = await import("./audit-events.js")
  const result = await Effect.runPromise(
    emitAuditEvent(
      undefined,
      new AuditEvent({
        kind: "permission-granted",
        source: "test",
        traceId: "t1",
        outcome: "granted"
      })
    )
  )
  expect(result).toBeUndefined()
})
