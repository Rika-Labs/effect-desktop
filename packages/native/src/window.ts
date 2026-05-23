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
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError,
  WINDOW_EVENT_METHOD
} from "@orika/bridge"
import {
  P,
  PermissionRegistry,
  ResourceRegistry,
  makeResourceId,
  type DesktopRpcClient,
  type ResourceRegistryApi
} from "@orika/core"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { NativeSurface } from "./native-surface.js"
import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import { type AppEventRouterApi, windowScope } from "./app-events.js"
export * from "./contracts/window.js"
import {
  WindowCreateInput,
  WindowBounds,
  WindowBoundsEvent,
  WindowBoundsInput,
  WindowDisplayBoundsInput,
  WindowAlwaysOnTopInput,
  type WindowAttentionType,
  type WindowBoundsType,
  WindowChildrenResult,
  type WindowCreateOptions,
  WindowDecorationsInput,
  WindowDisplayInput,
  WindowEvent,
  WindowFullscreenInput,
  type WindowHandle,
  WindowHandleInput,
  WindowListResult,
  WindowLookupInput,
  WindowParentResult,
  WindowProgressInput,
  type WindowProgressOptions,
  WindowRegistryEvent,
  WindowResizableInput,
  WindowRequestAttentionInput,
  WindowShadowInput,
  WindowResource,
  WindowSimpleFullscreenInput,
  WindowSkipTaskbarInput,
  WindowState,
  WindowStateEvent,
  WindowSubscribeEventsResult,
  WindowTitleBarStyleInput,
  type WindowTitleBarStyleValue,
  WindowTitleBarTransparentInput,
  WindowTitleInput,
  WindowTransparentInput,
  WindowTrafficLightsInput,
  WindowVibrancyInput,
  type WindowVibrancyMaterialInput
} from "./contracts/window.js"

const WindowTrafficLightsMacosOnlyReason = "traffic-light-placement-macos-only"

const WindowTrafficLightsSupport = NativeSurface.support.partial(
  WindowTrafficLightsMacosOnlyReason,
  {
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: WindowTrafficLightsMacosOnlyReason },
      { platform: "linux", status: "unsupported", reason: WindowTrafficLightsMacosOnlyReason }
    ]
  }
) satisfies RpcSupportMetadata
const WindowSkipTaskbarMacosUnsupportedReason = "skip-taskbar-macos-unsupported"

const WindowSkipTaskbarSupport = NativeSurface.support.partial(
  WindowSkipTaskbarMacosUnsupportedReason,
  {
    platforms: [
      { platform: "macos", status: "unsupported", reason: WindowSkipTaskbarMacosUnsupportedReason },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "supported" }
    ]
  }
) satisfies RpcSupportMetadata
const WindowVibrancyMacosOnlyReason = "vibrancy-macos-only"

const WindowVibrancySupport = NativeSurface.support.partial(WindowVibrancyMacosOnlyReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: WindowVibrancyMacosOnlyReason },
    { platform: "linux", status: "unsupported", reason: WindowVibrancyMacosOnlyReason }
  ]
}) satisfies RpcSupportMetadata
const WindowShadowMacosOnlyReason = "shadow-macos-only"

const WindowShadowSupport = NativeSurface.support.partial(WindowShadowMacosOnlyReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: WindowShadowMacosOnlyReason },
    { platform: "linux", status: "unsupported", reason: WindowShadowMacosOnlyReason }
  ]
}) satisfies RpcSupportMetadata
const WindowTitleBarStyleMacosOnlyReason = "titlebar-style-macos-only"

const WindowTitleBarStyleSupport = NativeSurface.support.partial(
  WindowTitleBarStyleMacosOnlyReason,
  {
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: WindowTitleBarStyleMacosOnlyReason },
      { platform: "linux", status: "unsupported", reason: WindowTitleBarStyleMacosOnlyReason }
    ]
  }
) satisfies RpcSupportMetadata
const WindowTitleBarTransparentMacosOnlyReason = "titlebar-transparency-macos-only"

const WindowTitleBarTransparentSupport = NativeSurface.support.partial(
  WindowTitleBarTransparentMacosOnlyReason,
  {
    platforms: [
      { platform: "macos", status: "supported" },
      {
        platform: "windows",
        status: "unsupported",
        reason: WindowTitleBarTransparentMacosOnlyReason
      },
      { platform: "linux", status: "unsupported", reason: WindowTitleBarTransparentMacosOnlyReason }
    ]
  }
) satisfies RpcSupportMetadata
const WindowTransparentMacosOnlyReason = "window-transparency-macos-only"

const WindowTransparentSupport = NativeSurface.support.partial(WindowTransparentMacosOnlyReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: WindowTransparentMacosOnlyReason },
    { platform: "linux", status: "unsupported", reason: WindowTransparentMacosOnlyReason }
  ]
}) satisfies RpcSupportMetadata
const WindowSimpleFullscreenMacosOnlyReason = "simple-fullscreen-macos-only"

const WindowSimpleFullscreenSupport = NativeSurface.support.partial(
  WindowSimpleFullscreenMacosOnlyReason,
  {
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: WindowSimpleFullscreenMacosOnlyReason },
      { platform: "linux", status: "unsupported", reason: WindowSimpleFullscreenMacosOnlyReason }
    ]
  }
) satisfies RpcSupportMetadata
const WindowStateSupport = NativeSurface.support.supported satisfies RpcSupportMetadata
const StrictParseOptions = { onExcessProperty: "error" } as const
export type WindowError = HostProtocolError

