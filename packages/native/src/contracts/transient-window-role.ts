import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const TransientWindowRoleActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type TransientWindowRoleActorKind = typeof TransientWindowRoleActorKind.Type

export const TransientWindowRoleKind = Schema.Literals([
  "launcher",
  "palette",
  "popover",
  "utility-panel",
  "companion-window"
])
export type TransientWindowRoleKind = typeof TransientWindowRoleKind.Type

export const TransientWindowFocusPolicy = Schema.Literals([
  "take-focus",
  "preserve-focus",
  "restore-previous"
])
export type TransientWindowFocusPolicy = typeof TransientWindowFocusPolicy.Type

export const TransientWindowDismissalPolicy = Schema.Literals([
  "manual",
  "blur",
  "escape",
  "interact-outside",
  "transient"
])
export type TransientWindowDismissalPolicy = typeof TransientWindowDismissalPolicy.Type

export const TransientWindowZOrderPolicy = Schema.Literals(["normal", "floating", "always-on-top"])
export type TransientWindowZOrderPolicy = typeof TransientWindowZOrderPolicy.Type

export const TransientWindowRestorationPolicy = Schema.Literals([
  "none",
  "restore-focus",
  "restore-owner"
])
export type TransientWindowRestorationPolicy = typeof TransientWindowRestorationPolicy.Type

export const TransientWindowRoleEventPhase = Schema.Literals([
  "opened",
  "repositioned",
  "dismissed",
  "failed"
])
export type TransientWindowRoleEventPhase = typeof TransientWindowRoleEventPhase.Type

export const TransientWindowRoleEventType = Schema.Literal("transient-window-role-event")
export type TransientWindowRoleEventType = typeof TransientWindowRoleEventType.Type

const FiniteNumber = Schema.Number.check(Schema.isFinite())
const NonNegativeTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export const TransientWindowRoleResource = ResourceHandleSchema("transient-window-role", "open")
export type TransientWindowRoleHandle = ResourceHandle<"transient-window-role", "open">

export class TransientWindowRoleActor extends Schema.Class<TransientWindowRoleActor>(
  "TransientWindowRoleActor"
)({
  kind: TransientWindowRoleActorKind,
  id: PrintableNonEmptyString
}) {}

export class TransientWindowRolePoint extends Schema.Class<TransientWindowRolePoint>(
  "TransientWindowRolePoint"
)({
  x: FiniteNumber,
  y: FiniteNumber
}) {}

export class TransientWindowRolePlacement extends Schema.Class<TransientWindowRolePlacement>(
  "TransientWindowRolePlacement"
)({
  kind: Schema.Literals(["centered", "point", "owner-relative", "display-relative"]),
  ownerWindowId: Schema.optionalKey(BridgeSafeNonEmptyString),
  displayId: Schema.optionalKey(BridgeSafeNonEmptyString),
  point: Schema.optionalKey(TransientWindowRolePoint)
}) {}

export class TransientWindowRolePolicy extends Schema.Class<TransientWindowRolePolicy>(
  "TransientWindowRolePolicy"
)({
  role: TransientWindowRoleKind,
  focus: TransientWindowFocusPolicy,
  dismissal: TransientWindowDismissalPolicy,
  zOrder: TransientWindowZOrderPolicy,
  placement: TransientWindowRolePlacement,
  restoration: TransientWindowRestorationPolicy
}) {}

export class TransientWindowRoleOpenRequest extends Schema.Class<TransientWindowRoleOpenRequest>(
  "TransientWindowRoleOpenRequest"
)({
  actor: TransientWindowRoleActor,
  roleId: BridgeSafeNonEmptyString,
  policy: TransientWindowRolePolicy,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransientWindowRoleHandleRequest extends Schema.Class<TransientWindowRoleHandleRequest>(
  "TransientWindowRoleHandleRequest"
)({
  actor: TransientWindowRoleActor,
  handle: TransientWindowRoleResource,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransientWindowRoleRepositionRequest extends Schema.Class<TransientWindowRoleRepositionRequest>(
  "TransientWindowRoleRepositionRequest"
)({
  actor: TransientWindowRoleActor,
  handle: TransientWindowRoleResource,
  placement: TransientWindowRolePlacement,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransientWindowRoleSupportedResult extends Schema.Class<TransientWindowRoleSupportedResult>(
  "TransientWindowRoleSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const TransientWindowRoleEventPhasePayload = Schema.makeFilter<{
  readonly phase: TransientWindowRoleEventPhase
  readonly roleId?: string | undefined
  readonly reason?: string | undefined
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "opened":
    case "repositioned":
    case "dismissed":
      return (
        (value.roleId !== undefined && value.reason === undefined && value.message === undefined) ||
        `${value.phase} transient window role events require roleId and no failure metadata`
      )
    case "failed":
      return value.reason !== undefined || "failed transient window role events require reason"
  }
})

export class TransientWindowRoleEvent extends Schema.Class<TransientWindowRoleEvent>(
  "TransientWindowRoleEvent"
)(
  Schema.Struct({
    type: TransientWindowRoleEventType,
    timestamp: NonNegativeTimestamp,
    phase: TransientWindowRoleEventPhase,
    roleId: Schema.optionalKey(BridgeSafeNonEmptyString),
    reason: Schema.optionalKey(BridgeSafeString),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(TransientWindowRoleEventPhasePayload)
) {}
