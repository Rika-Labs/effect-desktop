import {
  Api,
  type ApiContractError,
  type ApiContractClass,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  type ApiResourceHandle,
  HostProtocolError as HostProtocolErrorSchema,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

const PositiveFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const WindowResource = Api.Resource("window", "open")

export type WindowHandle = ApiResourceHandle<"window", "open">
export type WindowError = HostProtocolError

export class WindowCreateInput extends Schema.Class<WindowCreateInput>("WindowCreateInput")({
  title: Schema.optionalKey(Schema.String),
  width: Schema.optionalKey(PositiveFiniteNumber),
  height: Schema.optionalKey(PositiveFiniteNumber),
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

export const WindowApiSpec = Object.freeze({
  create: {
    input: WindowCreateInput,
    output: WindowResource,
    error: HostProtocolErrorSchema
  },
  show: handleMethodSpec(),
  hide: handleMethodSpec(),
  focus: handleMethodSpec(),
  close: handleMethodSpec(),
  setTitle: {
    input: WindowTitleInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  setSize: {
    input: WindowSizeInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  setPosition: {
    input: WindowPositionInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  setBackgroundColor: {
    input: WindowBackgroundColorInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  setVibrancy: {
    input: WindowVibrancyInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  setHasShadow: {
    input: WindowShadowInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  setFullscreen: {
    input: WindowFullscreenInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  },
  enterFullScreen: handleMethodSpec(),
  exitFullScreen: handleMethodSpec(),
  onFullScreenChanged: {
    input: WindowHandleInput,
    output: Api.Stream(WindowFullScreenChanged, HostProtocolErrorSchema),
    error: HostProtocolErrorSchema
  },
  getScaleFactor: {
    input: WindowHandleInput,
    output: WindowScaleFactorOutput,
    error: HostProtocolErrorSchema
  },
  onScaleChanged: {
    input: WindowHandleInput,
    output: Api.Stream(WindowScaleChanged, HostProtocolErrorSchema),
    error: HostProtocolErrorSchema
  },
  persistState: handleMethodSpec()
}) satisfies ApiContractSpec

export type WindowApiSpec = typeof WindowApiSpec

export const WindowApi: ApiContractClass<"Window", WindowApiSpec> = (() => {
  const contract = class {
    static readonly tag = "Window"
    static readonly spec = WindowApiSpec
    static readonly events = Object.freeze({})

    static layer<Handlers extends ApiHandlers<WindowApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Window", WindowApiSpec, Handlers> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"Window", WindowApiSpec>

  return Object.freeze(contract)
})()

export const registerWindowApi = (): Effect.Effect<
  ApiContractClass<"Window", WindowApiSpec>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Window")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Window", WindowApiSpec>
    }

    return yield* Api.Tag("Window")<unknown>()(WindowApiSpec)
  })

export const WindowMethodNames = Object.freeze(
  Object.keys(WindowApiSpec) as ReadonlyArray<keyof WindowApiSpec>
)

export interface WindowClientApi {
  readonly create: (input: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly show: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly hide: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly focus: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly setTitle: (
    window: WindowHandle,
    title: string
  ) => Effect.Effect<void, WindowError, never>
  readonly setSize: (
    window: WindowHandle,
    size: WindowSize
  ) => Effect.Effect<void, WindowError, never>
  readonly setPosition: (
    window: WindowHandle,
    position: WindowPosition
  ) => Effect.Effect<void, WindowError, never>
  readonly setBackgroundColor: (
    window: WindowHandle,
    color: string
  ) => Effect.Effect<void, WindowError, never>
  readonly setVibrancy: (
    window: WindowHandle,
    material: string
  ) => Effect.Effect<void, WindowError, never>
  readonly setHasShadow: (
    window: WindowHandle,
    hasShadow: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setFullscreen: (
    window: WindowHandle,
    fullscreen: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly enterFullScreen: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly exitFullScreen: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly onFullScreenChanged: (
    window: WindowHandle
  ) => Stream.Stream<WindowFullScreenChanged, WindowError, never>
  readonly getScaleFactor: (
    window: WindowHandle
  ) => Effect.Effect<WindowScaleFactorOutput, WindowError, never>
  readonly onScaleChanged: (
    window: WindowHandle
  ) => Stream.Stream<WindowScaleChanged, WindowError, never>
  readonly persistState: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
}

export class WindowClient extends Context.Service<WindowClient, WindowClientApi>()(
  "@effect-desktop/native/WindowClient"
) {}

export interface WindowServiceApi extends Omit<WindowClientApi, "create"> {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
}

export class Window extends Context.Service<Window, WindowServiceApi>()(
  "@effect-desktop/native/Window"
) {}

export const WindowLive = Layer.effect(Window)(
  Effect.gen(function* () {
    const client = yield* WindowClient
    return makeWindowService(client)
  })
)

export const makeWindowClientLayer = (client: WindowClientApi): Layer.Layer<WindowClient> =>
  Layer.succeed(WindowClient)(client)

export const makeWindowServiceLayer = (client: WindowClientApi): Layer.Layer<Window> =>
  Layer.provide(WindowLive, makeWindowClientLayer(client))

export interface WindowSize {
  readonly width: number
  readonly height: number
}

export interface WindowPosition {
  readonly x: number
  readonly y: number
}

const makeWindowService = (client: WindowClientApi): WindowServiceApi => {
  const service: WindowServiceApi = {
    create: (input) => client.create(input ?? {}),
    show: (window) => client.show(window),
    hide: (window) => client.hide(window),
    focus: (window) => client.focus(window),
    close: (window) => client.close(window),
    setTitle: (window, title) => client.setTitle(window, title),
    setSize: (window, size) => client.setSize(window, size),
    setPosition: (window, position) => client.setPosition(window, position),
    setBackgroundColor: (window, color) => client.setBackgroundColor(window, color),
    setVibrancy: (window, material) => client.setVibrancy(window, material),
    setHasShadow: (window, hasShadow) => client.setHasShadow(window, hasShadow),
    setFullscreen: (window, fullscreen) => client.setFullscreen(window, fullscreen),
    enterFullScreen: (window) => client.enterFullScreen(window),
    exitFullScreen: (window) => client.exitFullScreen(window),
    onFullScreenChanged: (window) => client.onFullScreenChanged(window),
    getScaleFactor: (window) => client.getScaleFactor(window),
    onScaleChanged: (window) => client.onScaleChanged(window),
    persistState: (window) => client.persistState(window)
  }

  return Object.freeze(service)
}

function handleMethodSpec() {
  return {
    input: WindowHandleInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  } as const
}
