import { Api, type ApiResourceHandle } from "@effect-desktop/bridge"
import { Schema } from "effect"

const PositiveFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const NonNegativeFiniteNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const WindowTitleBarStyle = Schema.Literals([
  "default",
  "hidden",
  "hiddenInset",
  "customButtonsOnHover"
])
const WindowVibrancyMaterial = Schema.Literals([
  "appearanceBased",
  "appearance-based",
  "contentBackground",
  "content-background",
  "headerView",
  "header-view",
  "hudWindow",
  "hud-window",
  "menu",
  "popover",
  "selection",
  "sidebar",
  "titlebar",
  "windowBackground",
  "window-background"
])

export const WindowResource = Api.Resource("window", "open")
export type WindowHandle = ApiResourceHandle<"window", "open">

export class WindowTrafficLights extends Schema.Class<WindowTrafficLights>("WindowTrafficLights")({
  x: NonNegativeFiniteNumber,
  y: NonNegativeFiniteNumber
}) {}

export class WindowCreateInput extends Schema.Class<WindowCreateInput>("WindowCreateInput")({
  title: Schema.optionalKey(Schema.NonEmptyString),
  width: Schema.optionalKey(PositiveFiniteNumber),
  height: Schema.optionalKey(PositiveFiniteNumber),
  titleBarStyle: Schema.optionalKey(WindowTitleBarStyle),
  vibrancy: Schema.optionalKey(WindowVibrancyMaterial),
  trafficLights: Schema.optionalKey(WindowTrafficLights),
  persistState: Schema.optionalKey(Schema.Boolean)
}) {}

export type WindowCreateOptions = Schema.Schema.Type<typeof WindowCreateInput>

export class WindowHandleInput extends Schema.Class<WindowHandleInput>("WindowHandleInput")({
  window: WindowResource.schema
}) {}

export class WindowTitleInput extends Schema.Class<WindowTitleInput>("WindowTitleInput")({
  window: WindowResource.schema,
  title: Schema.String
}) {}

export class WindowSizeInput extends Schema.Class<WindowSizeInput>("WindowSizeInput")({
  window: WindowResource.schema,
  width: PositiveFiniteNumber,
  height: PositiveFiniteNumber
}) {}

export class WindowPositionInput extends Schema.Class<WindowPositionInput>("WindowPositionInput")({
  window: WindowResource.schema,
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite())
}) {}

export class WindowBackgroundColorInput extends Schema.Class<WindowBackgroundColorInput>(
  "WindowBackgroundColorInput"
)({
  window: WindowResource.schema,
  color: Schema.String
}) {}

export class WindowVibrancyInput extends Schema.Class<WindowVibrancyInput>("WindowVibrancyInput")({
  window: WindowResource.schema,
  material: Schema.String
}) {}

export class WindowShadowInput extends Schema.Class<WindowShadowInput>("WindowShadowInput")({
  window: WindowResource.schema,
  hasShadow: Schema.Boolean
}) {}

export class WindowFullscreenInput extends Schema.Class<WindowFullscreenInput>(
  "WindowFullscreenInput"
)({
  window: WindowResource.schema,
  fullscreen: Schema.Boolean
}) {}

export class WindowScaleFactorOutput extends Schema.Class<WindowScaleFactorOutput>(
  "WindowScaleFactorOutput"
)({
  scaleFactor: PositiveFiniteNumber
}) {}

export class WindowFullScreenChanged extends Schema.Class<WindowFullScreenChanged>(
  "WindowFullScreenChanged"
)({
  window: WindowResource.schema,
  fullscreen: Schema.Boolean
}) {}

export class WindowScaleChanged extends Schema.Class<WindowScaleChanged>("WindowScaleChanged")({
  window: WindowResource.schema,
  scaleFactor: PositiveFiniteNumber
}) {}
