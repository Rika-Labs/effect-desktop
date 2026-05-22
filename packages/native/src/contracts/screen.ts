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

const ScreenDisplayList = Schema.Array(ScreenDisplay).check(
  Schema.makeFilter((displays) => {
    if (displays.length === 0) {
      return "screen display payload must include at least one display"
    }

    return (
      displays.filter((display) => display.primary).length === 1 ||
      "screen display payload must include exactly one primary display"
    )
  })
)

export class ScreenDisplaysResult extends Schema.Class<ScreenDisplaysResult>(
  "ScreenDisplaysResult"
)({
  displays: ScreenDisplayList
}) {}

export class ScreenDisplaysChangedEvent extends Schema.Class<ScreenDisplaysChangedEvent>(
  "ScreenDisplaysChangedEvent"
)({
  displays: ScreenDisplayList
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
