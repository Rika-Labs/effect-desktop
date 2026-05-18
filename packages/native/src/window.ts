import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostWindowClientOptions,
  type HostWindowExchange,
  type WindowBoundsInput as HostWindowBoundsInput,
  type WindowProgressInput as HostWindowProgressInput,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  makeStaleHandleError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  P,
  PermissionRegistry,
  ResourceRegistry,
  makeResourceId,
  type DesktopRpcClient,
  type ResourceRegistryApi
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import { type AppEventRouterApi, windowScope } from "./app-events.js"
export * from "./contracts/window.js"
import {
  WindowCreateInput,
  WindowBounds,
  WindowBoundsInput,
  WindowAlwaysOnTopInput,
  type WindowAttentionType,
  type WindowBoundsType,
  type WindowCreateOptions,
  WindowDecorationsInput,
  WindowFullscreenInput,
  type WindowHandle,
  WindowHandleInput,
  WindowListResult,
  WindowLookupInput,
  WindowProgressInput,
  type WindowProgressOptions,
  WindowResizableInput,
  WindowRequestAttentionInput,
  WindowResource,
  WindowState,
  WindowTitleInput
} from "./contracts/window.js"
const StrictParseOptions = { onExcessProperty: "error" } as const
export type WindowError = HostProtocolError

export const WindowCreate = windowRpc(
  "create",
  WindowCreateInput,
  WindowResource,
  P.nativeInvoke({ primitive: "Window", methods: ["create"] })
)
export const WindowClose = windowRpc(
  "close",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["close"] })
)
export const WindowShow = windowRpc(
  "show",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["show"] })
)
export const WindowHide = windowRpc(
  "hide",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["hide"] })
)
export const WindowFocus = windowRpc(
  "focus",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["focus"] })
)
export const WindowGetCurrent = windowRpc(
  "getCurrent",
  Schema.Void,
  WindowResource,
  P.nativeInvoke({ primitive: "Window", methods: ["getCurrent"] })
)
export const WindowGetById = windowRpc(
  "getById",
  WindowLookupInput,
  WindowResource,
  P.nativeInvoke({ primitive: "Window", methods: ["getById"] })
)
export const WindowList = windowRpc(
  "list",
  Schema.Void,
  WindowListResult,
  P.nativeInvoke({ primitive: "Window", methods: ["list"] })
)
export const WindowGetBounds = windowRpc(
  "getBounds",
  WindowHandleInput,
  WindowBounds,
  P.nativeInvoke({ primitive: "Window", methods: ["getBounds"] })
)
export const WindowSetBounds = windowRpc(
  "setBounds",
  WindowBoundsInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setBounds"] })
)
export const WindowCenter = windowRpc(
  "center",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["center"] })
)
export const WindowSetTitle = windowRpc(
  "setTitle",
  WindowTitleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setTitle"] })
)
export const WindowSetResizable = windowRpc(
  "setResizable",
  WindowResizableInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setResizable"] })
)
export const WindowSetDecorations = windowRpc(
  "setDecorations",
  WindowDecorationsInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setDecorations"] })
)
export const WindowSetAlwaysOnTop = windowRpc(
  "setAlwaysOnTop",
  WindowAlwaysOnTopInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setAlwaysOnTop"] })
)
export const WindowSetProgress = windowRpc(
  "setProgress",
  WindowProgressInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setProgress"] })
)
export const WindowRequestAttention = windowRpc(
  "requestAttention",
  WindowRequestAttentionInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["requestAttention"] })
)
export const WindowCancelAttention = windowRpc(
  "cancelAttention",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["cancelAttention"] })
)
export const WindowMinimize = windowRpc(
  "minimize",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["minimize"] })
)
export const WindowMaximize = windowRpc(
  "maximize",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["maximize"] })
)
export const WindowRestore = windowRpc(
  "restore",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["restore"] })
)
export const WindowSetFullscreen = windowRpc(
  "setFullscreen",
  WindowFullscreenInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["setFullscreen"] })
)
export const WindowGetState = windowRpc(
  "getState",
  WindowHandleInput,
  WindowState,
  P.nativeInvoke({ primitive: "Window", methods: ["getState"] })
)

