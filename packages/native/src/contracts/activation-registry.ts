import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const ActivationActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type ActivationActorKind = typeof ActivationActorKind.Type

export const ActivationSource = Schema.Literals([
  "global-shortcut",
  "tray",
  "dock",
  "taskbar",
  "protocol-link",
  "file-open",
  "notification",
  "custom"
])
export type ActivationSource = typeof ActivationSource.Type

export const ActivationEventPhase = Schema.Literals([
  "registered",
  "routed",
  "unregistered",
  "failed"
])
export type ActivationEventPhase = typeof ActivationEventPhase.Type

export const ActivationEventType = Schema.Literal("activation-registry-event")
export type ActivationEventType = typeof ActivationEventType.Type

const ActivationTimestamp = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

export const ActivationSurfaceResource = ResourceHandleSchema("activation-surface", "registered")
export type ActivationSurfaceHandle = ResourceHandle<"activation-surface", "registered">

export class ActivationActor extends Schema.Class<ActivationActor>("ActivationActor")({
  kind: ActivationActorKind,
  id: PrintableNonEmptyString
}) {}

export class ActivationPermissionContext extends Schema.Class<ActivationPermissionContext>(
  "ActivationPermissionContext"
)({
  actor: ActivationActor,
  resource: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: BridgeSafeNonEmptyString
}) {}

export class ActivationSurfaceRegistration extends Schema.Class<ActivationSurfaceRegistration>(
  "ActivationSurfaceRegistration"
)({
  surfaceId: BridgeSafeNonEmptyString,
  source: ActivationSource,
  commandId: PrintableNonEmptyString,
  actor: ActivationActor,
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ActivationSurfaceRequest extends Schema.Class<ActivationSurfaceRequest>(
  "ActivationSurfaceRequest"
)({
  surfaceId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ActivationRouteRequest extends Schema.Class<ActivationRouteRequest>(
  "ActivationRouteRequest"
)({
  surfaceId: BridgeSafeNonEmptyString,
  payload: Schema.Json,
  actor: ActivationActor,
  traceId: BridgeSafeNonEmptyString,
  permissionContext: ActivationPermissionContext
}) {}

export class ActivationRouteResult extends Schema.Class<ActivationRouteResult>(
  "ActivationRouteResult"
)({
  surfaceId: BridgeSafeNonEmptyString,
  commandId: PrintableNonEmptyString,
  routed: Schema.Boolean
}) {}

export class ActivationSurfaceList extends Schema.Class<ActivationSurfaceList>(
  "ActivationSurfaceList"
)({
  surfaces: Schema.Array(ActivationSurfaceRegistration)
}) {}

export class ActivationSupportedResult extends Schema.Class<ActivationSupportedResult>(
  "ActivationSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class ActivationEvent extends Schema.Class<ActivationEvent>("ActivationEvent")({
  type: ActivationEventType,
  timestamp: ActivationTimestamp,
  phase: ActivationEventPhase,
  surfaceId: BridgeSafeNonEmptyString,
  source: ActivationSource,
  payload: Schema.Json,
  actor: ActivationActor,
  traceId: BridgeSafeNonEmptyString,
  permissionContext: ActivationPermissionContext,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}
