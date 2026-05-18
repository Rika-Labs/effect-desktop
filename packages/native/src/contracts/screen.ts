import { Schema } from "effect"

export const ScreenMethod = Schema.Literals(["getDisplays", "getPrimaryDisplay", "getPointerPoint"])

export type ScreenMethod = Schema.Schema.Type<typeof ScreenMethod>
export class ScreenBounds extends Schema.Class<ScreenBounds>("ScreenBounds")({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number
}) {}

export class ScreenPoint extends Schema.Class<ScreenPoint>("ScreenPoint")({
  x: Schema.Number,
  y: Schema.Number
}) {}

export class ScreenDisplay extends Schema.Class<ScreenDisplay>("ScreenDisplay")({
  id: Schema.String,
  bounds: ScreenBounds,
  workArea: ScreenBounds,
  scaleFactor: Schema.Number,
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