export const WindowCreate = NativeSurface.rpc("Window", "create", {
  payload: WindowCreateInput,
  success: WindowResource,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["create"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowClose = NativeSurface.rpc("Window", "close", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["close"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowDestroy = NativeSurface.rpc("Window", "destroy", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["destroy"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowShow = NativeSurface.rpc("Window", "show", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["show"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowHide = NativeSurface.rpc("Window", "hide", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["hide"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowFocus = NativeSurface.rpc("Window", "focus", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["focus"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowGetCurrent = NativeSurface.rpc("Window", "getCurrent", {
  payload: Schema.Void,
  success: WindowResource,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["getCurrent"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowGetById = NativeSurface.rpc("Window", "getById", {
  payload: WindowLookupInput,
  success: WindowResource,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["getById"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowList = NativeSurface.rpc("Window", "list", {
  payload: Schema.Void,
  success: WindowListResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["list"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowGetParent = NativeSurface.rpc("Window", "getParent", {
  payload: WindowHandleInput,
  success: WindowParentResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["getParent"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowGetChildren = NativeSurface.rpc("Window", "getChildren", {
  payload: WindowHandleInput,
  success: WindowChildrenResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["getChildren"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSubscribeEvents = NativeSurface.rpc("Window", "subscribeEvents", {
  payload: Schema.Void,
  success: WindowSubscribeEventsResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["subscribeEvents"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowGetBounds = NativeSurface.rpc("Window", "getBounds", {
  payload: WindowHandleInput,
  success: WindowBounds,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["getBounds"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetBounds = NativeSurface.rpc("Window", "setBounds", {
  payload: WindowBoundsInput,
  success: WindowBounds,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setBounds"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetBoundsOnDisplay = NativeSurface.rpc("Window", "setBoundsOnDisplay", {
  payload: WindowDisplayBoundsInput,
  success: WindowBounds,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setBoundsOnDisplay"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowCenter = NativeSurface.rpc("Window", "center", {
  payload: WindowHandleInput,
  success: WindowBounds,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["center"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowCenterOnDisplay = NativeSurface.rpc("Window", "centerOnDisplay", {
  payload: WindowDisplayInput,
  success: WindowBounds,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["centerOnDisplay"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetTitle = NativeSurface.rpc("Window", "setTitle", {
  payload: WindowTitleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setTitle"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetResizable = NativeSurface.rpc("Window", "setResizable", {
  payload: WindowResizableInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setResizable"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetDecorations = NativeSurface.rpc("Window", "setDecorations", {
  payload: WindowDecorationsInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setDecorations"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetTrafficLights = NativeSurface.rpc("Window", "setTrafficLights", {
  payload: WindowTrafficLightsInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setTrafficLights"] })
  ),
  endpoint: "mutation",
  support: WindowTrafficLightsSupport
})
export const WindowSetVibrancy = NativeSurface.rpc("Window", "setVibrancy", {
  payload: WindowVibrancyInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setVibrancy"] })
  ),
  endpoint: "mutation",
  support: WindowVibrancySupport
})
export const WindowClearVibrancy = NativeSurface.rpc("Window", "clearVibrancy", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["clearVibrancy"] })
  ),
  endpoint: "mutation",
  support: WindowVibrancySupport
})
export const WindowSetShadow = NativeSurface.rpc("Window", "setShadow", {
  payload: WindowShadowInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setShadow"] })
  ),
  endpoint: "mutation",
  support: WindowShadowSupport
})
export const WindowSetTitleBarStyle = NativeSurface.rpc("Window", "setTitleBarStyle", {
  payload: WindowTitleBarStyleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setTitleBarStyle"] })
  ),
  endpoint: "mutation",
  support: WindowTitleBarStyleSupport
})
export const WindowSetTitleBarTransparent = NativeSurface.rpc("Window", "setTitleBarTransparent", {
  payload: WindowTitleBarTransparentInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setTitleBarTransparent"] })
  ),
  endpoint: "mutation",
  support: WindowTitleBarTransparentSupport
})
export const WindowSetTransparent = NativeSurface.rpc("Window", "setTransparent", {
  payload: WindowTransparentInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setTransparent"] })
  ),
  endpoint: "mutation",
  support: WindowTransparentSupport
})
export const WindowSetAlwaysOnTop = NativeSurface.rpc("Window", "setAlwaysOnTop", {
  payload: WindowAlwaysOnTopInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setAlwaysOnTop"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowSetSkipTaskbar = NativeSurface.rpc("Window", "setSkipTaskbar", {
  payload: WindowSkipTaskbarInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setSkipTaskbar"] })
  ),
  endpoint: "mutation",
  support: WindowSkipTaskbarSupport
})
export const WindowSetProgress = NativeSurface.rpc("Window", "setProgress", {
  payload: WindowProgressInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setProgress"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowRequestAttention = NativeSurface.rpc("Window", "requestAttention", {
  payload: WindowRequestAttentionInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["requestAttention"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowCancelAttention = NativeSurface.rpc("Window", "cancelAttention", {
  payload: WindowHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["cancelAttention"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const WindowMinimize = NativeSurface.rpc("Window", "minimize", {
  payload: WindowHandleInput,
  success: WindowState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["minimize"] })
  ),
  endpoint: "mutation",
  support: WindowStateSupport
})
export const WindowMaximize = NativeSurface.rpc("Window", "maximize", {
  payload: WindowHandleInput,
  success: WindowState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["maximize"] })
  ),
  endpoint: "mutation",
  support: WindowStateSupport
})
export const WindowRestore = NativeSurface.rpc("Window", "restore", {
  payload: WindowHandleInput,
  success: WindowState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["restore"] })
  ),
  endpoint: "mutation",
  support: WindowStateSupport
})
export const WindowSetFullscreen = NativeSurface.rpc("Window", "setFullscreen", {
  payload: WindowFullscreenInput,
  success: WindowState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setFullscreen"] })
  ),
  endpoint: "mutation",
  support: WindowStateSupport
})
export const WindowSetSimpleFullscreen = NativeSurface.rpc("Window", "setSimpleFullscreen", {
  payload: WindowSimpleFullscreenInput,
  success: WindowState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["setSimpleFullscreen"] })
  ),
  endpoint: "mutation",
  support: WindowSimpleFullscreenSupport
})
export const WindowGetState = NativeSurface.rpc("Window", "getState", {
  payload: WindowHandleInput,
  success: WindowState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Window", methods: ["getState"] })
  ),
  endpoint: "mutation",
  support: WindowStateSupport
})

const makeWindowRpcGroup = () =>
  RpcGroup.make(
    WindowCreate,
    WindowClose,
    WindowDestroy,
    WindowShow,
    WindowHide,
    WindowFocus,
    WindowGetCurrent,
    WindowGetById,
    WindowList,
    WindowGetParent,
    WindowGetChildren,
    WindowSubscribeEvents,
    WindowGetBounds,
    WindowSetBounds,
    WindowSetBoundsOnDisplay,
    WindowCenter,
    WindowCenterOnDisplay,
    WindowSetTitle,
    WindowSetResizable,
    WindowSetDecorations,
    WindowSetTrafficLights,
    WindowSetVibrancy,
    WindowClearVibrancy,
    WindowSetShadow,
    WindowSetTitleBarStyle,
    WindowSetTitleBarTransparent,
    WindowSetTransparent,
    WindowSetAlwaysOnTop,
    WindowSetSkipTaskbar,
    WindowSetProgress,
    WindowRequestAttention,
    WindowCancelAttention,
    WindowMinimize,
    WindowMaximize,
    WindowRestore,
    WindowSetFullscreen,
    WindowSetSimpleFullscreen,
    WindowGetState
  )

const WindowRpcGroup = makeWindowRpcGroup()

type WindowRpcUnion = RpcGroup.Rpcs<typeof WindowRpcGroup>

export const WindowRpcs: RpcGroup.RpcGroup<WindowRpcUnion> = WindowRpcGroup

export const WindowRpcEvents = Object.freeze({
  Event: { payload: WindowEvent }
})

export type WindowRpcEvents = typeof WindowRpcEvents

export type WindowSupportedRpc = WindowRpcUnion

export const WindowSupportedRpcs: RpcGroup.RpcGroup<WindowSupportedRpc> = WindowRpcs

export type WindowBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

type WindowRpcClient = DesktopRpcClient<WindowRpcUnion>

export const WindowMethodNames = Object.freeze([
  "create",
  "close",
  "destroy",
  "show",
  "hide",
  "focus",
  "getCurrent",
  "getById",
  "list",
  "getParent",
  "getChildren",
  "getBounds",
  "setBounds",
  "setBoundsOnDisplay",
  "center",
  "centerOnDisplay",
  "setTitle",
  "setResizable",
  "setDecorations",
  "setTrafficLights",
  "setVibrancy",
  "clearVibrancy",
  "setShadow",
  "setTitleBarStyle",
  "setTitleBarTransparent",
  "setTransparent",
  "setAlwaysOnTop",
  "setSkipTaskbar",
  "setProgress",
  "requestAttention",
  "cancelAttention",
  "minimize",
  "maximize",
  "restore",
  "setFullscreen",
  "setSimpleFullscreen",
  "getState"
] as const)

const WindowCapabilityMethodNames = Object.freeze([
  ...WindowMethodNames,
  "subscribeEvents"
] as const)

export interface WindowClientApi {
  readonly create: (input: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly destroy: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly show: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly hide: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly focus: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly getCurrent: () => Effect.Effect<WindowHandle, WindowError, never>
  readonly getById: (windowId: string) => Effect.Effect<WindowHandle, WindowError, never>
  readonly list: () => Effect.Effect<readonly WindowHandle[], WindowError, never>
  readonly getParent: (
    window: WindowHandle
  ) => Effect.Effect<WindowHandle | undefined, WindowError, never>
  readonly getChildren: (
    window: WindowHandle
  ) => Effect.Effect<readonly WindowHandle[], WindowError, never>
  readonly getBounds: (window: WindowHandle) => Effect.Effect<WindowBounds, WindowError, never>
  readonly setBounds: (
    window: WindowHandle,
    bounds: WindowBoundsType
  ) => Effect.Effect<WindowBounds, WindowError, never>
  readonly setBoundsOnDisplay: (
    window: WindowHandle,
    displayId: string,
    bounds: WindowBoundsType
  ) => Effect.Effect<WindowBounds, WindowError, never>
  readonly center: (window: WindowHandle) => Effect.Effect<WindowBounds, WindowError, never>
  readonly centerOnDisplay: (
    window: WindowHandle,
    displayId: string
  ) => Effect.Effect<WindowBounds, WindowError, never>
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
  readonly setTrafficLights: (
    window: WindowHandle,
    trafficLights: { readonly x: number; readonly y: number }
  ) => Effect.Effect<void, WindowError, never>
  readonly setVibrancy: (
    window: WindowHandle,
    material: WindowVibrancyMaterialInput
  ) => Effect.Effect<void, WindowError, never>
  readonly clearVibrancy: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
  readonly setShadow: (
    window: WindowHandle,
    hasShadow: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setTitleBarStyle: (
    window: WindowHandle,
    titleBarStyle: WindowTitleBarStyleValue
  ) => Effect.Effect<void, WindowError, never>
  readonly setTitleBarTransparent: (
    window: WindowHandle,
    titleBarTransparent: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setTransparent: (
    window: WindowHandle,
    transparent: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setAlwaysOnTop: (
    window: WindowHandle,
    alwaysOnTop: boolean
  ) => Effect.Effect<void, WindowError, never>
  readonly setSkipTaskbar: (
    window: WindowHandle,
    skipTaskbar: boolean
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
  readonly minimize: (window: WindowHandle) => Effect.Effect<WindowState, WindowError, never>
  readonly maximize: (window: WindowHandle) => Effect.Effect<WindowState, WindowError, never>
  readonly restore: (window: WindowHandle) => Effect.Effect<WindowState, WindowError, never>
  readonly setFullscreen: (
    window: WindowHandle,
    fullscreen: boolean
  ) => Effect.Effect<WindowState, WindowError, never>
  readonly setSimpleFullscreen: (
    window: WindowHandle,
    simpleFullscreen: boolean
  ) => Effect.Effect<WindowState, WindowError, never>
  readonly getState: (window: WindowHandle) => Effect.Effect<WindowState, WindowError, never>
  readonly events: () => Stream.Stream<WindowEvent, WindowError, never>
}

export class WindowClient extends Context.Service<WindowClient, WindowClientApi>()(
  "@orika/native/WindowClient"
) {}

export interface WindowServiceApi extends Omit<WindowClientApi, "create"> {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
}

export class Window extends Context.Service<Window, WindowServiceApi>()("@orika/native/Window") {
  static readonly layer = Layer.effect(Window)(
    Effect.gen(function* () {
      const client = yield* WindowClient
      return Window.of(makeWindowService(client))
    })
  )
}

export const WindowLive = Window.layer

export const makeWindowBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: WindowBridgeClientOptions = {}
): Layer.Layer<WindowClient, never, ResourceRegistry> =>
  Layer.effect(
    WindowClient,
    Effect.gen(function* () {
      const client = yield* WindowClient
      const registry = yield* ResourceRegistry
      return WindowClient.of(
        Object.freeze({
          ...client,
          events: () => reconcileWindowEventStream(client.events(), registry)
        } satisfies WindowClientApi)
      )
    })
  ).pipe(Layer.provide(WindowSurface.bridgeClientLayer(exchange, options)))

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
  "Window.destroy": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.destroy(input.window)
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
  "Window.getParent": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      const parent = yield* window.getParent(input.window)
      return new WindowParentResult(parent === undefined ? {} : { parent })
    }),
  "Window.getChildren": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return new WindowChildrenResult({ children: yield* window.getChildren(input.window) })
    }),
  "Window.subscribeEvents": () =>
    Effect.succeed(new WindowSubscribeEventsResult({ subscribed: true })),
  "Window.getBounds": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.getBounds(input.window)
    }),
  "Window.setBounds": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.setBounds(input.window, input.bounds)
    }),
  "Window.setBoundsOnDisplay": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.setBoundsOnDisplay(input.window, input.displayId, input.bounds)
    }),
  "Window.center": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.center(input.window)
    }),
  "Window.centerOnDisplay": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.centerOnDisplay(input.window, input.displayId)
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
  "Window.setTrafficLights": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setTrafficLights(input.window, input.trafficLights)
    }),
  "Window.setVibrancy": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setVibrancy(input.window, input.material)
    }),
  "Window.clearVibrancy": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.clearVibrancy(input.window)
    }),
  "Window.setShadow": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setShadow(input.window, input.hasShadow)
    }),
  "Window.setTitleBarStyle": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setTitleBarStyle(input.window, input.titleBarStyle)
    }),
  "Window.setTitleBarTransparent": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setTitleBarTransparent(input.window, input.titleBarTransparent)
    }),
  "Window.setTransparent": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setTransparent(input.window, input.transparent)
    }),
  "Window.setAlwaysOnTop": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setAlwaysOnTop(input.window, input.alwaysOnTop)
    }),
  "Window.setSkipTaskbar": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.setSkipTaskbar(input.window, input.skipTaskbar)
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
      return yield* window.minimize(input.window)
    }),
  "Window.maximize": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.maximize(input.window)
    }),
  "Window.restore": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.restore(input.window)
    }),
  "Window.setFullscreen": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.setFullscreen(input.window, input.fullscreen)
    }),
  "Window.setSimpleFullscreen": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.setSimpleFullscreen(input.window, input.simpleFullscreen)
    }),
  "Window.getState": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.getState(input.window)
    })
})

