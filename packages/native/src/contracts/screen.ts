import { Schema } from "effect"

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
