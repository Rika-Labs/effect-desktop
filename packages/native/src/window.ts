import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
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
  type RpcCapabilityMetadata,
  RpcGroup,
  RpcSupport,
  type RpcSupportMetadata,
  type WithRpcSupport,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  DesktopRpc,
  P,
  PermissionRegistry,
  ResourceRegistry,
  type DesktopRpcClient,
  type ResourceId,
  type SupportedRpc
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
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
  P.nativeInvoke({ primitive: "Window", methods: ["create"] })
)
export const WindowShow = unsupportedWindowRpc(
  "show",
  WindowHandleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["show"] })
)
export const WindowHide = unsupportedWindowRpc(
  "hide",
  WindowHandleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["hide"] })
)
export const WindowFocus = unsupportedWindowRpc(
  "focus",
  WindowHandleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["focus"] })
)
export const WindowClose = windowRpc(
  "close",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["close"] })
)
export const WindowSetTitle = unsupportedWindowRpc(
  "setTitle",
  WindowTitleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["setTitle"] })
)
export const WindowSetSize = unsupportedWindowRpc(
  "setSize",
  WindowSizeInput,
  P.nativeInvoke({ primitive: "Window", methods: ["setSize"] })
)
export const WindowSetPosition = unsupportedWindowRpc(
  "setPosition",
  WindowPositionInput,
  P.nativeInvoke({ primitive: "Window", methods: ["setPosition"] })
)
export const WindowSetBackgroundColor = unsupportedWindowRpc(
  "setBackgroundColor",
  WindowBackgroundColorInput,
  P.nativeInvoke({ primitive: "Window", methods: ["setBackgroundColor"] })
)
export const WindowSetVibrancy = unsupportedWindowRpc(
  "setVibrancy",
  WindowVibrancyInput,
  P.nativeInvoke({ primitive: "Window", methods: ["setVibrancy"] })
)
export const WindowSetHasShadow = unsupportedWindowRpc(
  "setHasShadow",
  WindowShadowInput,
  P.nativeInvoke({ primitive: "Window", methods: ["setHasShadow"] })
)
export const WindowEnterFullScreen = unsupportedWindowRpc(
  "enterFullScreen",
  WindowHandleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["enterFullScreen"] })
)
export const WindowExitFullScreen = unsupportedWindowRpc(
  "exitFullScreen",
  WindowHandleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["exitFullScreen"] })
)
export const WindowOnFullScreenChanged = unsupportedWindowStreamRpc(
  "onFullScreenChanged",
  WindowHandleInput,
  WindowFullScreenChanged,
  P.nativeInvoke({ primitive: "Window", methods: ["onFullScreenChanged"] })
)
export const WindowGetScaleFactor = unsupportedWindowRpc(
  "getScaleFactor",
  WindowHandleInput,
  WindowScaleFactorOutput,
  P.nativeInvoke({ primitive: "Window", methods: ["getScaleFactor"] })
)
export const WindowOnScaleChanged = unsupportedWindowStreamRpc(
  "onScaleChanged",
  WindowHandleInput,
  WindowScaleChanged,
  P.nativeInvoke({ primitive: "Window", methods: ["onScaleChanged"] })
)
export const WindowPersistState = unsupportedWindowRpc(
  "persistState",
  WindowHandleInput,
  P.nativeInvoke({ primitive: "Window", methods: ["persistState"] })
)

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

type WindowRpcUnion = RpcGroup.Rpcs<typeof WindowRpcGroup>

export const WindowRpcs: RpcGroup.RpcGroup<WindowRpcUnion> = WindowRpcGroup

export type WindowSupportedRpc = SupportedRpc<WindowRpcUnion>

export const WindowSupportedRpcs: RpcGroup.RpcGroup<WindowSupportedRpc> =
  DesktopRpc.supportedGroup(WindowRpcs)

export type WindowBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

type WindowRpcClient = DesktopRpcClient<WindowSupportedRpc>

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
      const client = yield* RpcClient.make(WindowSupportedRpcs)
      return windowClientFromRpcClient(client)
    })
  ).pipe(Layer.provide(makeWindowBridgeProtocolLayer(exchange, options)))

export type WindowRpcHandlers = ReturnType<typeof makeHostWindowHandlers>

export const WindowHandlersLive = WindowRpcGroup.toLayer({
  "Window.create": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.create(input)
    }),
  "Window.show": () => Effect.fail(unsupportedError("Window.show")),
  "Window.hide": () => Effect.fail(unsupportedError("Window.hide")),
  "Window.focus": () => Effect.fail(unsupportedError("Window.focus")),
  "Window.close": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.close(input.window)
    }),
  "Window.setTitle": () => Effect.fail(unsupportedError("Window.setTitle")),
  "Window.setSize": () => Effect.fail(unsupportedError("Window.setSize")),
  "Window.setPosition": () => Effect.fail(unsupportedError("Window.setPosition")),
  "Window.setBackgroundColor": () => Effect.fail(unsupportedError("Window.setBackgroundColor")),
  "Window.setVibrancy": () => Effect.fail(unsupportedError("Window.setVibrancy")),
  "Window.setHasShadow": () => Effect.fail(unsupportedError("Window.setHasShadow")),
  "Window.enterFullScreen": () => Effect.fail(unsupportedError("Window.enterFullScreen")),
  "Window.exitFullScreen": () => Effect.fail(unsupportedError("Window.exitFullScreen")),
  "Window.onFullScreenChanged": () => Effect.fail(unsupportedError("Window.onFullScreenChanged")),
  "Window.getScaleFactor": () => Effect.fail(unsupportedError("Window.getScaleFactor")),
  "Window.onScaleChanged": () => Effect.fail(unsupportedError("Window.onScaleChanged")),
  "Window.persistState": () => Effect.fail(unsupportedError("Window.persistState"))
})

