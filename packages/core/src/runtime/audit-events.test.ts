import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"

import { EventLogEntry, type EventLogStore } from "./event-log.js"
import { makeAuditEvents, permissionAuditEvent } from "./audit-events.js"
import { PermissionActor, type NormalizedCapability } from "./permission-registry.js"

test("AuditEvents writes closed audit event names and redacts secret-shaped details", async () => {
  const rows: EventLogEntry[] = []
  const audit = makeAuditEvents(memoryAudit(rows))

  await Effect.runPromise(
    audit.emit(
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
  )

  expect(rows).toEqual([
    {
      id: 0,
      type: "audit/permission-denied",
      payload: {
        kind: "permission-denied",
        source: "test",
        traceId: "trace-1",
        outcome: "denied",
        normalizedCapability: filesystemWrite(["/tmp/app"]),
        actor: new PermissionActor({ kind: "window", id: "window-main" }),
        resource: "/tmp/app/secret.json",
        details: {
          reason: "default-deny",
          apiKey: "[REDACTED]"
        }
      },
      source: "AuditEvents",
      timestampMs: 1_000
    }
  ])
})

test("AuditEvents exposes redacted audit rows through the query API", async () => {
  const rows: EventLogEntry[] = []
  const audit = makeAuditEvents(memoryAudit(rows))

  await Effect.runPromise(
    audit.emit(
      permissionAuditEvent({
        kind: "permission-granted",
        source: "allow",
        traceId: "trace-2",
        outcome: "granted",
        normalizedCapability: filesystemWrite(["/tmp/app"]),
        actor: new PermissionActor({ kind: "window", id: "window-main" }),
        details: {
          token: "grant-1",
          password: "not-logged"
        }
      })
    )
  )

  const queried = await Effect.runPromise(audit.query({ type: "audit/permission-granted" }))

  expect(queried).toEqual([
    new EventLogEntry({
      id: 0,
      type: "audit/permission-granted",
      payload: {
        kind: "permission-granted",
        source: "allow",
        traceId: "trace-2",
        outcome: "granted",
        normalizedCapability: filesystemWrite(["/tmp/app"]),
        actor: new PermissionActor({ kind: "window", id: "window-main" }),
        details: {
          token: "[REDACTED]",
          password: "[REDACTED]"
        }
      },
      timestampMs: 1_000,
      source: "AuditEvents"
    })
  ])
})

const filesystemWrite = (roots: readonly string[]): NormalizedCapability => ({
  kind: "filesystem.write",
  roots,
  audit: "always"
})

const memoryAudit = (rows: EventLogEntry[]): EventLogStore => ({
  append: (event, options) =>
    Effect.sync(() => {
      rows.push(
        new EventLogEntry({
          id: rows.length,
          type: event.type,
          ...(event.payload === undefined ? {} : { payload: event.payload }),
          timestampMs: 1_000 + rows.length,
          ...(options?.source === undefined ? {} : { source: options.source })
        })
      )
      return rows.length - 1
    }),
  query: (options) =>
    Effect.succeed(
      rows.filter((row) => {
        if (options?.type !== undefined && row.type !== options.type) {
          return false
        }
        if (options?.from !== undefined && row.id < options.from) {
          return false
        }
        if (options?.to !== undefined && row.id > options.to) {
          return false
        }
        return true
      })
    ),
  subscribe: () => Stream.die("unused"),
  close: () => Effect.void
})
