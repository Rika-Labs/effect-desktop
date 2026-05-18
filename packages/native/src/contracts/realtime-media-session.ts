import { Schema } from "effect"

import { BridgeSafeNonEmptyString } from "./strings.js"

export const RealtimeMediaDeviceKind = Schema.Literals(["microphone", "speaker"])
export type RealtimeMediaDeviceKind = typeof RealtimeMediaDeviceKind.Type

export const RealtimeMediaPermissionState = Schema.Literals([
  "unknown",
  "prompt-required",
  "granted",
  "denied",
  "unsupported"
])
export type RealtimeMediaPermissionState = typeof RealtimeMediaPermissionState.Type

export const RealtimeMediaSessionState = Schema.Literals([
  "idle",
  "opening",
  "active",
  "interrupted",
  "closed"
])
export type RealtimeMediaSessionState = typeof RealtimeMediaSessionState.Type

export const RealtimeMediaInterruptionReason = Schema.Literals([
  "system",
  "user",
  "background",
  "device-lost",
  "host-failed"
])
export type RealtimeMediaInterruptionReason = typeof RealtimeMediaInterruptionReason.Type

export const RealtimeMediaSessionSupportReason = Schema.Literals([
  "host-adapter-unimplemented",
  "host-media-unavailable",
  "host-media-startup-unverified"
])
export type RealtimeMediaSessionSupportReason = typeof RealtimeMediaSessionSupportReason.Type

export class RealtimeMediaSessionIdentity extends Schema.Class<RealtimeMediaSessionIdentity>(
  "RealtimeMediaSessionIdentity"
)({
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString
}) {}

export class RealtimeMediaSessionOpenInput extends Schema.Class<RealtimeMediaSessionOpenInput>(
  "RealtimeMediaSessionOpenInput"
)({
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString
}) {}

export class RealtimeMediaSessionSelectDeviceInput extends Schema.Class<RealtimeMediaSessionSelectDeviceInput>(
  "RealtimeMediaSessionSelectDeviceInput"
)({
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString,
  kind: RealtimeMediaDeviceKind,
  deviceId: BridgeSafeNonEmptyString
}) {}

export class RealtimeMediaSessionInterruptInput extends Schema.Class<RealtimeMediaSessionInterruptInput>(
  "RealtimeMediaSessionInterruptInput"
)({
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString,
  reason: RealtimeMediaInterruptionReason
}) {}

export class RealtimeMediaSessionSupportedResult extends Schema.Class<RealtimeMediaSessionSupportedResult>(
  "RealtimeMediaSessionSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(RealtimeMediaSessionSupportReason)
}) {}

export const RealtimeMediaSessionSupportedOutput = RealtimeMediaSessionSupportedResult.check(
  Schema.makeFilter<RealtimeMediaSessionSupportedResult>((value) =>
    value.supported
      ? value.reason === undefined ||
        "supported result must not include reason when supported is true"
      : value.reason !== undefined || "supported result requires reason when supported is false"
  )
)

export class RealtimeMediaDeviceState extends Schema.Class<RealtimeMediaDeviceState>(
  "RealtimeMediaDeviceState"
)({
  kind: RealtimeMediaDeviceKind,
  deviceId: BridgeSafeNonEmptyString,
  label: BridgeSafeNonEmptyString,
  selected: Schema.Boolean,
  available: Schema.Boolean
}) {}

export class RealtimeMediaDeviceStateEvent extends Schema.Class<RealtimeMediaDeviceStateEvent>(
  "RealtimeMediaDeviceStateEvent"
)({
  type: Schema.Literal("device-state"),
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString,
  devices: Schema.Array(RealtimeMediaDeviceState)
}) {}

export class RealtimeMediaPermissionStateEvent extends Schema.Class<RealtimeMediaPermissionStateEvent>(
  "RealtimeMediaPermissionStateEvent"
)({
  type: Schema.Literal("permission-state"),
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString,
  microphone: RealtimeMediaPermissionState,
  speaker: RealtimeMediaPermissionState
}) {}

export class RealtimeMediaInterruptionEvent extends Schema.Class<RealtimeMediaInterruptionEvent>(
  "RealtimeMediaInterruptionEvent"
)({
  type: Schema.Literal("interruption"),
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString,
  reason: RealtimeMediaInterruptionReason
}) {}

export class RealtimeMediaSessionStateEvent extends Schema.Class<RealtimeMediaSessionStateEvent>(
  "RealtimeMediaSessionStateEvent"
)({
  type: Schema.Literal("session-state"),
  profileId: BridgeSafeNonEmptyString,
  sessionId: BridgeSafeNonEmptyString,
  state: RealtimeMediaSessionState
}) {}

export const RealtimeMediaSessionEvent = Schema.Union([
  RealtimeMediaDeviceStateEvent,
  RealtimeMediaPermissionStateEvent,
  RealtimeMediaInterruptionEvent,
  RealtimeMediaSessionStateEvent
])
export type RealtimeMediaSessionEvent = typeof RealtimeMediaSessionEvent.Type
