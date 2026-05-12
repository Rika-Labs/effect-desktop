import {
  BridgeRpc,
  Client,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  type BridgeRpcResourceSpec,
  type BridgeRpcStreamSpec,
  type BridgeClientExchange,
  type BridgeClientOptions,
  BridgeResourceHandleShape,
  type HostWindowClientOptions,
  type HostWindowExchange,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  makeStaleHandleError,
  Rpc,
  RpcCapability,
  RpcGroup,
  RpcSupport,
  type RpcSupportMetadata,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { ResourceRegistry, type ResourceId } from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import { type AppEventRouterApi, windowScope } from "./app-events.js"
export * from "./contracts/window.js"
import {
  WindowBackgroundColorInput,
  WindowCreateInput,
  type WindowCreateOptions,
  type WindowHandle,
  WindowHandleInput,
  WindowPositionInput,
  WindowResource,
  WindowScaleChanged,
  WindowScaleFactorOutput,
  WindowSizeInput,
  WindowTitleInput,
  WindowVibrancyInput,
  WindowShadowInput,
  WindowFullScreenChanged
} from "./contracts/window.js"
const StrictParseOptions = { onExcessProperty: "error" } as const
const UnsupportedWindowMethodSupport = Object.freeze({
  status: "unsupported",
  reason: "host Window adapter does not implement this method yet"
}) satisfies RpcSupportMetadata
export type WindowError = HostProtocolError

export const WindowCreate = windowRpc(
  "create",
  WindowCreateInput,
  WindowResource,
  "native.invoke:Window.create"
)
export const WindowShow = unsupportedWindowRpc(
  "show",
  WindowHandleInput,
  "native.invoke:Window.show"
)
export const WindowHide = unsupportedWindowRpc(
  "hide",
  WindowHandleInput,
  "native.invoke:Window.hide"
)
export const WindowFocus = unsupportedWindowRpc(
  "focus",
  WindowHandleInput,
  "native.invoke:Window.focus"
)
export const WindowClose = windowRpc(
  "close",
  WindowHandleInput,
  Schema.Void,
  "native.invoke:Window.close"
)
export const WindowSetTitle = unsupportedWindowRpc(
  "setTitle",
  WindowTitleInput,
  "native.invoke:Window.setTitle"
)
export const WindowSetSize = unsupportedWindowRpc(
  "setSize",
  WindowSizeInput,
  "native.invoke:Window.setSize"
)
export const WindowSetPosition = unsupportedWindowRpc(
  "setPosition",
  WindowPositionInput,
  "native.invoke:Window.setPosition"
)
export const WindowSetBackgroundColor = unsupportedWindowRpc(
  "setBackgroundColor",
  WindowBackgroundColorInput,
  "native.invoke:Window.setBackgroundColor"
)
export const WindowSetVibrancy = unsupportedWindowRpc(
  "setVibrancy",
  WindowVibrancyInput,
  "native.invoke:Window.setVibrancy"
)
export const WindowSetHasShadow = unsupportedWindowRpc(
  "setHasShadow",
  WindowShadowInput,
  "native.invoke:Window.setHasShadow"
)
export const WindowEnterFullScreen = unsupportedWindowRpc(
  "enterFullScreen",
  WindowHandleInput,
  "native.invoke:Window.enterFullScreen"
)
export const WindowExitFullScreen = unsupportedWindowRpc(
  "exitFullScreen",
  WindowHandleInput,
  "native.invoke:Window.exitFullScreen"
)
export const WindowOnFullScreenChanged = unsupportedWindowRpc(
  "onFullScreenChanged",
  WindowHandleInput,
  BridgeRpc.Stream(WindowFullScreenChanged, HostProtocolErrorSchema),
  "native.invoke:Window.onFullScreenChanged"
)
export const WindowGetScaleFactor = unsupportedWindowRpc(
  "getScaleFactor",
  WindowHandleInput,
  WindowScaleFactorOutput,
  "native.invoke:Window.getScaleFactor"
)
export const WindowOnScaleChanged = unsupportedWindowRpc(
  "onScaleChanged",
  WindowHandleInput,
  BridgeRpc.Stream(WindowScaleChanged, HostProtocolErrorSchema),
  "native.invoke:Window.onScaleChanged"
)
export const WindowPersistState = unsupportedWindowRpc(
  "persistState",
  WindowHandleInput,
  "native.invoke:Window.persistState"
)

const WindowRpcEvents = Object.freeze({})

const WindowRpcGroup = RpcGroup.make(
  WindowCreate,
  WindowShow,
  WindowHide,
  WindowFocus,
  WindowClose,
  WindowSetTitle,
  WindowSetSize,
  WindowSetPosition,
  WindowSetBackgroundColor,
  WindowSetVibrancy,
  WindowSetHasShadow,
  WindowEnterFullScreen,
  WindowExitFullScreen,
  WindowOnFullScreenChanged,
  WindowGetScaleFactor,
  WindowOnScaleChanged,
  WindowPersistState
)

export const WindowRpcs = BridgeRpc.fromGroup("Window", WindowRpcGroup, WindowRpcEvents)

export const WindowMethodNames = Object.freeze([
  "create",
  "show",
  "hide",
  "focus",
  "close",
  "setTitle",
  "setSize",
  "setPosition",
  "setBackgroundColor",
  "setVibrancy",
  "setHasShadow",
  "enterFullScreen",
  "exitFullScreen",
  "onFullScreenChanged",
  "getScaleFactor",
  "onScaleChanged",
  "persistState"
] as const)

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
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<WindowClient> =>
  Layer.succeed(WindowClient)(makeWindowBridgeClient(exchange, options))

export type WindowRpcSpec = (typeof WindowRpcs)["spec"]

export const makeHostWindowBridgeRpcLayer = (
  exchange: HostWindowExchange,
  options: HostWindowRpcOptions = {}
): BridgeRpcLayer<"Window", WindowRpcSpec, BridgeRpcHandlers<WindowRpcSpec>> =>
  BridgeRpc.layer(WindowRpcs)(makeHostWindowHandlers(exchange, options))

export interface HostWindowRpcOptions extends HostWindowClientOptions {
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
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): WindowClientApi => {
  const client = Client({ Window: WindowRpcs }, exchange, options).Window as unknown as {
    readonly create: (input: WindowCreateInput) => Effect.Effect<WindowHandle, WindowError, never>
    readonly close: (input: WindowHandleInput) => Effect.Effect<void, WindowError, never>
  }
  const unsupported = (method: string) => Effect.fail(unsupportedError(method))

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
        if (decoded.persistState === true) {
          return yield* Effect.fail(unsupportedError("Window.create persistState"))
        }
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
  options: HostWindowRpcOptions
): BridgeRpcHandlers<WindowRpcSpec> => {
  const host = makeHostWindowClient(exchange, options)
  const knownWindowIds = new Set<string>()
  const unsupported = (method: string) => Effect.fail(unsupportedError(method))

  const handlers = {
    create: (input: WindowCreateInput) =>
      Effect.gen(function* () {
        if (input.persistState === true) {
          return yield* Effect.fail(unsupportedError("Window.create persistState"))
        }
        const registry = yield* ResourceRegistry
        const created = yield* host.create(toHostWindowCreateInput(input))
        knownWindowIds.add(created.windowId)
        const ownerScope = windowScope(created.windowId)
        yield* registry.declareScope(ownerScope, "app").pipe(Effect.orDie)
        const handle = yield* registry
          .register({
            kind: "window",
            id: created.windowId as ResourceId,
            ownerScope,
            state: "open"
          })
          .pipe(Effect.orDie)
        const window = toWindowHandle(handle)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowOpened(window)
        }
        return window
      }),
    show: () => unsupported("Window.show"),
    hide: () => unsupported("Window.hide"),
    focus: () => unsupported("Window.focus"),
    close: (input: WindowHandleInput) =>
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
    enterFullScreen: () => unsupported("Window.enterFullScreen"),
    exitFullScreen: () => unsupported("Window.exitFullScreen"),
    onFullScreenChanged: () => Stream.fail(unsupportedError("Window.onFullScreenChanged")),
    getScaleFactor: () => unsupported("Window.getScaleFactor"),
    onScaleChanged: () => Stream.fail(unsupportedError("Window.onScaleChanged")),
    persistState: () => unsupported("Window.persistState")
  }
  return handlers as unknown as BridgeRpcHandlers<WindowRpcSpec>
}

