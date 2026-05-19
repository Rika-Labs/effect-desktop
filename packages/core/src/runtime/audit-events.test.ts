import { expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect"
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

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const makeAuditFixture = (): Effect.Effect<AuditEventsApi, never, EL.EventLog> =>
  Effect.gen(function* () {
    const log = yield* EL.EventLog
    return makeAuditEvents(log)
  })

test("AuditEvents writes audit events with redacted secret-shaped details", () =>
  Effect.runPromise(
    runScoped(
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
      }),
      eventLogLayer
    )
  ))

test("AuditEvents applies configured redaction policy before writing events", () =>
  Effect.runPromise(
    runScoped(
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
      }),
      eventLogLayer
    )
  ))

test("AuditEvents streams sanitized typed audit events", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const audit = yield* makeAuditFixture()
        const fiber = yield* audit
          .observe()
          .pipe(
            Stream.take(1),
            (stream) => Stream.runCollect(stream),
            Effect.forkChild({ startImmediately: true })
          )

        yield* audit.emit(
          secretsAuditEvent({
            source: "test",
            traceId: "trace-secret",
            outcome: "ok",
            operation: "read",
            namespace: "default",
            key: "api-token"
          })
        )

        const events = yield* Fiber.join(fiber)
        const event = events[0]
        expect(event?.kind).toBe("secrets-accessed")
        expect(encodeUnknownJson(event)).toContain("api-token")
        expect(encodeUnknownJson(event)).not.toContain("secret-value")
      }),
      eventLogLayer
    )
  ))

test("AuditEvents emits without error for all AuditEventKind values", () =>
  Effect.runPromise(
    runScoped(
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
      }),
      eventLogLayer
    )
  ))

test("AuditEvents rejects malformed typed eventlog payloads before append", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const audit = yield* makeAuditFixture()
        const exit = yield* Effect.exit(
          audit.emit(
            new AuditEvent({
              kind: "permission-denied",
              source: "test",
              traceId: "trace-malformed",
              outcome: "denied"
            })
          )
        )

        expect(Exit.isFailure(exit)).toBe(true)
      }),
      eventLogLayer
    )
  ))

test("AuditEvents emit is a no-op when audit is undefined", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { emitAuditEvent } = yield* Effect.promise(() => import("./audit-events.js"))
      const result = yield* emitAuditEvent(
        undefined,
        new AuditEvent({
          kind: "permission-granted",
          source: "test",
          traceId: "t1",
          outcome: "granted"
        })
      )
      expect(result).toBeUndefined()
    })
  ))

test("AuditEvent constructors reject invalid payload timestamps before append", () => {
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
