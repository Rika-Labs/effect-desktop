import type { RedactionFilterOptions } from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EventGroup, EventJournal, EventLog } from "effect/unstable/eventlog"

import {
  makeInspectorSafetyPolicy,
  type InspectorSafetyPolicyApi
} from "./inspector-safety-policy.js"
import {
  NormalizedCapability,
  PermissionActor,
  PermissionActorPayload,
  PermissionMetadataText
} from "./permission-contracts.js"

const NonEmptyString = Schema.NonEmptyString
const AuditTimestamp = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const AuditPayloadBase = {
  source: NonEmptyString,
  traceId: NonEmptyString,
  outcome: NonEmptyString,
  timestamp: Schema.optionalKey(AuditTimestamp)
}
const ApprovalAuditActor = Schema.Union([PermissionActorPayload, PermissionMetadataText])

const PermissionAuditPayload = Schema.Struct({
  ...AuditPayloadBase,
  kind: Schema.Literals([
    "permission-granted",
    "permission-denied",
    "permission-revoked",
    "permission-expired",
    "permission-consumed",
    "permission-used"
  ]),
  normalizedCapability: NormalizedCapability,
  actor: PermissionActorPayload,
  resource: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Unknown)
})
type PermissionAuditPayload = typeof PermissionAuditPayload.Type

const ApprovalAuditPayload = Schema.Struct({
  ...AuditPayloadBase,
  kind: Schema.Literals(["approval-requested", "approval-granted", "approval-denied"]),
  actor: ApprovalAuditActor,
  resource: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Unknown)
})
type ApprovalAuditPayload = typeof ApprovalAuditPayload.Type

const CommandAuditDetails = Schema.Struct({
  commandId: NonEmptyString
})
type CommandAuditDetails = typeof CommandAuditDetails.Type

const CommandAuditPayload = Schema.Struct({
  ...AuditPayloadBase,
  kind: Schema.Literals(["command-registered", "command-unregistered", "command-invoked"]),
  details: CommandAuditDetails
})
type CommandAuditPayload = typeof CommandAuditPayload.Type

const JobRetryingAuditPayload = Schema.Struct({
  ...AuditPayloadBase,
  kind: Schema.Literal("job-retrying"),
  details: Schema.optionalKey(Schema.Unknown)
})
type JobRetryingAuditPayload = typeof JobRetryingAuditPayload.Type

const SecretsAuditDetails = Schema.Struct({
  namespace: NonEmptyString,
  operation: NonEmptyString,
  key: Schema.optionalKey(NonEmptyString)
})
type SecretsAuditDetails = typeof SecretsAuditDetails.Type

const SecretsAuditPayload = Schema.Struct({
  ...AuditPayloadBase,
  kind: Schema.Literal("secrets-accessed"),
  details: SecretsAuditDetails
})
type SecretsAuditPayload = typeof SecretsAuditPayload.Type

const TraceIdMissingAuditDetails = Schema.Struct({
  boundary: NonEmptyString,
  envelopeKind: NonEmptyString,
  requestId: Schema.Union([Schema.String, Schema.Number]),
  method: NonEmptyString
})
type TraceIdMissingAuditDetails = typeof TraceIdMissingAuditDetails.Type

const TraceIdMissingAuditPayload = Schema.Struct({
  ...AuditPayloadBase,
  kind: Schema.Literal("trace-id-missing"),
  details: TraceIdMissingAuditDetails
})
type TraceIdMissingAuditPayload = typeof TraceIdMissingAuditPayload.Type
type AuditPayload =
  | PermissionAuditPayload
  | ApprovalAuditPayload
  | CommandAuditPayload
  | JobRetryingAuditPayload
  | SecretsAuditPayload
  | TraceIdMissingAuditPayload

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
  readonly actor: string | PermissionActor
  readonly resource?: string
  readonly timestamp?: number
  readonly details?: unknown
}

export interface AuditEventsApi {
  readonly emit: (event: AuditEvent) => Effect.Effect<void, EventJournal.EventJournalError, never>
}

