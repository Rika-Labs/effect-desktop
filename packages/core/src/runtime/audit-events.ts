import { redact } from "@effect-desktop/bridge"
import { Context, Effect, Schema, Stream } from "effect"

import type {
  EventLogEntry,
  EventLogError,
  EventLogQueryOptions,
  EventLogStore,
  EventLogSubscribeOptions
} from "./event-log.js"
import type { NormalizedCapability, PermissionActor } from "./permission-registry.js"

const NonEmptyString = Schema.NonEmptyString

export const AuditEventKind = Schema.Literals([
  "permission-granted",
  "permission-denied",
  "permission-revoked",
  "permission-expired",
  "permission-consumed",
  "permission-used",
  "approval-requested",
  "approval-granted",
  "approval-denied"
])
export type AuditEventKind = typeof AuditEventKind.Type

export class AuditEvent extends Schema.Class<AuditEvent>("AuditEvent")({
  kind: AuditEventKind,
  source: NonEmptyString,
  traceId: NonEmptyString,
  outcome: NonEmptyString,
  timestamp: Schema.optionalKey(Schema.Number),
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
  readonly emit: (event: AuditEvent) => Effect.Effect<void, EventLogError, never>
  readonly query: (
    options?: EventLogQueryOptions
  ) => Effect.Effect<readonly EventLogEntry[], EventLogError, never>
  readonly subscribe: (
    options?: EventLogSubscribeOptions
  ) => Stream.Stream<EventLogEntry, EventLogError, never>
}

export const makeAuditEvents = (store: EventLogStore): AuditEventsApi =>
  Object.freeze({
    emit: (event: AuditEvent) =>
      store
        .append(
          {
            type: `audit/${event.kind}`,
            payload: redact({
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
            })
          },
          { source: "AuditEvents" }
        )
        .pipe(Effect.asVoid),
    query: (options?: EventLogQueryOptions) => store.query(options),
    subscribe: (options?: EventLogSubscribeOptions) => store.subscribe(options)
  })

export class AuditEvents extends Context.Service<AuditEvents, AuditEventsApi>()("AuditEvents", {
  make: Effect.succeed(
    Object.freeze({
      emit: () => Effect.void,
      query: () => Effect.succeed([]),
      subscribe: () => Stream.empty
    } satisfies AuditEventsApi)
  )
}) {}

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

export const emitAuditEvent = (
  audit: EventLogStore | undefined,
  event: AuditEvent
): Effect.Effect<void, EventLogError, never> =>
  audit === undefined ? Effect.void : makeAuditEvents(audit).emit(event)