const makeWindowRpcGroup = () =>
  RpcGroup.make(
    WindowCreate,
    WindowClose,
    WindowShow,
    WindowHide,
    WindowFocus,
    WindowGetCurrent,
    WindowGetById,
    WindowList,
    WindowGetBounds,
    WindowSetBounds,
    WindowCenter,
    WindowSetTitle,
    WindowSetResizable,
    WindowSetDecorations,
    WindowSetAlwaysOnTop,
    WindowSetProgress,
    WindowRequestAttention,
    WindowCancelAttention,
    WindowMinimize,
    WindowMaximize,
    WindowRestore,
    WindowSetFullscreen,
    WindowGetState
  )

const WindowRpcGroup = makeWindowRpcGroup()

type WindowRpcUnion = RpcGroup.Rpcs<typeof WindowRpcGroup>

export const WindowRpcs: RpcGroup.RpcGroup<WindowRpcUnion> = WindowRpcGroup

export type WindowSupportedRpc = WindowRpcUnion

export const WindowSupportedRpcs: RpcGroup.RpcGroup<WindowSupportedRpc> = WindowRpcs

export type WindowBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

type WindowRpcClient = DesktopRpcClient<WindowRpcUnion>

export const WindowMethodNames = Object.freeze([
  "create",
  "close",
  "show",
  "hide",
  "focus",
  "getCurrent",
  "getById",
  "list",
  "getBounds",
  "setBounds",
  "center",
  "setTitle",
  "setResizable",
  "setDecorations",
  "setAlwaysOnTop",
  "setProgress",
  "requestAttention",
  "cancelAttention",
  "minimize",
  "maximize",
  "restore",
  "setFullscreen",
  "getState"
] as const)

export interface WindowClientApi {
  readonly create: (input: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly show: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly hide: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly focus: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly getCurrent: () => Effect.Effect<WindowHandle, WindowError, never>
  readonly getById: (windowId: string) => Effect.Effect<WindowHandle, WindowError, never>
  readonly list: () => Effect.Effect<readonly WindowHandle[], WindowError, never>
  readonly getBounds: (window: WindowHandle) => Effect.Effect<WindowBounds, WindowError, never>
  readonly setBounds: (
    window: WindowHandle,
    bounds: WindowBoundsType
  ) => Effect.Effect<void, WindowError, never>
  readonly center: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly setTitle: (
    window: WindowHandle,
    title: string
  ) => Effect.Effect<void, WindowError, never>
  readonly setResizable: (
    window: WindowHandle,
    resizable: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setDecorations: (
    window: WindowHandle,
    decorations: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setAlwaysOnTop: (
    window: WindowHandle,
    alwaysOnTop: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setProgress: (
    window: WindowHandle,
    input: WindowProgressOptions
  ) => Effect.Effect<void, WindowError, never>
  readonly requestAttention: (
    window: WindowHandle,
    requestType: WindowAttentionType
  ) => Effect.Effect<void, WindowError, never>
  readonly cancelAttention: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly minimize: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly maximize: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly restore: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly setFullscreen: (
    window: WindowHandle,
    fullscreen: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly getState: (window: WindowHandle) => Effect.Effect<WindowState, WindowError, never>
}

export class WindowClient extends Context.Service<WindowClient, WindowClientApi>()(
  "@effect-desktop/native/WindowClient"
) {}

export interface WindowServiceApi extends Omit<WindowClientApi, "create"> {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
}

export class Window extends Context.Service<Window, WindowServiceApi>()(
  "@effect-desktop/native/Window"
) {
  static readonly layer = Layer.effect(Window)(
    Effect.gen(function* () {
      const client = yield* WindowClient
      return Window.of(makeWindowService(client))
    })
  )
}

export const WindowLive = Window.layer

export const makeWindowClientLayer = (client: WindowClientApi): Layer.Layer<WindowClient> =>
  Layer.succeed(WindowClient)(client)

export const makeWindowServiceLayer = (client: WindowClientApi): Layer.Layer<Window> =>
  Layer.provide(WindowLive, makeWindowClientLayer(client))

export const makeWindowBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: WindowBridgeClientOptions = {}
): Layer.Layer<WindowClient> => WindowSurface.bridgeClientLayer(exchange, options)

export type WindowRpcHandlers = ReturnType<typeof makeHostWindowHandlers>

export const WindowHandlersLive = WindowRpcGroup.toLayer({
  "Window.create": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.create(input)
    }),
  "Window.close": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.close(input.window)
    }),
  "Window.show": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.show(input.window)
    }),
  "Window.hide": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.hide(input.window)
    }),
  "Window.focus": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.focus(input.window)
    }),
  "Window.getCurrent": () =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.getCurrent()
    }),
  "Window.getById": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.getById(input.windowId)
    }),
  "Window.list": () =>
    Effect.gen(function* () {
      const window = yield* Window
      return new WindowListResult({ windows: yield* window.list() })
    }),
  "Window.getBounds": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.getBounds(input.window)
    }),
  "Window.setBounds": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setBounds(input.window, input.bounds)
    }),
  "Window.center": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.center(input.window)
    }),
  "Window.setTitle": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setTitle(input.window, input.title)
    }),
  "Window.setResizable": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setResizable(input.window, input.resizable)
    }),
  "Window.setDecorations": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setDecorations(input.window, input.decorations)
    }),
  "Window.setAlwaysOnTop": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setAlwaysOnTop(input.window, input.alwaysOnTop)
    }),
  "Window.setProgress": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setProgress(input.window, input)
    }),
  "Window.requestAttention": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.requestAttention(input.window, input.requestType)
    }),
  "Window.cancelAttention": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.cancelAttention(input.window)
    }),
  "Window.minimize": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.minimize(input.window)
    }),
  "Window.maximize": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.maximize(input.window)
    }),
  "Window.restore": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.restore(input.window)
    }),
  "Window.setFullscreen": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setFullscreen(input.window, input.fullscreen)
    }),
  "Window.getState": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.getState(input.window)
    })
})