export const WindowSurface = DesktopRpc.surface("Window", WindowRpcGroup, {
  service: WindowClient,
  handlers: WindowHandlersLive,
  client: windowClientFromRpcClient
})

export const makeHostWindowRpcRuntime = (
  exchange: HostWindowExchange,
  options: HostWindowRpcOptions = {},
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<ResourceRegistry | PermissionRegistry> =>
  makeNativeHostRpcRuntime(
    WindowRpcGroup,
    WindowRpcGroup.toLayer(makeHostWindowHandlers(exchange, options)) as Layer.Layer<
      Rpc.ToHandler<RpcGroup.Rpcs<typeof WindowRpcGroup>>,
      never,
      ResourceRegistry
    >,
    runtimeOptions
  )

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

function windowClientFromRpcClient(client: WindowRpcClient): WindowClientApi {
  return Object.freeze({
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
}

const decodeWindowHandle = (
  input: unknown,
  operation: string
): Effect.Effect<WindowHandle, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowResource)(input, StrictParseOptions).pipe(
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

const makeHostWindowHandlers = (exchange: HostWindowExchange, options: HostWindowRpcOptions) => {
  const host = makeHostWindowClient(exchange, options)
  const knownWindowIds = new Set<string>()
  const unsupported = (method: string) => Effect.fail(unsupportedError(method))

  return {
    "Window.create": (input: WindowCreateInput) =>
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
    "Window.show": () => unsupported("Window.show"),
    "Window.hide": () => unsupported("Window.hide"),
    "Window.focus": () => unsupported("Window.focus"),
    "Window.close": (input: WindowHandleInput) =>
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
            id: resourceId
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
    "Window.setTitle": () => unsupported("Window.setTitle"),
    "Window.setSize": () => unsupported("Window.setSize"),
    "Window.setPosition": () => unsupported("Window.setPosition"),
    "Window.setBackgroundColor": () => unsupported("Window.setBackgroundColor"),
    "Window.setVibrancy": () => unsupported("Window.setVibrancy"),
    "Window.setHasShadow": () => unsupported("Window.setHasShadow"),
    "Window.enterFullScreen": () => unsupported("Window.enterFullScreen"),
    "Window.exitFullScreen": () => unsupported("Window.exitFullScreen"),
    "Window.onFullScreenChanged": () => unsupported("Window.onFullScreenChanged"),
    "Window.getScaleFactor": () => unsupported("Window.getScaleFactor"),
    "Window.onScaleChanged": () => unsupported("Window.onScaleChanged"),
    "Window.persistState": () => unsupported("Window.persistState")
  }
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
  Object.freeze({
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

type WindowRpcSuccess = Schema.Codec<unknown, unknown, never, never>

type WindowRpc<
  Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
> = ReturnType<typeof windowRpc<Method, Payload, Success>>

type WindowStreamRpc<
  Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
> = ReturnType<typeof windowStreamRpc<Method, Payload, Success>>

type UnsupportedWindowRpc<
  Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
> = WithRpcSupport<
  WindowRpc<Method, Payload, Success>,
  { readonly status: "unsupported"; readonly reason: string }
>

type UnsupportedWindowStreamRpc<
  Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
> = WithRpcSupport<
  WindowStreamRpc<Method, Payload, Success>,
  { readonly status: "unsupported"; readonly reason: string }
>

function windowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return Rpc.make(`Window.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability(capability))
}

function windowStreamRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return Rpc.make(`Window.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema,
    stream: true
  }).pipe(RpcCapability(capability))
}

function unsupportedWindowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  capability: RpcCapabilityMetadata
): UnsupportedWindowRpc<Method, Payload, typeof Schema.Void>
function unsupportedWindowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata
): UnsupportedWindowRpc<Method, Payload, Success>
function unsupportedWindowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(
  method: Method,
  payload: Payload,
  successOrCapability: Success | RpcCapabilityMetadata,
  capability?: RpcCapabilityMetadata
): UnsupportedWindowRpc<Method, Payload, Success | typeof Schema.Void> {
  const success: WindowRpcSuccess =
    capability === undefined ? Schema.Void : (successOrCapability as Success)
  const resolvedCapability = (capability ?? successOrCapability) as RpcCapabilityMetadata
  if (resolvedCapability === undefined) {
    throw new Error("unsupported Window RPC is missing a capability")
  }
  return windowRpc(method, payload, success, resolvedCapability).pipe(
    RpcSupport.unsupported(UnsupportedWindowMethodSupport.reason)
  ) as UnsupportedWindowRpc<Method, Payload, Success | typeof Schema.Void>
}

function unsupportedWindowStreamRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata
): UnsupportedWindowStreamRpc<Method, Payload, Success> {
  return windowStreamRpc(method, payload, success, capability).pipe(
    RpcSupport.unsupported(UnsupportedWindowMethodSupport.reason)
  ) as UnsupportedWindowStreamRpc<Method, Payload, Success>
}
