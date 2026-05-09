import {
  Api,
  Client,
  type ApiContractError,
  type ApiContractClass,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiResourceHandle,
  ApiResourceHandleShape,
  type HostWindowClientOptions,
  type HostWindowExchange,
  HostProtocolError as HostProtocolErrorSchema,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  makeStaleHandleError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { ResourceRegistry, type ResourceId } from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import { type AppEventRouterApi, windowScope } from "./app-events.js"

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
const WindowResource = Api.Resource("window", "open")
const StrictParseOptions = { onExcessProperty: "error" } as const

export class WindowTrafficLights extends Schema.Class<WindowTrafficLights>("WindowTrafficLights")({
  x: NonNegativeFiniteNumber,
  y: NonNegativeFiniteNumber
}) {}

export type WindowHandle = ApiResourceHandle<"window", "open">
export type WindowError = HostProtocolError

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

export const makeWindowBridgeClientLayer = (
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<WindowClient> =>
  Layer.succeed(WindowClient)(makeWindowBridgeClient(exchange, options))

export const makeHostWindowApiLayer = (
  exchange: HostWindowExchange,
  options: HostWindowApiOptions = {}
): ApiLayer<"Window", WindowApiSpec, ApiHandlers<WindowApiSpec>> =>
  WindowApi.layer(makeHostWindowHandlers(exchange, options))

export interface HostWindowApiOptions extends HostWindowClientOptions {
  readonly appEventRouter?: AppEventRouterApi
}

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

const makeWindowBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): WindowClientApi => {
  const client = Client({ Window: WindowApi }, exchange, options).Window
  const unsupported = (method: string) =>
    Effect.fail(makeHostProtocolInvalidStateError("unimplemented", "call", method))

  const windowClient: WindowClientApi = {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WindowCreateInput)(
          input,
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidArgumentError(
              "payload",
              formatUnknownError(error),
              "Window.create"
            )
          )
        )
        return yield* client.create(decoded)
      }),
    show: () => unsupported("Window.show"),
    hide: () => unsupported("Window.hide"),
    focus: () => unsupported("Window.focus"),
    close: (window) => client.close(new WindowHandleInput({ window })),
    setTitle: () => unsupported("Window.setTitle"),
    setSize: () => unsupported("Window.setSize"),
    setPosition: () => unsupported("Window.setPosition"),
    setBackgroundColor: () => unsupported("Window.setBackgroundColor"),
    setVibrancy: () => unsupported("Window.setVibrancy"),
    setHasShadow: () => unsupported("Window.setHasShadow"),
    setFullscreen: () => unsupported("Window.setFullscreen"),
    enterFullScreen: () => unsupported("Window.enterFullScreen"),
    exitFullScreen: () => unsupported("Window.exitFullScreen"),
    onFullScreenChanged: () => Stream.fail(unsupportedError("Window.onFullScreenChanged")),
    getScaleFactor: () => unsupported("Window.getScaleFactor"),
    onScaleChanged: () => Stream.fail(unsupportedError("Window.onScaleChanged")),
    persistState: () => unsupported("Window.persistState")
  }

  return Object.freeze(windowClient)
}

const makeHostWindowHandlers = (
  exchange: HostWindowExchange,
  options: HostWindowApiOptions
): ApiHandlers<WindowApiSpec> => {
  const host = makeHostWindowClient(exchange, options)
  const knownWindowIds = new Set<string>()
  const unsupported = (method: string) =>
    Effect.fail(makeHostProtocolInvalidStateError("unimplemented", "call", method))

  return {
    create: (input) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const created = yield* host.create(toHostWindowCreateInput(input))
        knownWindowIds.add(created.windowId)
        const ownerScope = windowScope(created.windowId)
        yield* registry.declareScope(ownerScope, "app")
        const handle = yield* registry.register({
          kind: "window",
          id: created.windowId as ResourceId,
          ownerScope,
          state: "open"
        })
        const window = toWindowHandle(handle)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowOpened(window)
        }
        return window
      }),
    show: () => unsupported("Window.show"),
    hide: () => unsupported("Window.hide"),
    focus: () => unsupported("Window.focus"),
    close: (input) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const { window } = input
        const resourceId = window.id as ResourceId
        if (!knownWindowIds.has(window.id)) {
          return yield* Effect.fail(
            makeHostProtocolNotFoundError(`Window:${window.id}`, "Window.close")
          )
        }

        const existing = yield* registry.get(resourceId)
        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            makeStaleHandleError("Window.close", window, window.generation + 1)
          )
        }

        yield* registry
          .assertFresh({
            kind: window.kind,
            generation: window.generation,
            ownerScope: window.ownerScope,
            state: window.state,
            id: resourceId,
            dispose: () => registry.dispose(resourceId)
          })
          .pipe(
            Effect.mapError((error) =>
              makeStaleHandleError("Window.close", window, error.actualGeneration)
            )
          )
        yield* host.destroy(window.id)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowClosed(window.id)
        }
        yield* registry.closeScope(window.ownerScope)
      }),
    setTitle: () => unsupported("Window.setTitle"),
    setSize: () => unsupported("Window.setSize"),
    setPosition: () => unsupported("Window.setPosition"),
    setBackgroundColor: () => unsupported("Window.setBackgroundColor"),
    setVibrancy: () => unsupported("Window.setVibrancy"),
    setHasShadow: () => unsupported("Window.setHasShadow"),
    setFullscreen: () => unsupported("Window.setFullscreen"),
    enterFullScreen: () => unsupported("Window.enterFullScreen"),
    exitFullScreen: () => unsupported("Window.exitFullScreen"),
    onFullScreenChanged: () => Stream.fail(unsupportedError("Window.onFullScreenChanged")),
    getScaleFactor: () => unsupported("Window.getScaleFactor"),
    onScaleChanged: () => Stream.fail(unsupportedError("Window.onScaleChanged")),
    persistState: () => unsupported("Window.persistState")
  }
}

const unsupportedError = (method: string): HostProtocolError =>
  makeHostProtocolInvalidStateError("unimplemented", "call", method)

const toHostWindowCreateInput = (input: WindowCreateOptions): WindowCreateOptions => {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.titleBarStyle === undefined ? {} : { titleBarStyle: input.titleBarStyle }),
    ...(input.vibrancy === undefined ? {} : { vibrancy: input.vibrancy }),
    ...(input.trafficLights === undefined ? {} : { trafficLights: input.trafficLights })
  }
}

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  new ApiResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as WindowHandle

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function handleMethodSpec() {
  return {
    input: WindowHandleInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema
  } as const
}