export const WindowSurface = NativeSurface.make("Window", WindowRpcGroup, {
  service: WindowClient,
  capabilities: WindowCapabilityMethodNames,
  handlers: WindowHandlersLive,
  client: (client) => windowClientFromRpcClient(client),
  bridgeClient: (client, exchange) => windowClientFromRpcClient(client, exchange)
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
    destroy: (window) => client.destroy(window),
    show: (window) => client.show(window),
    hide: (window) => client.hide(window),
    focus: (window) => client.focus(window),
    getCurrent: () => client.getCurrent(),
    getById: (windowId) => client.getById(windowId),
    list: () => client.list(),
    getParent: (window) => client.getParent(window),
    getChildren: (window) => client.getChildren(window),
    getBounds: (window) => client.getBounds(window),
    setBounds: (window, bounds) => client.setBounds(window, bounds),
    setBoundsOnDisplay: (window, displayId, bounds) =>
      client.setBoundsOnDisplay(window, displayId, bounds),
    center: (window) => client.center(window),
    centerOnDisplay: (window, displayId) => client.centerOnDisplay(window, displayId),
    setTitle: (window, title) => client.setTitle(window, title),
    setResizable: (window, resizable) => client.setResizable(window, resizable),
    setDecorations: (window, decorations) => client.setDecorations(window, decorations),
    setTrafficLights: (window, trafficLights) => client.setTrafficLights(window, trafficLights),
    setVibrancy: (window, material) => client.setVibrancy(window, material),
    clearVibrancy: (window) => client.clearVibrancy(window),
    setShadow: (window, hasShadow) => client.setShadow(window, hasShadow),
    setTitleBarStyle: (window, titleBarStyle) => client.setTitleBarStyle(window, titleBarStyle),
    setTitleBarTransparent: (window, titleBarTransparent) =>
      client.setTitleBarTransparent(window, titleBarTransparent),
    setTransparent: (window, transparent) => client.setTransparent(window, transparent),
    setAlwaysOnTop: (window, alwaysOnTop) => client.setAlwaysOnTop(window, alwaysOnTop),
    setSkipTaskbar: (window, skipTaskbar) => client.setSkipTaskbar(window, skipTaskbar),
    setProgress: (window, input) => client.setProgress(window, input),
    requestAttention: (window, requestType) => client.requestAttention(window, requestType),
    cancelAttention: (window) => client.cancelAttention(window),
    minimize: (window) => client.minimize(window),
    maximize: (window) => client.maximize(window),
    restore: (window) => client.restore(window),
    setFullscreen: (window, fullscreen) => client.setFullscreen(window, fullscreen),
    setSimpleFullscreen: (window, simpleFullscreen) =>
      client.setSimpleFullscreen(window, simpleFullscreen),
    getState: (window) => client.getState(window),
    events: () => client.events()
  }

  return Object.freeze(service)
}

