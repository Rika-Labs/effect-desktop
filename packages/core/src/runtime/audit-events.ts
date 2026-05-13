import { redactForJson } from "@effect-desktop/bridge"
import type { RedactionFilterOptions } from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"
import { EventGroup, EventJournal, EventLog } from "effect/unstable/eventlog"

import type { NormalizedCapability, PermissionActor } from "./permission-registry.js"

const NonEmptyString = Schema.NonEmptyString
const AuditTimestamp = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

export const AuditEventKind = Schema.Literals([
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
])
export type AuditEventKind = typeof AuditEventKind.Type

export class AuditEvent extends Schema.Class<AuditEvent>("AuditEvent")({
  kind: AuditEventKind,
  source: NonEmptyString,
  traceId: NonEmptyString,
  outcome: NonEmptyString,
  timestamp: Schema.optionalKey(AuditTimestamp),
  normalizedCapability: Schema.optionalKey(Schema.Unknown),
  actor: Schema.optionalKey(Schema.Unknown),
  resource: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Unknown)
}) {}

export interface PermissionAuditEventInput {
  readonly kind:
    | "permission-granted"
    | "permission-denied"
    | "permission-revoked"
    | "permission-expired"
    | "permission-consumed"
    | "permission-used"
  readonly source: string
  readonly traceId: string
  readonly outcome: string
  readonly normalizedCapability: NormalizedCapability
  readonly actor: PermissionActor
  readonly resource?: string
  readonly timestamp?: number
  readonly details?: unknown
}

export interface SecretsAuditEventInput {
  readonly source: string
  readonly traceId: string
  readonly outcome: string
  readonly operation: string
  readonly namespace: string
  readonly key?: string
  readonly timestamp?: number
}

export interface ApprovalAuditEventInput {
  readonly kind: "approval-requested" | "approval-granted" | "approval-denied"
  readonly source: string
  readonly traceId: string
  readonly outcome: string
  readonly actor: string
  readonly resource?: string
  readonly timestamp?: number
  readonly details?: unknown
}

export interface AuditEventsApi {
  readonly emit: (event: AuditEvent) => Effect.Effect<void, EventJournal.EventJournalError, never>
}

export interface AuditEventsOptions {
  readonly redaction?: RedactionFilterOptions
}

const auditPrimaryKey = (p: unknown): string => {
  const payload = p as { readonly traceId?: string }
  return payload.traceId ?? ""
}

export const AuditGroup = EventGroup.empty
  .add({ tag: "permission-granted", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "permission-denied", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "permission-revoked", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "permission-expired", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "permission-consumed", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "permission-used", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "approval-requested", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "approval-granted", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "approval-denied", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "command-registered", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "command-unregistered", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "command-invoked", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "job-retrying", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "secrets-accessed", primaryKey: auditPrimaryKey, payload: Schema.Unknown })
  .add({ tag: "trace-id-missing", primaryKey: auditPrimaryKey, payload: Schema.Unknown })

const AuditSchema = EventLog.schema(AuditGroup)

export const AuditGroupLayer = EventLog.group(AuditGroup, (handlers) =>
  handlers
    .handle("permission-granted", () => Effect.void)
    .handle("permission-denied", () => Effect.void)
    .handle("permission-revoked", () => Effect.void)
    .handle("permission-expired", () => Effect.void)
    .handle("permission-consumed", () => Effect.void)
    .handle("permission-used", () => Effect.void)
    .handle("approval-requested", () => Effect.void)
    .handle("approval-granted", () => Effect.void)
    .handle("approval-denied", () => Effect.void)
    .handle("command-registered", () => Effect.void)
    .handle("command-unregistered", () => Effect.void)
    .handle("command-invoked", () => Effect.void)
    .handle("job-retrying", () => Effect.void)
    .handle("secrets-accessed", () => Effect.void)
    .handle("trace-id-missing", () => Effect.void)
)

export const AuditReactivityLayer = EventLog.groupReactivity(AuditGroup, ["audit"])

export class AuditEvents extends Context.Service<AuditEvents, AuditEventsApi>()("AuditEvents", {
  make: Effect.succeed({
    emit: () => Effect.void as Effect.Effect<void, EventJournal.EventJournalError, never>
  } satisfies AuditEventsApi)
}) {}

export const AuditEventsLayer: Layer.Layer<
  AuditEvents,
  never,
  EventLog.EventLog | EventLog.Registry
> = Layer.effect(
  AuditEvents,
  Effect.gen(function* () {
    const log = yield* EventLog.EventLog
    return makeAuditEvents(log)
  })
)

export const makeAuditEvents = (
  log: EventLog.EventLog["Service"],
  options: AuditEventsOptions = {}
): AuditEventsApi => ({
  emit: makeEmit(log, options.redaction ?? {})
})

const makeEmit =
  (log: EventLog.EventLog["Service"], redaction: RedactionFilterOptions) =>
  (event: AuditEvent): Effect.Effect<void, EventJournal.EventJournalError, never> => {
    const payload = redactForJson(
      {
        kind: event.kind,
        source: event.source,
        traceId: event.traceId,
        outcome: event.outcome,
        ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
        ...(event.normalizedCapability === undefined
          ? {}
          : { normalizedCapability: event.normalizedCapability }),
        ...(event.actor === undefined ? {} : { actor: event.actor }),
        ...(event.resource === undefined ? {} : { resource: event.resource }),
        ...(event.details === undefined ? {} : { details: event.details })
      },
      redaction
    )
    return log.write({
      schema: AuditSchema,
      event: event.kind,
      payload
    }) as Effect.Effect<void, EventJournal.EventJournalError, never>
  }

export const emitAuditEvent = (
  audit: AuditEventsApi | undefined,
  event: AuditEvent
): Effect.Effect<void, EventJournal.EventJournalError, never> =>
  audit === undefined ? Effect.void : audit.emit(event)

export const permissionAuditEvent = (input: PermissionAuditEventInput): AuditEvent =>
  new AuditEvent({
    kind: input.kind,
    source: input.source,
    traceId: input.traceId,
    outcome: input.outcome,
    normalizedCapability: input.normalizedCapability,
    actor: input.actor,
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
    ...(input.details === undefined ? {} : { details: input.details })
  })

export const approvalAuditEvent = (input: ApprovalAuditEventInput): AuditEvent =>
  new AuditEvent({
    kind: input.kind,
    source: input.source,
    traceId: input.traceId,
    outcome: input.outcome,
    actor: input.actor,
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
    ...(input.details === undefined ? {} : { details: input.details })
  })

export const secretsAuditEvent = (input: SecretsAuditEventInput): AuditEvent =>
  new AuditEvent({
    kind: "secrets-accessed",
    source: input.source,
    traceId: input.traceId,
    outcome: input.outcome,
    ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
    details:
      input.key === undefined
        ? { namespace: input.namespace, operation: input.operation }
        : { namespace: input.namespace, key: input.key, operation: input.operation }
  })
