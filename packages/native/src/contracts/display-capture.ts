import { Schema } from "effect"

import { ImageMime } from "./image.js"
import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const DisplayCaptureActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type DisplayCaptureActorKind = typeof DisplayCaptureActorKind.Type

export const DisplayCaptureGrantKind = Schema.Literals(["user", "policy"])
export type DisplayCaptureGrantKind = typeof DisplayCaptureGrantKind.Type

export const DisplayCaptureSource = Schema.Literals(["display", "window", "region"])
export type DisplayCaptureSource = typeof DisplayCaptureSource.Type

export const DisplayCaptureEventPhase = Schema.Literals(["captured", "failed"])
export type DisplayCaptureEventPhase = typeof DisplayCaptureEventPhase.Type

export const DisplayCaptureEventType = Schema.Literal("display-capture-event")
export type DisplayCaptureEventType = typeof DisplayCaptureEventType.Type

const DisplayCaptureCoordinate = Schema.Number.check(Schema.isFinite())
const DisplayCaptureSize = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const DisplayCaptureTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const DisplayCaptureByte = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(255)
)

export class DisplayCaptureActor extends Schema.Class<DisplayCaptureActor>("DisplayCaptureActor")({
  kind: DisplayCaptureActorKind,
  id: PrintableNonEmptyString
}) {}

export class DisplayCaptureGrant extends Schema.Class<DisplayCaptureGrant>("DisplayCaptureGrant")({
  kind: DisplayCaptureGrantKind,
  id: BridgeSafeNonEmptyString,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class DisplayCaptureRegion extends Schema.Class<DisplayCaptureRegion>(
  "DisplayCaptureRegion"
)({
  x: DisplayCaptureCoordinate,
  y: DisplayCaptureCoordinate,
  width: DisplayCaptureSize,
  height: DisplayCaptureSize
}) {}

export class DisplayCaptureDisplayTarget extends Schema.Class<DisplayCaptureDisplayTarget>(
  "DisplayCaptureDisplayTarget"
)({
  source: Schema.Literal("display"),
  displayId: BridgeSafeNonEmptyString
}) {}

export class DisplayCaptureWindowTarget extends Schema.Class<DisplayCaptureWindowTarget>(
  "DisplayCaptureWindowTarget"
)({
  source: Schema.Literal("window"),
  windowId: BridgeSafeNonEmptyString
}) {}

export class DisplayCaptureRegionTarget extends Schema.Class<DisplayCaptureRegionTarget>(
  "DisplayCaptureRegionTarget"
)({
  source: Schema.Literal("region"),
  displayId: BridgeSafeNonEmptyString,
  region: DisplayCaptureRegion
}) {}

export const DisplayCaptureTarget = Schema.Union([
  DisplayCaptureDisplayTarget,
  DisplayCaptureWindowTarget,
  DisplayCaptureRegionTarget
])
export type DisplayCaptureTarget = typeof DisplayCaptureTarget.Type

const DisplayCaptureRequestFields = {
  actor: DisplayCaptureActor,
  grant: DisplayCaptureGrant,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
} as const

export class DisplayCaptureDisplayRequest extends Schema.Class<DisplayCaptureDisplayRequest>(
  "DisplayCaptureDisplayRequest"
)({
  ...DisplayCaptureRequestFields,
  target: DisplayCaptureDisplayTarget
}) {}

export class DisplayCaptureWindowRequest extends Schema.Class<DisplayCaptureWindowRequest>(
  "DisplayCaptureWindowRequest"
)({
  ...DisplayCaptureRequestFields,
  target: DisplayCaptureWindowTarget
}) {}

export class DisplayCaptureRegionRequest extends Schema.Class<DisplayCaptureRegionRequest>(
  "DisplayCaptureRegionRequest"
)({
  ...DisplayCaptureRequestFields,
  target: DisplayCaptureRegionTarget
}) {}

export const DisplayCaptureRequest = Schema.Union([
  DisplayCaptureDisplayRequest,
  DisplayCaptureWindowRequest,
  DisplayCaptureRegionRequest
])
export type DisplayCaptureRequest = typeof DisplayCaptureRequest.Type

export class DisplayCaptureImage extends Schema.Class<DisplayCaptureImage>("DisplayCaptureImage")({
  mime: ImageMime,
  bytes: Schema.Array(DisplayCaptureByte)
}) {}

export class DisplayCaptureMetadata extends Schema.Class<DisplayCaptureMetadata>(
  "DisplayCaptureMetadata"
)({
  captureId: BridgeSafeNonEmptyString,
  source: DisplayCaptureSource,
  displayId: Schema.optionalKey(BridgeSafeNonEmptyString),
  windowId: Schema.optionalKey(BridgeSafeNonEmptyString),
  region: Schema.optionalKey(DisplayCaptureRegion),
  byteLength: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  observedAt: DisplayCaptureTimestamp
}) {}

export class DisplayCaptureResult extends Schema.Class<DisplayCaptureResult>(
  "DisplayCaptureResult"
)({
  image: DisplayCaptureImage,
  metadata: DisplayCaptureMetadata
}) {}

export class DisplayCaptureSupportedResult extends Schema.Class<DisplayCaptureSupportedResult>(
  "DisplayCaptureSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class DisplayCaptureEvent extends Schema.Class<DisplayCaptureEvent>("DisplayCaptureEvent")({
  type: DisplayCaptureEventType,
  timestamp: DisplayCaptureTimestamp,
  phase: DisplayCaptureEventPhase,
  captureId: Schema.optionalKey(BridgeSafeNonEmptyString),
  source: Schema.optionalKey(DisplayCaptureSource),
  byteLength: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.optionalKey(BridgeSafeString),
  message: Schema.optionalKey(BridgeSafeString)
}) {}