function windowClientFromRpcClient(
  client: WindowRpcClient,
  exchange?: BridgeClientExchange
): WindowClientApi {
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
    close: (window) => runWindowHandleRpc(client, "Window.close", window),
    destroy: (window) => runWindowHandleRpc(client, "Window.destroy", window),
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
    getParent: (window) =>
      Effect.gen(function* () {
        const decodedInput = yield* decodeWindowHandleInput(window, "Window.getParent")
        const result = yield* runWindowRpc(
          client["Window.getParent"](decodedInput),
          "Window.getParent"
        )
        const decoded = yield* Schema.decodeUnknownEffect(WindowParentResult)(
          result,
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidOutputError("Window.getParent", formatUnknownError(error))
          )
        )
        return decoded.parent
      }),
    getChildren: (window) =>
      Effect.gen(function* () {
        const decodedInput = yield* decodeWindowHandleInput(window, "Window.getChildren")
        const result = yield* runWindowRpc(
          client["Window.getChildren"](decodedInput),
          "Window.getChildren"
        )
        const decoded = yield* Schema.decodeUnknownEffect(WindowChildrenResult)(
          result,
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidOutputError("Window.getChildren", formatUnknownError(error))
          )
        )
        return decoded.children
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
        const observed = yield* runWindowRpc(
          client["Window.setBounds"](decoded),
          "Window.setBounds"
        )
        return yield* decodeWindowBounds(observed, "Window.setBounds")
      }),
    setBoundsOnDisplay: (window, displayId, bounds) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowDisplayBoundsInput(
          window,
          displayId,
          bounds,
          "Window.setBoundsOnDisplay"
        )
        const observed = yield* runWindowRpc(
          client["Window.setBoundsOnDisplay"](decoded),
          "Window.setBoundsOnDisplay"
        )
        return yield* decodeWindowBounds(observed, "Window.setBoundsOnDisplay")
      }),
    center: (window) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowHandleInput(window, "Window.center")
        const observed = yield* runWindowRpc(client["Window.center"](decoded), "Window.center")
        return yield* decodeWindowBounds(observed, "Window.center")
      }),
    centerOnDisplay: (window, displayId) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowDisplayInput(window, displayId, "Window.centerOnDisplay")
        const observed = yield* runWindowRpc(
          client["Window.centerOnDisplay"](decoded),
          "Window.centerOnDisplay"
        )
        return yield* decodeWindowBounds(observed, "Window.centerOnDisplay")
      }),
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
    setTrafficLights: (window, trafficLights) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowTrafficLightsInput(
          window,
          trafficLights,
          "Window.setTrafficLights"
        )
        yield* runWindowRpc(client["Window.setTrafficLights"](decoded), "Window.setTrafficLights")
      }),
    setVibrancy: (window, material) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowVibrancyInput(window, material, "Window.setVibrancy")
        yield* runWindowRpc(client["Window.setVibrancy"](decoded), "Window.setVibrancy")
      }),
    clearVibrancy: (window) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowHandleInput(window, "Window.clearVibrancy")
        yield* runWindowRpc(client["Window.clearVibrancy"](decoded), "Window.clearVibrancy")
      }),
    setShadow: (window, hasShadow) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowShadowInput(window, hasShadow, "Window.setShadow")
        yield* runWindowRpc(client["Window.setShadow"](decoded), "Window.setShadow")
      }),
    setTitleBarStyle: (window, titleBarStyle) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowTitleBarStyleInput(
          window,
          titleBarStyle,
          "Window.setTitleBarStyle"
        )
        yield* runWindowRpc(client["Window.setTitleBarStyle"](decoded), "Window.setTitleBarStyle")
      }),
    setTitleBarTransparent: (window, titleBarTransparent) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowTitleBarTransparentInput(
          window,
          titleBarTransparent,
          "Window.setTitleBarTransparent"
        )
        yield* runWindowRpc(
          client["Window.setTitleBarTransparent"](decoded),
          "Window.setTitleBarTransparent"
        )
      }),
    setTransparent: (window, transparent) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowTransparentInput(
          window,
          transparent,
          "Window.setTransparent"
        )
        yield* runWindowRpc(client["Window.setTransparent"](decoded), "Window.setTransparent")
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
    setSkipTaskbar: (window, skipTaskbar) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowSkipTaskbarInput(
          window,
          skipTaskbar,
          "Window.setSkipTaskbar"
        )
        yield* runWindowRpc(client["Window.setSkipTaskbar"](decoded), "Window.setSkipTaskbar")
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
    minimize: (window) => runWindowStateHandleRpc(client, "Window.minimize", window),
    maximize: (window) => runWindowStateHandleRpc(client, "Window.maximize", window),
    restore: (window) => runWindowStateHandleRpc(client, "Window.restore", window),
    setFullscreen: (window, fullscreen) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowFullscreenInput(
          window,
          fullscreen,
          "Window.setFullscreen"
        )
        const state = yield* runWindowRpc(
          client["Window.setFullscreen"](decoded),
          "Window.setFullscreen"
        )
        return yield* decodeWindowState(state, "Window.setFullscreen")
      }),
    setSimpleFullscreen: (window, simpleFullscreen) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowSimpleFullscreenInput(
          window,
          simpleFullscreen,
          "Window.setSimpleFullscreen"
        )
        const state = yield* runWindowRpc(
          client["Window.setSimpleFullscreen"](decoded),
          "Window.setSimpleFullscreen"
        )
        return yield* decodeWindowState(state, "Window.setSimpleFullscreen")
      }),
    getState: (window) =>
      Effect.gen(function* () {
        const decoded = yield* decodeWindowHandleInput(window, "Window.getState")
        const state = yield* runWindowRpc(client["Window.getState"](decoded), "Window.getState")
        return yield* decodeWindowState(state, "Window.getState")
      }),
    events: () =>
      Stream.unwrap(
        runWindowRpc(client["Window.subscribeEvents"](undefined), "Window.subscribeEvents").pipe(
          Effect.map(() => subscribeNativeEvent(exchange, WINDOW_EVENT_METHOD, WindowEvent))
        )
      )
  } satisfies WindowClientApi)
}

