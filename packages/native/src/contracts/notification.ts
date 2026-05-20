import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"

const WindowResource = ResourceHandleSchema("window", "open")
const OwnerWindowId = Schema.NonEmptyString
export const NotificationResource = ResourceHandleSchema("notification", "open")
export const PermissionState = Schema.Literals(["granted", "denied", "default"])

export type NotificationHandle = ResourceHandle<"notification", "open">
export type PermissionState = Schema.Schema.Type<typeof PermissionState>

export class NotificationAction extends Schema.Class<NotificationAction>("NotificationAction")({
  id: PrintableNonEmptyString,
  label: PrintableNonEmptyString
}) {}

export class NotificationShowInput extends Schema.Class<NotificationShowInput>(
  "NotificationShowInput"
)({
  title: PrintableNonEmptyString,
  body: PrintableNonEmptyString,
  actions: Schema.optionalKey(Schema.Array(NotificationAction)),
  ownerWindow: Schema.optionalKey(WindowResource)
}) {}

export type NotificationShowOptions = Schema.Schema.Type<typeof NotificationShowInput>

export class NotificationCloseInput extends Schema.Class<NotificationCloseInput>(
  "NotificationCloseInput"
)({
  notification: NotificationResource
}) {}

export class NotificationSupportedResult extends Schema.Class<NotificationSupportedResult>(
  "NotificationSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NotificationPermissionResult extends Schema.Class<NotificationPermissionResult>(
  "NotificationPermissionResult"
)({
  state: PermissionState
}) {}

export class NotificationClickEvent extends Schema.Class<NotificationClickEvent>(
  "NotificationClickEvent"
)({
  notification: NotificationResource,
  ownerWindowId: Schema.optionalKey(OwnerWindowId)
}) {}

export class NotificationActionEvent extends Schema.Class<NotificationActionEvent>(
  "NotificationActionEvent"
)({
  notification: NotificationResource,
  actionId: PrintableNonEmptyString,
  ownerWindowId: Schema.optionalKey(OwnerWindowId)
}) {}
