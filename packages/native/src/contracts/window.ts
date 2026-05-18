import { ResourceHandleSchema, type ResourceHandle } from "@effect-desktop/core"
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
const WindowProgressStateLiteral = Schema.Literals([
  "none",
  "normal",
  "indeterminate",
  "paused",
  "error"
])
const WindowAttentionTypeLiteral = Schema.Literals(["critical", "informational"])
const WindowRegistryEventPhase = Schema.Literals(["opened", "focused", "closed"])

export const WindowResource = ResourceHandleSchema("window", "open")
export type WindowHandle = ResourceHandle<"window", "open">

export class WindowTrafficLights extends Schema.Class<WindowTrafficLights>("WindowTrafficLights")({
  x: NonNegativeFiniteNumber,
  y: NonNegativeFiniteNumber
}) {}

export class WindowCreateInput extends Schema.Class<WindowCreateInput>("WindowCreateInput")({
  title: Schema.optionalKey(Schema.NonEmptyString),
  width: Schema.optionalKey(PositiveFiniteNumber),
  height: Schema.optionalKey(PositiveFiniteNumber),
  parent: Schema.optionalKey(WindowResource),
  titleBarStyle: Schema.optionalKey(WindowTitleBarStyle),
  vibrancy: Schema.optionalKey(WindowVibrancyMaterial),
  trafficLights: Schema.optionalKey(WindowTrafficLights)
}) {}

export type WindowCreateOptions = Schema.Schema.Type<typeof WindowCreateInput>

export class WindowHandleInput extends Schema.Class<WindowHandleInput>("WindowHandleInput")({
  window: WindowResource
}) {}

export class WindowLookupInput extends Schema.Class<WindowLookupInput>("WindowLookupInput")({
  windowId: Schema.NonEmptyString
}) {}

export class WindowListResult extends Schema.Class<WindowListResult>("WindowListResult")({
  windows: Schema.Array(WindowResource)
}) {}

export class WindowSubscribeEventsResult extends Schema.Class<WindowSubscribeEventsResult>(
  "WindowSubscribeEventsResult"
)({
  subscribed: Schema.Literal(true)
}) {}

export class WindowRegistryEvent extends Schema.Class<WindowRegistryEvent>("WindowRegistryEvent")({
  type: Schema.Literal("window-registry-event"),
  phase: WindowRegistryEventPhase,
  windowId: Schema.NonEmptyString,
  window: Schema.optionalKey(WindowResource),
  terminal: Schema.Boolean
}) {}

export class WindowBounds extends Schema.Class<WindowBounds>("WindowBounds")({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: PositiveFiniteNumber,
  height: PositiveFiniteNumber
}) {}

export type WindowBoundsType = Schema.Schema.Type<typeof WindowBounds>

export class WindowBoundsInput extends Schema.Class<WindowBoundsInput>("WindowBoundsInput")({
  window: WindowResource,
  bounds: WindowBounds
}) {}

export class WindowFullscreenInput extends Schema.Class<WindowFullscreenInput>(
  "WindowFullscreenInput"
)({
  window: WindowResource,
  fullscreen: Schema.Boolean
}) {}

export class WindowState extends Schema.Class<WindowState>("WindowState")({
  minimized: Schema.Boolean,
  maximized: Schema.Boolean,
  fullscreen: Schema.Boolean
}) {}

export class WindowTitleInput extends Schema.Class<WindowTitleInput>("WindowTitleInput")({
  window: WindowResource,
  title: Schema.String
}) {}

export class WindowResizableInput extends Schema.Class<WindowResizableInput>(
  "WindowResizableInput"
)({
  window: WindowResource,
  resizable: Schema.Boolean
}) {}

export class WindowDecorationsInput extends Schema.Class<WindowDecorationsInput>(
  "WindowDecorationsInput"
)({
  window: WindowResource,
  decorations: Schema.Boolean
}) {}

export class WindowAlwaysOnTopInput extends Schema.Class<WindowAlwaysOnTopInput>(
  "WindowAlwaysOnTopInput"
)({
  window: WindowResource,
  alwaysOnTop: Schema.Boolean
}) {}

export class WindowProgressInput extends Schema.Class<WindowProgressInput>("WindowProgressInput")({
  window: WindowResource,
  state: Schema.optionalKey(WindowProgressStateLiteral),
  progress: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100))
  ),
  desktopFilename: Schema.optionalKey(Schema.NonEmptyString)
}) {}

export type WindowProgressOptions = Omit<Schema.Schema.Type<typeof WindowProgressInput>, "window">

export class WindowRequestAttentionInput extends Schema.Class<WindowRequestAttentionInput>(
  "WindowRequestAttentionInput"
)({
  window: WindowResource,
  requestType: WindowAttentionTypeLiteral
}) {}

export type WindowAttentionType = Schema.Schema.Type<typeof WindowAttentionTypeLiteral>

export class WindowSizeInput extends Schema.Class<WindowSizeInput>("WindowSizeInput")({
  window: WindowResource,
  width: PositiveFiniteNumber,
  height: PositiveFiniteNumber
}) {}

export class WindowPositionInput extends Schema.Class<WindowPositionInput>("WindowPositionInput")({
  window: WindowResource,
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite())
}) {}

export class WindowBackgroundColorInput extends Schema.Class<WindowBackgroundColorInput>(
  "WindowBackgroundColorInput"
)({
  window: WindowResource,
  color: Schema.String
}) {}

export class WindowVibrancyInput extends Schema.Class<WindowVibrancyInput>("WindowVibrancyInput")({
  window: WindowResource,
  material: Schema.String
}) {}

export class WindowShadowInput extends Schema.Class<WindowShadowInput>("WindowShadowInput")({
  window: WindowResource,
  hasShadow: Schema.Boolean
}) {}

export class WindowScaleFactorOutput extends Schema.Class<WindowScaleFactorOutput>(
  "WindowScaleFactorOutput"
)({
  scaleFactor: PositiveFiniteNumber
}) {}

export class WindowFullScreenChanged extends Schema.Class<WindowFullScreenChanged>(
  "WindowFullScreenChanged"
)({
  window: WindowResource,
  fullscreen: Schema.Boolean
}) {}

export class WindowScaleChanged extends Schema.Class<WindowScaleChanged>("WindowScaleChanged")({
  window: WindowResource,
  scaleFactor: PositiveFiniteNumber
}) {}