const runWindowHandleRpc = (
  client: WindowRpcClient,
  operation:
    | "Window.show"
    | "Window.close"
    | "Window.destroy"
    | "Window.hide"
    | "Window.focus"
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

const runWindowStateHandleRpc = (
  client: WindowRpcClient,
  operation: "Window.minimize" | "Window.maximize" | "Window.restore",
  window: WindowHandle
): Effect.Effect<WindowState, WindowError, never> =>
  Effect.gen(function* () {
    const decoded = yield* decodeWindowHandleInput(window, operation)
    const state = yield* runWindowRpc(client[operation](decoded), operation)
    return yield* decodeWindowState(state, operation)
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

const decodeWindowDisplayBoundsInput = (
  window: WindowHandle,
  displayId: string,
  bounds: WindowBoundsType,
  operation: string
): Effect.Effect<WindowDisplayBoundsInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowDisplayBoundsInput)(
    { window, displayId, bounds },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowDisplayInput = (
  window: WindowHandle,
  displayId: string,
  operation: string
): Effect.Effect<WindowDisplayInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowDisplayInput)({ window, displayId }, StrictParseOptions).pipe(
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

const decodeWindowTrafficLightsInput = (
  window: WindowHandle,
  trafficLights: { readonly x: number; readonly y: number },
  operation: string
): Effect.Effect<WindowTrafficLightsInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowTrafficLightsInput)(
    { window, trafficLights },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowVibrancyInput = (
  window: WindowHandle,
  material: WindowVibrancyMaterialInput,
  operation: string
): Effect.Effect<WindowVibrancyInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowVibrancyInput)({ window, material }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowShadowInput = (
  window: WindowHandle,
  hasShadow: boolean,
  operation: string
): Effect.Effect<WindowShadowInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowShadowInput)({ window, hasShadow }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowTitleBarStyleInput = (
  window: WindowHandle,
  titleBarStyle: WindowTitleBarStyleValue,
  operation: string
): Effect.Effect<WindowTitleBarStyleInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowTitleBarStyleInput)(
    { window, titleBarStyle },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowTitleBarTransparentInput = (
  window: WindowHandle,
  titleBarTransparent: boolean,
  operation: string
): Effect.Effect<WindowTitleBarTransparentInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowTitleBarTransparentInput)(
    { window, titleBarTransparent },
    StrictParseOptions
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowTransparentInput = (
  window: WindowHandle,
  transparent: boolean,
  operation: string
): Effect.Effect<WindowTransparentInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowTransparentInput)(
    { window, transparent },
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

const decodeWindowSkipTaskbarInput = (
  window: WindowHandle,
  skipTaskbar: boolean,
  operation: string
): Effect.Effect<WindowSkipTaskbarInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowSkipTaskbarInput)(
    { window, skipTaskbar },
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

const decodeWindowSimpleFullscreenInput = (
  window: WindowHandle,
  simpleFullscreen: boolean,
  operation: string
): Effect.Effect<WindowSimpleFullscreenInput, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowSimpleFullscreenInput)(
    { window, simpleFullscreen },
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

const reconcileWindowEventStream = (
  events: Stream.Stream<WindowEvent, WindowError, never>,
  registry: ResourceRegistryApi
): Stream.Stream<WindowEvent, WindowError, never> =>
  events.pipe(Stream.mapEffect((event) => reconcileWindowEvent(event, registry)))

const reconcileWindowEvent = (
  event: WindowEvent,
  registry: ResourceRegistryApi
): Effect.Effect<WindowEvent, WindowError, never> =>
  Effect.gen(function* () {
    yield* validateWindowEventHandle(event)
    if (event.type === "window-state-event") {
      const window = yield* lookupWindowHandleForEvent(event.windowId, registry)
      return Option.isNone(window)
        ? stateEventWithoutWindow(event)
        : stateEventWithWindow(event, window.value)
    }

    if (event.type === "window-bounds-event") {
      const window = yield* lookupWindowHandleForEvent(event.windowId, registry)
      return Option.isNone(window)
        ? boundsEventWithoutWindow(event)
        : boundsEventWithWindow(event, window.value)
    }

    const terminal = event.phase === "closed"
    if (event.terminal !== terminal) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          WINDOW_EVENT_METHOD,
          `window event terminal=${event.terminal} does not match phase=${event.phase}`
        )
      )
    }

    if (event.phase === "opened") {
      const window = yield* ensureWindowHandleForEvent(event, registry)
      return eventWithWindow(event, window)
    }

    if (
      event.phase === "focused" ||
      event.phase === "shown" ||
      event.phase === "hidden" ||
      event.phase === "closeRequested"
    ) {
      const window = yield* lookupWindowHandleForEvent(event.windowId, registry)
      return Option.isNone(window)
        ? eventWithoutWindow(event)
        : eventWithWindow(event, window.value)
    }

    const window = yield* lookupWindowHandleForEvent(event.windowId, registry)
    if (Option.isNone(window)) {
      return eventWithoutWindow(event)
    }
    yield* registry.closeScope(window.value.ownerScope)
    return eventWithWindow(event, window.value)
  })