export const makeUnsupportedWindowClient = (): WindowClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, WindowError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, WindowError, never> =>
    Stream.fail(unsupportedError(method))

  const client: WindowClientApi = {
    create: () => unsupportedEffect<WindowHandle>("Window.create"),
    show: () => unsupportedEffect<void>("Window.show"),
    hide: () => unsupportedEffect<void>("Window.hide"),
    focus: () => unsupportedEffect<void>("Window.focus"),
    close: () => unsupportedEffect<void>("Window.close"),
    setTitle: () => unsupportedEffect<void>("Window.setTitle"),
    setSize: () => unsupportedEffect<void>("Window.setSize"),
    setPosition: () => unsupportedEffect<void>("Window.setPosition"),
    setBackgroundColor: () => unsupportedEffect<void>("Window.setBackgroundColor"),
    setVibrancy: () => unsupportedEffect<void>("Window.setVibrancy"),
    setHasShadow: () => unsupportedEffect<void>("Window.setHasShadow"),
    enterFullScreen: () => unsupportedEffect<void>("Window.enterFullScreen"),
    exitFullScreen: () => unsupportedEffect<void>("Window.exitFullScreen"),
    onFullScreenChanged: () =>
      unsupportedStream<WindowFullScreenChanged>("Window.onFullScreenChanged"),
    getScaleFactor: () => unsupportedEffect<WindowScaleFactorOutput>("Window.getScaleFactor"),
    onScaleChanged: () => unsupportedStream<WindowScaleChanged>("Window.onScaleChanged"),
    persistState: () => unsupportedEffect<void>("Window.persistState")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Window adapter does not implement this method yet",
    message: `unsupported Window method: ${method}`,
    operation: method,
    recoverable: false
  })

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
  new BridgeResourceHandleShape({
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

type WindowRpcSuccess = Schema.Schema<unknown> | BridgeRpcResourceSpec | BridgeRpcStreamSpec

function windowRpc<Payload extends Schema.Schema<unknown>, Success extends WindowRpcSuccess>(
  method: string,
  payload: Payload,
  success: Success,
  capability: string
) {
  return Rpc.make(`Window.${method}`, {
    payload,
    success: success as Schema.Schema<unknown>,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

function unsupportedWindowRpc<Payload extends Schema.Schema<unknown>>(
  method: string,
  payload: Payload,
  capability: string
): Rpc.Any
function unsupportedWindowRpc<
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
>(method: string, payload: Payload, success: Success, capability: string): Rpc.Any
function unsupportedWindowRpc<
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
>(
  method: string,
  payload: Payload,
  successOrCapability: Success | string,
  capability?: string
): Rpc.Any {
  const success = typeof successOrCapability === "string" ? Schema.Void : successOrCapability
  const resolvedCapability =
    typeof successOrCapability === "string" ? successOrCapability : capability
  return windowRpc(method, payload, success, resolvedCapability!).pipe(
    RpcSupport.unsupported(UnsupportedWindowMethodSupport.reason)
  )
}
