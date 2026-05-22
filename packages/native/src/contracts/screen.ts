import { Schema } from "effect"

export const ScreenMethod = Schema.Literals(["getDisplays", "getPrimaryDisplay", "getPointerPoint"])

export type ScreenMethod = Schema.Schema.Type<typeof ScreenMethod>

const ScreenCoordinate = Schema.Number.check(Schema.isFinite())
const ScreenPositiveNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))

export class ScreenBounds extends Schema.Class<ScreenBounds>("ScreenBounds")({
  x: ScreenCoordinate,
  y: ScreenCoordinate,
  width: ScreenPositiveNumber,
  height: ScreenPositiveNumber
}) {}

export class ScreenPoint extends Schema.Class<ScreenPoint>("ScreenPoint")({
  x: ScreenCoordinate,
  y: ScreenCoordinate
}) {}

export class ScreenDisplay extends Schema.Class<ScreenDisplay>("ScreenDisplay")({
  id: Schema.String,
  bounds: ScreenBounds,
  workArea: ScreenBounds,
  scaleFactor: ScreenPositiveNumber,
  primary: Schema.Boolean
}) {}

export class ScreenDisplaysResult extends Schema.Class<ScreenDisplaysResult>(
  "ScreenDisplaysResult"
)({
  displays: Schema.Array(ScreenDisplay)
}) {}

export class ScreenDisplaysChangedEvent extends Schema.Class<ScreenDisplaysChangedEvent>(
  "ScreenDisplaysChangedEvent"
)({
  displays: Schema.Array(ScreenDisplay)
}) {}

export class ScreenIsSupportedInput extends Schema.Class<ScreenIsSupportedInput>(
  "ScreenIsSupportedInput"
)({
  method: ScreenMethod
}) {}

export class ScreenSupportedResult extends Schema.Class<ScreenSupportedResult>(
  "ScreenSupportedResult"
)({
  supported: Schema.Boolean
}) {}