const ensureWindowHandleForEvent = (
  event: WindowRegistryEvent,
  registry: ResourceRegistryApi
): Effect.Effect<WindowHandle, WindowError, never> =>
  Effect.gen(function* () {
    const existing = yield* lookupWindowHandleForEvent(event.windowId, registry)
    if (Option.isSome(existing)) {
      return existing.value
    }

    const ownerScope = windowScope(event.windowId)
    yield* registry
      .declareScope(ownerScope, "app")
      .pipe(
        Effect.mapError((error) =>
          makeHostProtocolInvalidOutputError(WINDOW_EVENT_METHOD, formatUnknownError(error))
        )
      )
    const handle = yield* registry
      .register({
        kind: "window",
        id: makeResourceId(event.windowId),
        ownerScope,
        state: "open"
      })
      .pipe(
        Effect.mapError((error) =>
          makeHostProtocolInvalidOutputError(WINDOW_EVENT_METHOD, formatUnknownError(error))
        )
      )
    return toWindowHandle(handle)
  })

const validateWindowEventHandle = (event: WindowEvent): Effect.Effect<void, WindowError, never> => {
  if (event.window === undefined) {
    return Effect.void
  }
  const expectedOwnerScope = windowScope(event.windowId)
  if (event.window.id !== event.windowId || event.window.ownerScope !== expectedOwnerScope) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        WINDOW_EVENT_METHOD,
        `window event handle must match Window:${event.windowId}`
      )
    )
  }

  return Effect.void
}