export const WindowSurface = NativeSurface.make("Window", WindowRpcGroup, {
  service: WindowClient,
  capabilities: WindowMethodNames,
  handlers: WindowHandlersLive,
  client: (client) => windowClientFromRpcClient(client),
  bridgeClient: (client, _exchange) => windowClientFromRpcClient(client)
})

export const makeHostWindowRpcRuntime = (
  exchange: HostWindowExchange,
  options: HostWindowRpcOptions = {},
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<ResourceRegistry | PermissionRegistry> =>
  makeNativeHostRpcRuntime(
    WindowRpcGroup,
    WindowRpcGroup.toLayer(makeHostWindowHandlers(exchange, options)),
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
    close: (window) => client.close(window),
    show: (window) => client.show(window),
    hide: (window) => client.hide(window),
    focus: (window) => client.focus(window),
    getCurrent: () => client.getCurrent(),
    getById: (windowId) => client.getById(windowId),
    list: () => client.list(),
    getBounds: (window) => client.getBounds(window),
    setBounds: (window, bounds) => client.setBounds(window, bounds),
    center: (window) => client.center(window),
    setTitle: (window, title) => client.setTitle(window, title),
    setResizable: (window, resizable) => client.setResizable(window, resizable),
    setDecorations: (window, decorations) => client.setDecorations(window, decorations),
    setAlwaysOnTop: (window, alwaysOnTop) => client.setAlwaysOnTop(window, alwaysOnTop),
    setProgress: (window, input) => client.setProgress(window, input),
    requestAttention: (window, requestType) => client.requestAttention(window, requestType),
    cancelAttention: (window) => client.cancelAttention(window),
    minimize: (window) => client.minimize(window),
    maximize: (window) => client.maximize(window),
    restore: (window) => client.restore(window),
    setFullscreen: (window, fullscreen) => client.setFullscreen(window, fullscreen),
    getState: (window) => client.getState(window)
  }

  return Object.freeze(service)
}

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
      }),
    show: (window) => runWindowHandleRpc(client, "Window.show", window),
    hide: (window) => runWindowHandleRpc(client, "Window.hide", window),
    focus: (window) => runWindowHandleRpc(client, "Window.focus", window),
    getCurrent: () =>
      Effect.gen(function* () {
        const window = yield* runWindowRpc(
          client["Window.getCurrent"](undefined),
          "Window.getCurrent"
        )
        return yield* decodeWindowHandle(window, "Window.getCurrent")
      }),
    getById: (windowId) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WindowLookupInput)(
          { windowId },
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidArgumentError(
              "payload",
              formatUnknownError(error),
              "Window.getById"
            )
          )
        )
        const window = yield* runWindowRpc(client["Window.getById"](decoded), "Window.getById")
        return yield* decodeWindowHandle(window, "Window.getById")
      }),
    list: () =>
      Effect.gen(function* () {
        const result = yield* runWindowRpc(client["Window.list"](undefined), "Window.list")
        const decoded = yield* Schema.decodeUnknownEffect(WindowListResult)(
          result,
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidOutputError("Window.list", formatUnknownError(error))
          )
        )
        return decoded.windows
      }),
    getBounds: (window) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowHandleInput(window, "Window.getBounds")
        const bounds = yield* runWindowRpc(client["Window.getBounds"](decoded), "Window.getBounds")
        return yield* decodeWindowBounds(bounds, "Window.getBounds")
      }),
    setBounds: (window, bounds) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowBoundsInput(window, bounds, "Window.setBounds")
        yield* runWindowRpc(client["Window.setBounds"](decoded), "Window.setBounds")
      }),
    center: (window) => runWindowHandleRpc(client, "Window.center", window),
    setTitle: (window, title) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowTitleInput(window, title, "Window.setTitle")
        yield* runWindowRpc(client["Window.setTitle"](decoded), "Window.setTitle")
      }),
    setResizable: (window, resizable) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowResizableInput(window, resizable, "Window.setResizable")
        yield* runWindowRpc(client["Window.setResizable"](decoded), "Window.setResizable")
      }),
    setDecorations: (window, decorations) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowDecorationsInput(
          window,
          decorations,
          "Window.setDecorations"
        )
        yield* runWindowRpc(client["Window.setDecorations"](decoded), "Window.setDecorations")
      }),
    setAlwaysOnTop: (window, alwaysOnTop) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowAlwaysOnTopInput(
          window,
          alwaysOnTop,
          "Window.setAlwaysOnTop"
        )
        yield* runWindowRpc(client["Window.setAlwaysOnTop"](decoded), "Window.setAlwaysOnTop")
      }),
    setProgress: (window, input) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowProgressInput(window, input, "Window.setProgress")
        yield* runWindowRpc(client["Window.setProgress"](decoded), "Window.setProgress")
      }),
    requestAttention: (window, requestType) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowRequestAttentionInput(
          window,
          requestType,
          "Window.requestAttention"
        )
        yield* runWindowRpc(client["Window.requestAttention"](decoded), "Window.requestAttention")
      }),
    cancelAttention: (window) => runWindowHandleRpc(client, "Window.cancelAttention", window),
    minimize: (window) => runWindowHandleRpc(client, "Window.minimize", window),
    maximize: (window) => runWindowHandleRpc(client, "Window.maximize", window),
    restore: (window) => runWindowHandleRpc(client, "Window.restore", window),
    setFullscreen: (window, fullscreen) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowFullscreenInput(
          window,
          fullscreen,
          "Window.setFullscreen"
        )
        yield* runWindowRpc(client["Window.setFullscreen"](decoded), "Window.setFullscreen")
      }),
    getState: (window) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowHandleInput(window, "Window.getState")
        const state = yield* runWindowRpc(client["Window.getState"](decoded), "Window.getState")
        return yield* decodeWindowState(state, "Window.getState")
      })
  } satisfies WindowClientApi)
}

