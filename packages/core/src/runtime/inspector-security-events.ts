import { Option, Schema, Stream } from "effect"

import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  NormalizedCapability,
  PermissionActor,
  PermissionDecision,
  PermissionMetadataText
} from "./permission-contracts.js"
import type { PermissionRegistryApi } from "./permission-registry.js"

const InspectorTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const CspDirectiveSnapshot = Schema.Struct({
  name: PermissionMetadataText,
  values: Schema.Array(Schema.String)
})

export class SecretAccessPayload extends Schema.Class<SecretAccessPayload>("SecretAccessPayload")({
  namespace: PermissionMetadataText,
  operation: PermissionMetadataText,
  key: Schema.optionalKey(PermissionMetadataText)
}) {}

export class PermissionInspectorEvent extends Schema.Class<PermissionInspectorEvent>(
  "PermissionInspectorEvent"
)({
  kind: Schema.Literal("permission"),
  outcome: Schema.Literals(["granted", "denied"]),
  reason: Schema.optionalKey(
    Schema.Literals([
      "explicit-deny",
      "approval-denied",
      "revoked",
      "expired",
      "consumed",
      "default-deny"
    ])
  ),
  source: PermissionMetadataText,
  traceId: PermissionMetadataText,
  capability: NormalizedCapability,
  actor: PermissionActor,
  resource: Schema.optionalKey(PermissionMetadataText)
}) {}

export class AuditInspectorEvent extends Schema.Class<AuditInspectorEvent>("AuditInspectorEvent")({
  kind: Schema.Literal("audit"),
  auditKind: Schema.String,
  source: PermissionMetadataText,
  traceId: PermissionMetadataText,
  outcome: PermissionMetadataText,
  timestamp: Schema.optionalKey(InspectorTimestamp),
  capability: Schema.optionalKey(Schema.Unknown),
  actor: Schema.optionalKey(Schema.Unknown),
  resource: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Unknown)
}) {}

export class SecretAccessInspectorEvent extends Schema.Class<SecretAccessInspectorEvent>(
  "SecretAccessInspectorEvent"
)({
  kind: Schema.Literal("secret-access"),
  source: PermissionMetadataText,
  traceId: PermissionMetadataText,
  outcome: PermissionMetadataText,
  timestamp: Schema.optionalKey(InspectorTimestamp),
  details: SecretAccessPayload
}) {}

export class CspInspectorEvent extends Schema.Class<CspInspectorEvent>("CspInspectorEvent")({
  kind: Schema.Literal("csp"),
  decision: Schema.Literals(["nonce-issued", "policy-applied", "navigation-allowed", "blocked"]),
  source: PermissionMetadataText,
  traceId: PermissionMetadataText,
  outcome: PermissionMetadataText,
  timestamp: Schema.optionalKey(InspectorTimestamp),
  resource: Schema.optionalKey(Schema.String),
  directives: Schema.optionalKey(Schema.Array(CspDirectiveSnapshot)),
  reason: Schema.optionalKey(Schema.String)
}) {}

export const SecurityInspectorEvent = Schema.Union([
  PermissionInspectorEvent,
  AuditInspectorEvent,
  SecretAccessInspectorEvent,
  CspInspectorEvent
])
export type SecurityInspectorEvent = typeof SecurityInspectorEvent.Type

export const PermissionInspectorCollector = (
  registry: PermissionRegistryApi
): Stream.Stream<PermissionInspectorEvent, never, never> =>
  registry.observeDecisions().pipe(Stream.map(permissionDecisionToInspectorEvent))

export const AuditInspectorCollector = (
  audit: AuditEventsApi
): Stream.Stream<AuditInspectorEvent | SecretAccessInspectorEvent, never, never> =>
  audit.observe().pipe(Stream.map(auditEventToInspectorEvent))

export const CspInspectorCollector = (
  events: Stream.Stream<CspInspectorEvent, never, never>
): Stream.Stream<CspInspectorEvent, never, never> => events

export const SecurityInspectorCollector = (input: {
  readonly permissions?: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly csp?: Stream.Stream<CspInspectorEvent, never, never>
}): Stream.Stream<SecurityInspectorEvent, never, never> => {
  const streams: Stream.Stream<SecurityInspectorEvent, never, never>[] = []
  if (input.permissions !== undefined) {
    streams.push(PermissionInspectorCollector(input.permissions))
  }
  if (input.audit !== undefined) {
    streams.push(AuditInspectorCollector(input.audit))
  }
  if (input.csp !== undefined) {
    streams.push(CspInspectorCollector(input.csp))
  }
  return streams.length === 0
    ? Stream.empty
    : Stream.mergeAll(streams, { concurrency: "unbounded" })
}

export const cspInspectorEvent = (
  input: ConstructorParameters<typeof CspInspectorEvent>[0]
): CspInspectorEvent => new CspInspectorEvent(input)

const permissionDecisionToInspectorEvent = (
  decision: PermissionDecision
): PermissionInspectorEvent =>
  new PermissionInspectorEvent({
    kind: "permission",
    outcome: decision.outcome,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    source: decision.source,
    traceId: decision.traceId,
    capability: decision.capability,
    actor: decision.actor,
    ...(decision.resource === undefined ? {} : { resource: decision.resource })
  })

const auditEventToInspectorEvent = (
  event: AuditEvent
): AuditInspectorEvent | SecretAccessInspectorEvent => {
  if (event.kind === "secrets-accessed") {
    const details = Schema.decodeUnknownOption(SecretAccessPayload)(event.details)
    if (Option.isSome(details)) {
      return new SecretAccessInspectorEvent({
        kind: "secret-access",
        source: event.source,
        traceId: event.traceId,
        outcome: event.outcome,
        ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
        details: details.value
      })
    }
  }

  return new AuditInspectorEvent({
    kind: "audit",
    auditKind: event.kind,
    source: event.source,
    traceId: event.traceId,
    outcome: event.outcome,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    ...(event.normalizedCapability === undefined ? {} : { capability: event.normalizedCapability }),
    ...(event.actor === undefined ? {} : { actor: event.actor }),
    ...(event.resource === undefined ? {} : { resource: event.resource }),
    ...(event.details === undefined ? {} : { details: event.details })
  })
}