const lookupWindowHandleForEvent = (
  windowId: string,
  registry: ResourceRegistryApi
): Effect.Effect<Option.Option<WindowHandle>, WindowError, never> =>
  Effect.gen(function* () {
    const entry = yield* registry.get(makeResourceId(windowId))
    if (Option.isNone(entry)) {
      return Option.none()
    }
    const window = yield* decodeWindowHandle(entry.value.handle, WINDOW_EVENT_METHOD)
    return Option.some(window)
  })

const eventWithWindow = (event: WindowRegistryEvent, window: WindowHandle): WindowRegistryEvent =>
  new WindowRegistryEvent({
    type: event.type,
    phase: event.phase,
    windowId: event.windowId,
    window,
    terminal: event.terminal
  })

const eventWithoutWindow = (event: WindowRegistryEvent): WindowRegistryEvent =>
  new WindowRegistryEvent({
    type: event.type,
    phase: event.phase,
    windowId: event.windowId,
    terminal: event.terminal
  })

const stateEventWithWindow = (event: WindowStateEvent, window: WindowHandle): WindowStateEvent =>
  new WindowStateEvent({
    type: event.type,
    windowId: event.windowId,
    window,
    state: event.state
  })

const stateEventWithoutWindow = (event: WindowStateEvent): WindowStateEvent =>
  new WindowStateEvent({
    type: event.type,
    windowId: event.windowId,
    state: event.state
  })

const boundsEventWithWindow = (event: WindowBoundsEvent, window: WindowHandle): WindowBoundsEvent =>
  new WindowBoundsEvent({
    type: event.type,
    windowId: event.windowId,
    window,
    bounds: event.bounds
  })