const runWindowHandleRpc = (
  client: WindowRpcClient,
  operation:
    | "Window.show"
    | "Window.hide"
    | "Window.focus"
    | "Window.center"
    | "Window.cancelAttention"
    | "Window.minimize"
    | "Window.maximize"
    | "Window.restore",
  window: WindowHandle
): Effect.Effect<void, WindowError, never> =>
  Effect.gen(function* () {
    const decoded = yield* decodeWindowHandleInput(window, operation)
    yield* runWindowRpc(client[operation](decoded), operation)
  })

const decodeWindowHandleInput = (
  window: WindowHandle,
  operation: string
): Effect.Effect<WindowHandleInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowHandleInput)({ window }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowBoundsInput = (
  window: WindowHandle,
  bounds: WindowBoundsType,
  operation: string
): Effect.Effect<WindowBoundsInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowBoundsInput)({ window, bounds }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowTitleInput = (
  window: WindowHandle,
  title: string,
  operation: string
): Effect.Effect<WindowTitleInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowTitleInput)({ window, title }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowResizableInput = (
  window: WindowHandle,
  resizable: boolean,
  operation: string
): Effect.Effect<WindowResizableInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowResizableInput)({ window, resizable }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowDecorationsInput = (
  window: WindowHandle,
  decorations: boolean,
  operation: string
): Effect.Effect<WindowDecorationsInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowDecorationsInput)(
    { window, decorations },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowAlwaysOnTopInput = (
  window: WindowHandle,
  alwaysOnTop: boolean,
  operation: string
): Effect.Effect<WindowAlwaysOnTopInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowAlwaysOnTopInput)(
    { window, alwaysOnTop },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowProgressInput = (
  window: WindowHandle,
  input: WindowProgressOptions,
  operation: string
): Effect.Effect<WindowProgressInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowProgressInput)(
    {
      window,
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      ...(input.desktopFilename === undefined ? {} : { desktopFilename: input.desktopFilename })
    },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowRequestAttentionInput = (
  window: WindowHandle,
  requestType: WindowAttentionType,
  operation: string
): Effect.Effect<WindowRequestAttentionInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowRequestAttentionInput)(
    { window, requestType },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowFullscreenInput = (
  window: WindowHandle,
  fullscreen: boolean,
  operation: string
): Effect.Effect<WindowFullscreenInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowFullscreenInput)(
    { window, fullscreen },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowBounds = (
  input: unknown,
  operation: string
): Effect.Effect<WindowBounds, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowBounds)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const decodeWindowState = (
  input: unknown,
  operation: string
): Effect.Effect<WindowState, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowState)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

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
  const childWindowIdsByParentId = new Map<string, Set<string>>()
  const parentWindowIdByChildId = new Map<string, string>()
  const windowHandleById = new Map<string, WindowHandle>()

  return {
    "Window.create": (input: WindowCreateInput) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const parent =
          input.parent === undefined
            ? undefined
            : (yield* assertKnownFreshWindow(
                { window: input.parent },
                knownWindowIds,
                "Window.create"
              )).window
        const created = yield* host.create(toHostWindowCreateInput(input, parent?.id))
        knownWindowIds.add(created.windowId)
        const ownerScope = windowScope(created.windowId)
        yield* registry.declareScope(ownerScope, parent?.ownerScope ?? "app").pipe(Effect.orDie)
        const handle = yield* registry
          .register({
            kind: "window",
            id: makeResourceId(created.windowId),
            ownerScope,
            state: "open"
          })
          .pipe(Effect.orDie)
        const window = toWindowHandle(handle)
        windowHandleById.set(window.id, window)
        if (parent !== undefined) {
          const children = childWindowIdsByParentId.get(parent.id) ?? new Set<string>()
          children.add(window.id)
          childWindowIdsByParentId.set(parent.id, children)
          parentWindowIdByChildId.set(window.id, parent.id)
        }
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowOpened(window)
        }
        return window
      }),
    "Window.close": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const { window } = input
        const resourceId = window.id
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
        yield* closeKnownWindowTree(window, host, registry, {
          ...(options.appEventRouter === undefined
            ? {}
            : { appEventRouter: options.appEventRouter }),
          childWindowIdsByParentId,
          parentWindowIdByChildId,
          windowHandleById
        })
      }),
    "Window.show": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.show")
        yield* host.show(window.id)
      }),
    "Window.hide": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.hide")
        yield* host.hide(window.id)
      }),
    "Window.focus": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.focus")
        yield* host.focus(window.id)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter
            .windowFocused(window.id)
            .pipe(
              Effect.mapError((error) =>
                makeHostProtocolInvalidStateError(error.windowId, "focused", "Window.focus")
              )
            )
        }
      }),
    "Window.getCurrent": () =>
      Effect.gen(function* () {
        const current = yield* host.getCurrent()
        return yield* lookupKnownFreshWindow(
          current.windowId,
          knownWindowIds,
          windowHandleById,
          "Window.getCurrent"
        )
      }),
    "Window.getById": (input: WindowLookupInput) =>
      Effect.gen(function* () {
        const found = yield* host.getById(input.windowId)
        if (found.windowId !== input.windowId) {
          return yield* Effect.fail(
            makeHostProtocolInvalidOutputError(
              "Window.getById",
              `host returned Window:${found.windowId} for requested Window:${input.windowId}`
            )
          )
        }
        return yield* lookupKnownFreshWindow(
          found.windowId,
          knownWindowIds,
          windowHandleById,
          "Window.getById"
        )
      }),
    "Window.list": () =>
      Effect.gen(function* () {
        const listed = yield* host.list()
        const freshWindows = yield* Effect.forEach(
          listed.windows,
          ({ windowId }) =>
            lookupKnownFreshWindow(windowId, knownWindowIds, windowHandleById, "Window.list").pipe(
              Effect.map((window) => window)
            ),
          { concurrency: "unbounded" }
        )
        return new WindowListResult({ windows: freshWindows })
      }),
    "Window.getBounds": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.getBounds")
        const bounds = yield* host.getBounds(window.id)
        return yield* decodeWindowBounds(bounds, "Window.getBounds")
      }),
    "Window.setBounds": (input: WindowBoundsInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setBounds"
        )
        yield* host.setBounds(window.id, toHostWindowBoundsInput(input.bounds))
      }),
    "Window.center": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.center")
        yield* host.center(window.id)
      }),
    "Window.setTitle": (input: WindowTitleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setTitle"
        )
        yield* host.setTitle(window.id, input.title)
      }),
    "Window.setResizable": (input: WindowResizableInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setResizable"
        )
        yield* host.setResizable(window.id, input.resizable)
      }),
    "Window.setDecorations": (input: WindowDecorationsInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setDecorations"
        )
        yield* host.setDecorations(window.id, input.decorations)
      }),
    "Window.setAlwaysOnTop": (input: WindowAlwaysOnTopInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setAlwaysOnTop"
        )
        yield* host.setAlwaysOnTop(window.id, input.alwaysOnTop)
      }),
    "Window.setProgress": (input: WindowProgressInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setProgress"
        )
        yield* host.setProgress(window.id, toHostWindowProgressInput(input))
      }),
    "Window.requestAttention": (input: WindowRequestAttentionInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.requestAttention"
        )
        yield* host.requestAttention(window.id, input.requestType)
      }),
    "Window.cancelAttention": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          input,
          knownWindowIds,
          "Window.cancelAttention"
        )
        yield* host.cancelAttention(window.id)
      }),
    "Window.minimize": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.minimize")
        yield* host.minimize(window.id)
      }),
    "Window.maximize": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.maximize")
        yield* host.maximize(window.id)
      }),
    "Window.restore": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.restore")
        yield* host.restore(window.id)
      }),
    "Window.setFullscreen": (input: WindowFullscreenInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setFullscreen"
        )
        yield* host.setFullscreen(window.id, input.fullscreen)
      }),
    "Window.getState": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.getState")
        const state = yield* host.getState(window.id)
        return yield* decodeWindowState(state, "Window.getState")
      })
  }
}

