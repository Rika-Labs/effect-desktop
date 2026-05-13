import { expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { EventJournal, EventLog as EL, EventLogEncryption } from "effect/unstable/eventlog"

import {
  AuditEvent,
  AuditGroupLayer,
  AuditReactivityLayer,
  approvalAuditEvent,
  makeAuditEvents,
  permissionAuditEvent,
  secretsAuditEvent,
  type AuditEventsApi
} from "./audit-events.js"
import { PermissionActor, type NormalizedCapability } from "./permission-contracts.js"

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

test("AuditEvents applies configured redaction policy before writing events", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* EL.EventLog
      const audit = makeAuditEvents(log, {
        redaction: {
          additionalPatterns: ["customerSsn"],
          allowlist: ["details.sessionLabel"]
        }
      })

      yield* audit.emit(
        permissionAuditEvent({
          kind: "permission-denied",
          source: "test",
          traceId: "trace-1",
          outcome: "denied",
          normalizedCapability: filesystemWrite(["/tmp/app"]),
          actor: new PermissionActor({ kind: "window", id: "window-main" }),
          details: {
            customerSsn: "123-45-6789",
            sessionLabel: "safe-session"
          }
        })
      )

      const entries = yield* log.entries
      const payload = entries[0]?.payload
      const encodedPayload =
        payload instanceof Uint8Array ? Buffer.from(payload).toString("utf8") : ""
      expect(encodedPayload).toContain("<redacted:redacted>")
      expect(encodedPayload).toContain("safe-session")
      expect(encodedPayload).not.toContain("123-45-6789")
    }).pipe(Effect.provide(eventLogLayer))
  )
})

test("AuditEvents emits without error for all AuditEventKind values", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* makeAuditFixture()

      const permissionKinds: AuditEvent["kind"][] = [
        "permission-granted",
        "permission-denied",
        "permission-revoked",
        "permission-expired",
        "permission-consumed",
        "permission-used"
      ]

      for (const kind of permissionKinds) {
        yield* audit.emit(
          permissionAuditEvent({
            kind: kind as Parameters<typeof permissionAuditEvent>[0]["kind"],
            source: "test",
            traceId: `trace-${kind}`,
            outcome: "ok",
            normalizedCapability: filesystemWrite(["/tmp/app"]),
            actor: new PermissionActor({ kind: "window", id: "window-main" })
          })
        )
      }

      for (const kind of ["approval-requested", "approval-granted", "approval-denied"] as const) {
        yield* audit.emit(
          approvalAuditEvent({
            kind,
            source: "test",
            traceId: `trace-${kind}`,
            outcome: "ok",
            actor: "window-main"
          })
        )
      }

      for (const kind of [
        "command-registered",
        "command-unregistered",
        "command-invoked"
      ] as const) {
        yield* audit.emit(
          new AuditEvent({
            kind,
            source: "test",
            traceId: `trace-${kind}`,
            outcome: "ok",
            details: { commandId: "command:test" }
          })
        )
      }

      yield* audit.emit(
        new AuditEvent({
          kind: "job-retrying",
          source: "test",
          traceId: "trace-job-retrying",
          outcome: "retrying",
          details: { attempt: 1 }
        })
      )
      yield* audit.emit(
        secretsAuditEvent({
          source: "test",
          traceId: "trace-secrets-accessed",
          outcome: "ok",
          operation: "read",
          namespace: "default"
        })
      )
      yield* audit.emit(
        new AuditEvent({
          kind: "trace-id-missing",
          source: "test",
          traceId: "trace-missing",
          outcome: "auto-minted",
          details: {
            boundary: "host-runtime",
            envelopeKind: "request",
            requestId: "1",
            method: "Native.ping"
          }
        })
      )

      expect(true).toBe(true)
    })
  )
})

test("AuditEvents rejects malformed typed eventlog payloads before append", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* makeAuditFixture()
      return yield* Effect.exit(
        audit.emit(
          new AuditEvent({
            kind: "permission-denied",
            source: "test",
            traceId: "trace-malformed",
            outcome: "denied"
          })
        )
      )
    })
  )

  expect(Exit.isFailure(exit)).toBe(true)
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

test("AuditEvent constructors reject invalid payload timestamps before append", async () => {
  const invalidTimestamps = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1
  ] as const

  for (const timestamp of invalidTimestamps) {
    expect(() =>
      permissionAuditEvent({
        kind: "permission-granted",
        source: "test",
        traceId: "trace-1",
        outcome: "granted",
        normalizedCapability: filesystemWrite(["/tmp/app"]),
        actor: new PermissionActor({ kind: "window", id: "window-main" }),
        timestamp
      })
    ).toThrow()
    expect(() =>
      approvalAuditEvent({
        kind: "approval-requested",
        source: "test",
        traceId: "trace-1",
        outcome: "requested",
        actor: "window-main",
        timestamp
      })
    ).toThrow()
    expect(() =>
      secretsAuditEvent({
        source: "test",
        traceId: "trace-1",
        outcome: "accessed",
        operation: "get",
        namespace: "default",
        timestamp
      })
    ).toThrow()
    expect(
      () =>
        new AuditEvent({
          kind: "command-invoked",
          source: "test",
          traceId: "trace-1",
          outcome: "ok",
          timestamp
        })
    ).toThrow()
  }
})
