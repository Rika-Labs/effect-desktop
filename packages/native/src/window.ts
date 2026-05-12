import {
  BridgeRpc,
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
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  makeStaleHandleError,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  RpcSupport,
  type RpcSupportMetadata,
  type WithRpcSupport,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { DesktopRpc, ResourceRegistry, type ResourceId } from "@effect-desktop/core"
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
  WindowResource.schema,
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

const makeWindowRpcGroup = () =>
  RpcGroup.make(
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

const WindowRpcGroup = makeWindowRpcGroup()

const WindowBridgeRpcs = BridgeRpc.fromGroup("Window", makeWindowRpcGroup(), WindowRpcEvents)

export const WindowRpcs = WindowRpcGroup

export type WindowSupportedRpc = typeof WindowCreate | typeof WindowClose

export const WindowSupportedRpcs = DesktopRpc.supportedGroup(
  WindowRpcGroup
) as unknown as RpcGroup.RpcGroup<WindowSupportedRpc> & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export type WindowBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

interface WindowGeneratedClient {
  readonly "Window.create": (input: WindowCreateInput) => Effect.Effect<unknown, unknown, never>
  readonly "Window.close": (input: WindowHandleInput) => Effect.Effect<unknown, unknown, never>
}

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
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
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
  options: WindowBridgeClientOptions = {}
): Layer.Layer<WindowClient> =>
  Layer.effect(WindowClient)(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(
        WindowSupportedRpcs as unknown as RpcGroup.RpcGroup<Rpc.Any>
      ) as unknown as Effect.Effect<WindowGeneratedClient, never, RpcClient.Protocol>
      return windowClientFromRpcClient(client)
    })
  ).pipe(Layer.provide(makeWindowBridgeProtocolLayer(exchange, options)))

export type WindowRpcSpec = (typeof WindowBridgeRpcs)["spec"]

export const makeHostWindowBridgeRpcLayer = (
  exchange: HostWindowExchange,
  options: HostWindowRpcOptions = {}
): BridgeRpcLayer<"Window", WindowRpcSpec, BridgeRpcHandlers<WindowRpcSpec>> =>
  BridgeRpc.layer(WindowBridgeRpcs)(makeHostWindowHandlers(exchange, options))

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
    close: (window) => client.close(window)
  }

  return Object.freeze(service)
}

const makeWindowBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: WindowBridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const windowClientFromRpcClient = (client: WindowGeneratedClient): WindowClientApi =>
  Object.freeze({
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
        const window = yield* runWindowRpc(client["Window.create"](decoded), "Window.create")
        return yield* decodeWindowHandle(window, "Window.create")
      }),
    close: (window) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WindowHandleInput)(
          { window },
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidArgumentError(
              "payload",
              formatUnknownError(error),
              "Window.close"
            )
          )
        )
        yield* runWindowRpc(client["Window.close"](decoded), "Window.close")
      })
  } satisfies WindowClientApi)

const decodeWindowHandle = (
  input: unknown,
  operation: string
): Effect.Effect<WindowHandle, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowResource.schema)(input, StrictParseOptions).pipe(
    Effect.map((handle) => handle as WindowHandle),
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const runWindowRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, WindowError, never> =>
  effect.pipe(
    Effect.mapError(mapWindowRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapWindowRpcClientError = (error: unknown): WindowError =>
  isWindowError(error) ? error : makeHostProtocolInternalError("Window RPC client failed", "Window")

const isWindowError = (error: unknown): error is WindowError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

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

  const client: WindowClientApi = {
    create: () => unsupportedEffect<WindowHandle>("Window.create"),
    close: () => unsupportedEffect<void>("Window.close")
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

type WindowRpc<
  Method extends string,
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
> = ReturnType<typeof windowRpc<Method, Payload, Success>>

type UnsupportedWindowRpc<
  Method extends string,
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
> = WithRpcSupport<
  WindowRpc<Method, Payload, Success>,
  { readonly status: "unsupported"; readonly reason: string }
>

function windowRpc<
  const Method extends string,
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`Window.${method}`, {
    payload,
    success: success as Schema.Schema<unknown>,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

function unsupportedWindowRpc<const Method extends string, Payload extends Schema.Schema<unknown>>(
  method: Method,
  payload: Payload,
  capability: string
): UnsupportedWindowRpc<Method, Payload, typeof Schema.Void>
function unsupportedWindowRpc<
  const Method extends string,
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: string
): UnsupportedWindowRpc<Method, Payload, Success>
function unsupportedWindowRpc<
  const Method extends string,
  Payload extends Schema.Schema<unknown>,
  Success extends WindowRpcSuccess
>(
  method: Method,
  payload: Payload,
  successOrCapability: Success | string,
  capability?: string
): UnsupportedWindowRpc<Method, Payload, Success | typeof Schema.Void> {
  const success = typeof successOrCapability === "string" ? Schema.Void : successOrCapability
  const resolvedCapability =
    typeof successOrCapability === "string" ? successOrCapability : capability
  if (resolvedCapability === undefined) {
    throw new Error("unsupported Window RPC is missing a capability")
  }
  return windowRpc(method, payload, success, resolvedCapability).pipe(
    RpcSupport.unsupported(UnsupportedWindowMethodSupport.reason)
  )
}