const assertKnownFreshWindow = (
  input: WindowHandleInput,
  knownWindowIds: ReadonlySet<string>,
  operation: string
): Effect.Effect<{ readonly window: WindowHandle }, WindowError, ResourceRegistry> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    const { window } = input
    const resourceId = window.id
    if (!knownWindowIds.has(window.id)) {
      return yield* Effect.fail(makeHostProtocolNotFoundError(`Window:${window.id}`, operation))
    }

    const existing = yield* registry.get(resourceId)
    if (Option.isNone(existing)) {
      return yield* Effect.fail(makeStaleHandleError(operation, window, window.generation + 1))
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
        Effect.mapError((error) => makeStaleHandleError(operation, window, error.actualGeneration))
      )

    return { window }
  })

const lookupKnownFreshWindow = (
  windowId: string,
  knownWindowIds: ReadonlySet<string>,
  windowHandleById: ReadonlyMap<string, WindowHandle>,
  operation: string
): Effect.Effect<WindowHandle, WindowError, ResourceRegistry> =>
  Effect.gen(function* () {
    const window = windowHandleById.get(windowId)
    if (window === undefined) {
      return yield* Effect.fail(makeHostProtocolNotFoundError(`Window:${windowId}`, operation))
    }
    const fresh = yield* assertKnownFreshWindow({ window }, knownWindowIds, operation)
    return fresh.window
  })