const boundsEventWithoutWindow = (event: WindowBoundsEvent): WindowBoundsEvent =>
  new WindowBoundsEvent({
    type: event.type,
    windowId: event.windowId,
    bounds: event.bounds
  })

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
  const destroyKnownWindow = (
    input: WindowHandleInput,
    operation: "Window.close" | "Window.destroy"
  ) =>
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
          Effect.mapError((error) =>
            makeStaleHandleError(operation, window, error.actualGeneration)
          )
        )
      yield* closeKnownWindowTree(window, operation, host, registry, {
        ...(options.appEventRouter === undefined ? {} : { appEventRouter: options.appEventRouter }),
        childWindowIdsByParentId,
        parentWindowIdByChildId,
        windowHandleById
      })
    })

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
    "Window.close": (input: WindowHandleInput) => destroyKnownWindow(input, "Window.close"),
    "Window.destroy": (input: WindowHandleInput) => destroyKnownWindow(input, "Window.destroy"),
    "Window.show": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.show")
        yield* host.show(window.id)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter
            .windowShown(window.id)
            .pipe(
              Effect.mapError((error) =>
                makeHostProtocolInvalidStateError(error.windowId, "shown", "Window.show")
              )
            )
        }
      }),
    "Window.hide": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.hide")
        yield* host.hide(window.id)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter
            .windowHidden(window.id)
            .pipe(
              Effect.mapError((error) =>
                makeHostProtocolInvalidStateError(error.windowId, "hidden", "Window.hide")
              )
            )
        }
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
    "Window.getParent": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.getParent")
        const parent = yield* host.getParent(window.id)
        if (parent.parentWindowId === undefined) {
          return new WindowParentResult({})
        }
        const parentWindow = yield* lookupKnownFreshWindow(
          parent.parentWindowId,
          knownWindowIds,
          windowHandleById,
          "Window.getParent"
        )
        return new WindowParentResult({ parent: parentWindow })
      }),
    "Window.getChildren": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          input,
          knownWindowIds,
          "Window.getChildren"
        )
        const listed = yield* host.getChildren(window.id)
        const children = yield* Effect.forEach(
          listed.windows,
          ({ windowId }) =>
            lookupKnownFreshWindow(
              windowId,
              knownWindowIds,
              windowHandleById,
              "Window.getChildren"
            ),
          { concurrency: "unbounded" }
        )
        return new WindowChildrenResult({ children })
      }),
    "Window.subscribeEvents": () =>
      Effect.succeed(new WindowSubscribeEventsResult({ subscribed: true })),
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
        const observed = yield* host.setBounds(window.id, toHostWindowBoundsInput(input.bounds))
        return yield* decodeWindowBounds(observed, "Window.setBounds")
      }),
    "Window.setBoundsOnDisplay": (input: WindowDisplayBoundsInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setBoundsOnDisplay"
        )
        const observed = yield* host.setBoundsOnDisplay(
          window.id,
          input.displayId,
          toHostWindowBoundsInput(input.bounds)
        )
        return yield* decodeWindowBounds(observed, "Window.setBoundsOnDisplay")
      }),
    "Window.center": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.center")
        const observed = yield* host.center(window.id)
        return yield* decodeWindowBounds(observed, "Window.center")
      }),
    "Window.centerOnDisplay": (input: WindowDisplayInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.centerOnDisplay"
        )
        const observed = yield* host.centerOnDisplay(window.id, input.displayId)
        return yield* decodeWindowBounds(observed, "Window.centerOnDisplay")
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
    "Window.setTrafficLights": (input: WindowTrafficLightsInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setTrafficLights"
        )
        yield* host.setTrafficLights(window.id, input.trafficLights)
      }),
    "Window.setVibrancy": (input: WindowVibrancyInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setVibrancy"
        )
        yield* host.setVibrancy(window.id, input.material)
      }),
    "Window.clearVibrancy": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.clearVibrancy"
        )
        yield* host.clearVibrancy(window.id)
      }),
    "Window.setShadow": (input: WindowShadowInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setShadow"
        )
        yield* host.setShadow(window.id, input.hasShadow)
      }),
    "Window.setTitleBarStyle": (input: WindowTitleBarStyleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setTitleBarStyle"
        )
        yield* host.setTitleBarStyle(window.id, input.titleBarStyle)
      }),
    "Window.setTitleBarTransparent": (input: WindowTitleBarTransparentInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setTitleBarTransparent"
        )
        yield* host.setTitleBarTransparent(window.id, input.titleBarTransparent)
      }),
    "Window.setTransparent": (input: WindowTransparentInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setTransparent"
        )
        yield* host.setTransparent(window.id, input.transparent)
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
    "Window.setSkipTaskbar": (input: WindowSkipTaskbarInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setSkipTaskbar"
        )
        yield* host.setSkipTaskbar(window.id, input.skipTaskbar)
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
        const state = yield* host.minimize(window.id)
        return yield* decodeWindowState(state, "Window.minimize")
      }),
    "Window.maximize": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.maximize")
        const state = yield* host.maximize(window.id)
        return yield* decodeWindowState(state, "Window.maximize")
      }),
    "Window.restore": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(input, knownWindowIds, "Window.restore")
        const state = yield* host.restore(window.id)
        return yield* decodeWindowState(state, "Window.restore")
      }),
    "Window.setFullscreen": (input: WindowFullscreenInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setFullscreen"
        )
        const state = yield* host.setFullscreen(window.id, input.fullscreen)
        return yield* decodeWindowState(state, "Window.setFullscreen")
      }),
    "Window.setSimpleFullscreen": (input: WindowSimpleFullscreenInput) =>
      Effect.gen(function* () {
        const { window } = yield* assertKnownFreshWindow(
          { window: input.window },
          knownWindowIds,
          "Window.setSimpleFullscreen"
        )
        const state = yield* host.setSimpleFullscreen(window.id, input.simpleFullscreen)
        return yield* decodeWindowState(state, "Window.setSimpleFullscreen")
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
  operation: "Window.close" | "Window.destroy",
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
          makeHostProtocolInternalError(`Missing tracked child Window:${childWindowId}`, operation)
        )
      }
      yield* closeKnownWindowTree(childWindow, operation, host, registry, context)
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
