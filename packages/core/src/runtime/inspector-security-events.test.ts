import { expect, test } from "bun:test"
import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect"
import { EventJournal, EventLog as EL, EventLogEncryption } from "effect/unstable/eventlog"

import {
  AuditGroupLayer,
  AuditReactivityLayer,
  makeAuditEvents,
  secretsAuditEvent
} from "./audit-events.js"
import { PermissionActor } from "./permission-contracts.js"
import { makePermissionRegistry, type NormalizedCapability } from "./permission-registry.js"
import {
  AuditInspectorCollector,
  PermissionInspectorCollector,
  SecurityInspectorCollector,
  cspInspectorEvent
} from "./inspector-security-events.js"

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

test("PermissionInspectorCollector streams permission allow and deny decisions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry({
        traceId: () => "trace-allow"
      })
      const actor = new PermissionActor({ kind: "window", id: "main" })
      const fiber = yield* PermissionInspectorCollector(registry).pipe(
        Stream.take(2),
        (stream) => Stream.runCollect(stream),
        Effect.forkChild({ startImmediately: true })
      )

      yield* registry.declare(filesystemWrite(["/tmp/app"]), { source: "policy" })
      yield* registry.check(filesystemWrite(["/tmp/app/file.txt"]), {
        actor,
        traceId: "trace-allow"
      })
      yield* Effect.exit(
        registry.check(filesystemWrite(["/private/file.txt"]), {
          actor,
          traceId: "trace-deny"
        })
      )

      const events = yield* Fiber.join(fiber)
      expect(events.map((event) => event.outcome)).toEqual(["granted", "denied"])
      expect(events[1]?.reason).toBe("default-deny")
    })
  ))

test("AuditInspectorCollector projects secret access without secret values", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const log = yield* EL.EventLog
        const audit = makeAuditEvents(log)
        const fiber = yield* AuditInspectorCollector(audit).pipe(
          Stream.take(1),
          (stream) => Stream.runCollect(stream),
          Effect.forkChild({ startImmediately: true })
        )

        yield* audit.emit(
          secretsAuditEvent({
            source: "Secrets.get",
            traceId: "trace-secret",
            outcome: "ok",
            operation: "read",
            namespace: "app",
            key: "api-token"
          })
        )

        const events = yield* Fiber.join(fiber)
        const encoded = encodeUnknownJson(events[0])
        expect(events[0]?.kind).toBe("secret-access")
        expect(encoded).toContain("api-token")
        expect(encoded).not.toContain("secret-value")
        expect(encoded).not.toContain("refresh-token")
      }),
      eventLogLayer
    )
  ))

test("SecurityInspectorCollector merges CSP events with security streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const csp = Stream.make(
        cspInspectorEvent({
          kind: "csp",
          decision: "blocked",
          source: "test",
          traceId: "trace-csp",
          outcome: "blocked",
          resource: "https://evil.test",
          reason: "origin-not-allowed"
        })
      )

      const events = yield* SecurityInspectorCollector({ csp }).pipe(
        Stream.take(1),
        Stream.runCollect
      )
      expect(events[0]?.kind).toBe("csp")
      expect(events[0]?.outcome).toBe("blocked")
    })
  ))