const toHostWindowCreateInput = (
  input: WindowCreateOptions,
  parentWindowId?: string
): WindowCreateOptions & { readonly parentWindowId?: string } => {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(parentWindowId === undefined ? {} : { parentWindowId }),
    ...(input.titleBarStyle === undefined ? {} : { titleBarStyle: input.titleBarStyle }),
    ...(input.vibrancy === undefined ? {} : { vibrancy: input.vibrancy }),
    ...(input.trafficLights === undefined ? {} : { trafficLights: input.trafficLights })
  }
}

const toHostWindowBoundsInput = (bounds: WindowBoundsType): HostWindowBoundsInput =>
  Object.freeze({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  })

const toHostWindowProgressInput = (input: WindowProgressInput): HostWindowProgressInput =>
  Object.freeze({
    ...(input.state === undefined ? {} : { state: input.state }),
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(input.desktopFilename === undefined ? {} : { desktopFilename: input.desktopFilename })
  })

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as WindowHandle

const closeKnownWindowTree = (
  window: WindowHandle,
  host: ReturnType<typeof makeHostWindowClient>,
  registry: ResourceRegistryApi,
  context: {
    readonly appEventRouter?: AppEventRouterApi
    readonly childWindowIdsByParentId: Map<string, Set<string>>
    readonly parentWindowIdByChildId: Map<string, string>
    readonly windowHandleById: Map<string, WindowHandle>
  }
): Effect.Effect<void, WindowError, never> =>
  Effect.gen(function* () {
    const childWindowIds = Array.from(context.childWindowIdsByParentId.get(window.id) ?? [])
    for (const childWindowId of childWindowIds) {
      const childWindow = context.windowHandleById.get(childWindowId)
      if (childWindow === undefined) {
        return yield* Effect.fail(
          makeHostProtocolInternalError(
            `Missing tracked child Window:${childWindowId}`,
            "Window.close"
          )
        )
      }
      yield* closeKnownWindowTree(childWindow, host, registry, context)
    }

    yield* host.destroy(window.id)
    if (context.appEventRouter !== undefined) {
      yield* context.appEventRouter.windowClosed(window.id)
    }
    yield* registry.closeScope(window.ownerScope)
    context.windowHandleById.delete(window.id)
    context.childWindowIdsByParentId.delete(window.id)
    const parentWindowId = context.parentWindowIdByChildId.get(window.id)
    if (parentWindowId !== undefined) {
      context.childWindowIdsByParentId.get(parentWindowId)?.delete(window.id)
      context.parentWindowIdByChildId.delete(window.id)
    }
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

type WindowRpcSuccess = Schema.Codec<unknown, unknown, never, never>

function windowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata = NativeSurface.support.supported
) {
  return NativeSurface.rpc("Window", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}