export interface AuditEventsOptions {
  readonly redaction?: RedactionFilterOptions
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

const auditPrimaryKey = (payload: { readonly traceId: string }): string => payload.traceId

export const AuditGroup = EventGroup.empty
  .add({ tag: "permission-granted", primaryKey: auditPrimaryKey, payload: PermissionAuditPayload })
  .add({ tag: "permission-denied", primaryKey: auditPrimaryKey, payload: PermissionAuditPayload })
  .add({ tag: "permission-revoked", primaryKey: auditPrimaryKey, payload: PermissionAuditPayload })
  .add({ tag: "permission-expired", primaryKey: auditPrimaryKey, payload: PermissionAuditPayload })
  .add({ tag: "permission-consumed", primaryKey: auditPrimaryKey, payload: PermissionAuditPayload })
  .add({ tag: "permission-used", primaryKey: auditPrimaryKey, payload: PermissionAuditPayload })
  .add({ tag: "approval-requested", primaryKey: auditPrimaryKey, payload: ApprovalAuditPayload })
  .add({ tag: "approval-granted", primaryKey: auditPrimaryKey, payload: ApprovalAuditPayload })
  .add({ tag: "approval-denied", primaryKey: auditPrimaryKey, payload: ApprovalAuditPayload })
  .add({ tag: "command-registered", primaryKey: auditPrimaryKey, payload: CommandAuditPayload })
  .add({ tag: "command-unregistered", primaryKey: auditPrimaryKey, payload: CommandAuditPayload })
  .add({ tag: "command-invoked", primaryKey: auditPrimaryKey, payload: CommandAuditPayload })
  .add({ tag: "job-retrying", primaryKey: auditPrimaryKey, payload: JobRetryingAuditPayload })
  .add({ tag: "secrets-accessed", primaryKey: auditPrimaryKey, payload: SecretsAuditPayload })
  .add({
    tag: "trace-id-missing",
    primaryKey: auditPrimaryKey,
    payload: TraceIdMissingAuditPayload
  })

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
  emit: makeEmit(log, options)
})

const makeEmit =
  (log: EventLog.EventLog["Service"], options: AuditEventsOptions) =>
  (event: AuditEvent): Effect.Effect<void, EventJournal.EventJournalError, never> =>
    Effect.gen(function* () {
      const inspectorSafety =
        options.inspectorSafety ??
        (yield* makeInspectorSafetyPolicy(
          options.redaction === undefined ? {} : { redaction: options.redaction }
        ).pipe(Effect.orDie))
      const decision = yield* inspectorSafety.sanitize({
        source: "audit.events",
        payload: {
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
        }
      })
      if (Option.isNone(decision.value)) {
        return
      }
      yield* writeAuditPayload(log, event.kind, decision.value.value)
    })

const writeAuditPayload = (
  log: EventLog.EventLog["Service"],
  kind: AuditEventKind,
  payload: unknown
): Effect.Effect<void, EventJournal.EventJournalError, never> => {
  switch (kind) {
    case "permission-granted":
    case "permission-denied":
    case "permission-revoked":
    case "permission-expired":
    case "permission-consumed":
    case "permission-used":
      return writePayload(log, kind, PermissionAuditPayload, payload)
    case "approval-requested":
    case "approval-granted":
    case "approval-denied":
      return writePayload(log, kind, ApprovalAuditPayload, payload)
    case "command-registered":
    case "command-unregistered":
    case "command-invoked":
      return writePayload(log, kind, CommandAuditPayload, payload)
    case "job-retrying":
      return writePayload(log, kind, JobRetryingAuditPayload, payload)
    case "secrets-accessed":
      return writePayload(log, kind, SecretsAuditPayload, payload)
    case "trace-id-missing":
      return writePayload(log, kind, TraceIdMissingAuditPayload, payload)
  }
}

const writePayload = (
  log: EventLog.EventLog["Service"],
  kind: AuditEventKind,
  schema:
    | typeof PermissionAuditPayload
    | typeof ApprovalAuditPayload
    | typeof CommandAuditPayload
    | typeof JobRetryingAuditPayload
    | typeof SecretsAuditPayload
    | typeof TraceIdMissingAuditPayload,
  payload: unknown
): Effect.Effect<void, EventJournal.EventJournalError, never> =>
  Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.orDie,
    Effect.flatMap((decoded) =>
      log.write({
        schema: AuditSchema,
        event: kind,
        // Dynamic audit dispatch narrows the event and schema together above.
        payload: decoded as AuditPayload
      })
    )
  ) as Effect.Effect<void, EventJournal.EventJournalError, never>

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
