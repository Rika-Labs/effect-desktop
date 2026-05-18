import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostWindowClientOptions,
  type HostWindowExchange,
  type WindowBoundsInput as HostWindowBoundsInput,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  makeStaleHandleError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  P,
  PermissionRegistry,
  ResourceRegistry,
  makeResourceId,
  type DesktopRpcClient
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
  type WindowBoundsType,
  type WindowCreateOptions,
  WindowDecorationsInput,
  WindowFullscreenInput,
  type WindowHandle,
  WindowHandleInput,
  WindowResizableInput,
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
    WindowGetBounds,
    WindowSetBounds,
    WindowCenter,
    WindowSetTitle,
    WindowSetResizable,
    WindowSetDecorations,
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

type WindowRpcClient = DesktopRpcClient<WindowSupportedRpc>

export const WindowMethodNames = Object.freeze([
  "create",
  "close",
  "show",
  "hide",
  "focus",
  "getBounds",
  "setBounds",
  "center",
  "setTitle",
  "setResizable",
  "setDecorations",
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
    getBounds: (window) => client.getBounds(window),
    setBounds: (window, bounds) => client.setBounds(window, bounds),
    center: (window) => client.center(window),
    setTitle: (window, title) => client.setTitle(window, title),
    setResizable: (window, resizable) => client.setResizable(window, resizable),
    setDecorations: (window, decorations) => client.setDecorations(window, decorations),
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

  return {
    "Window.create": (input: WindowCreateInput) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const created = yield* host.create(toHostWindowCreateInput(input))
        knownWindowIds.add(created.windowId)
        const ownerScope = windowScope(created.windowId)
        yield* registry.declareScope(ownerScope, "app").pipe(Effect.orDie)
        const handle = yield* registry
          .register({
            kind: "window",
            id: makeResourceId(created.windowId),
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
        yield* host.destroy(window.id)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowClosed(window.id)
        }
        yield* registry.closeScope(window.ownerScope)
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

const toHostWindowBoundsInput = (bounds: WindowBoundsType): HostWindowBoundsInput =>
  Object.freeze({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  })

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

function windowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Window", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}
