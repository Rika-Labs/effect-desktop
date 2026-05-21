import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidArgumentError,
  RpcGroup,
  type HostProtocolError,
  type RpcSupportMetadata
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
export * from "./contracts/webview.js"
import {
  type WebViewCapabilityName,
  WebViewApiCallEvent,
  type WebViewCreateNavigationOptions,
  type WebViewCreateOptions,
  WebViewCreateInput,
  WebViewFrameEvent,
  WebViewNavigationBlockedEvent,
  WebViewNavigationState,
  type WebViewNavigationPolicyOptions,
  type WebViewHandle,
  WebViewHandleInput,
  WebViewLoadRouteInput,
  WebViewLoadUrlInput,
  WebViewRuntimeEvent,
  WebViewResource,
  type WebViewPlatform,
  type WebViewRuntimeMode,
  WebViewSetNavigationPolicyInput,
  WebViewSetZoomInput
} from "./contracts/webview.js"
import type { WindowHandle } from "./contracts/window.js"
const StrictParseOptions = { onExcessProperty: "error" } as const
type WebViewError = HostProtocolError
const WebViewNavigationPartialReason = "host-navigation-state-tracked"
const WebViewNavigationSupport = NativeSurface.support.partial(WebViewNavigationPartialReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: WebViewNavigationPartialReason },
    { platform: "windows", status: "partial", reason: WebViewNavigationPartialReason },
    { platform: "linux", status: "partial", reason: WebViewNavigationPartialReason }
  ]
})
const WebViewDevToolsPartialReason = "host-devtools-debug-build-only"
const WebViewDebuggerUnsupportedReason = "host-debugger-protocol-unavailable"
const WebViewDevToolsSupport = NativeSurface.support.partial(WebViewDevToolsPartialReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: WebViewDevToolsPartialReason },
    { platform: "windows", status: "partial", reason: WebViewDevToolsPartialReason },
    { platform: "linux", status: "partial", reason: WebViewDevToolsPartialReason }
  ]
})
const WebViewDebuggerSupport = NativeSurface.support.unsupported(WebViewDebuggerUnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: WebViewDebuggerUnsupportedReason },
    { platform: "windows", status: "unsupported", reason: WebViewDebuggerUnsupportedReason },
    { platform: "linux", status: "unsupported", reason: WebViewDebuggerUnsupportedReason }
  ]
})
const WebViewDocumentUnsupportedReason = "host-document-output-unavailable"
const WebViewRuntimeUserAgentUnsupportedReason = "host-user-agent-runtime-unavailable"
const WebViewRuntimeMediaControlUnsupportedReason = "host-runtime-media-control-unavailable"
const WebViewRuntimePermissionUnsupportedReason = "host-permission-request-routing-unavailable"
const WebViewFrameRoutingUnsupportedReason = "host-frame-routing-unavailable"
const WebViewPrintZoomPartialReason = "host-print-zoom-provider-backed"
const WebViewDocumentUnsupportedSupport = NativeSurface.support.unsupported(
  WebViewDocumentUnsupportedReason,
  {
    platforms: [
      { platform: "macos", status: "unsupported", reason: WebViewDocumentUnsupportedReason },
      { platform: "windows", status: "unsupported", reason: WebViewDocumentUnsupportedReason },
      { platform: "linux", status: "unsupported", reason: WebViewDocumentUnsupportedReason }
    ]
  }
)
const WebViewRuntimeUserAgentSupport = NativeSurface.support.unsupported(
  WebViewRuntimeUserAgentUnsupportedReason,
  {
    platforms: [
      {
        platform: "macos",
        status: "unsupported",
        reason: WebViewRuntimeUserAgentUnsupportedReason
      },
      {
        platform: "windows",
        status: "unsupported",
        reason: WebViewRuntimeUserAgentUnsupportedReason
      },
      { platform: "linux", status: "unsupported", reason: WebViewRuntimeUserAgentUnsupportedReason }
    ]
  }
)
const WebViewPrintZoomSupport = NativeSurface.support.partial(WebViewPrintZoomPartialReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: WebViewPrintZoomPartialReason },
    { platform: "windows", status: "partial", reason: WebViewPrintZoomPartialReason },
    { platform: "linux", status: "partial", reason: WebViewPrintZoomPartialReason }
  ]
})
const WebViewRuntimeMediaControlSupport = NativeSurface.support.unsupported(
  WebViewRuntimeMediaControlUnsupportedReason,
  {
    platforms: [
      {
        platform: "macos",
        status: "unsupported",
        reason: WebViewRuntimeMediaControlUnsupportedReason
      },
      {
        platform: "windows",
        status: "unsupported",
        reason: WebViewRuntimeMediaControlUnsupportedReason
      },
      {
        platform: "linux",
        status: "unsupported",
        reason: WebViewRuntimeMediaControlUnsupportedReason
      }
    ]
  }
)
const WebViewRuntimePermissionSupport = NativeSurface.support.unsupported(
  WebViewRuntimePermissionUnsupportedReason,
  {
    platforms: [
      {
        platform: "macos",
        status: "unsupported",
        reason: WebViewRuntimePermissionUnsupportedReason
      },
      {
        platform: "windows",
        status: "unsupported",
        reason: WebViewRuntimePermissionUnsupportedReason
      },
      {
        platform: "linux",
        status: "unsupported",
        reason: WebViewRuntimePermissionUnsupportedReason
      }
    ]
  }
)
const WebViewFrameRoutingSupport = NativeSurface.support.unsupported(
  WebViewFrameRoutingUnsupportedReason,
  {
    platforms: [
      { platform: "macos", status: "unsupported", reason: WebViewFrameRoutingUnsupportedReason },
      { platform: "windows", status: "unsupported", reason: WebViewFrameRoutingUnsupportedReason },
      { platform: "linux", status: "unsupported", reason: WebViewFrameRoutingUnsupportedReason }
    ]
  }
)

export const WebViewCreate = NativeSurface.rpc("WebView", "create", {
  payload: WebViewCreateInput,
  success: WebViewResource,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["create"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewLoadRoute = NativeSurface.rpc("WebView", "loadRoute", {
  payload: WebViewLoadRouteInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["loadRoute"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewLoadUrl = NativeSurface.rpc("WebView", "loadUrl", {
  payload: WebViewLoadUrlInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["loadUrl"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewReload = NativeSurface.rpc("WebView", "reload", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["reload"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewStop = NativeSurface.rpc("WebView", "stop", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["stop"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewGoBack = NativeSurface.rpc("WebView", "goBack", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["goBack"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewGoForward = NativeSurface.rpc("WebView", "goForward", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["goForward"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewGetNavigationState = NativeSurface.rpc("WebView", "getNavigationState", {
  payload: WebViewHandleInput,
  success: WebViewNavigationState,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["getNavigationState"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewPrint = NativeSurface.rpc("WebView", "print", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["print"] })
  ),
  endpoint: "mutation",
  support: WebViewPrintZoomSupport
})
export const WebViewSetZoom = NativeSurface.rpc("WebView", "setZoom", {
  payload: WebViewSetZoomInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["setZoom"] })
  ),
  endpoint: "mutation",
  support: WebViewPrintZoomSupport
})
export const WebViewOpenDevTools = NativeSurface.rpc("WebView", "openDevTools", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["openDevTools"] })
  ),
  endpoint: "mutation",
  support: WebViewDevToolsSupport
})
export const WebViewCloseDevTools = NativeSurface.rpc("WebView", "closeDevTools", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["closeDevTools"] })
  ),
  endpoint: "mutation",
  support: WebViewDevToolsSupport
})
export const WebViewSetNavigationPolicy = NativeSurface.rpc("WebView", "setNavigationPolicy", {
  payload: WebViewSetNavigationPolicyInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["setNavigationPolicy"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})
export const WebViewDestroy = NativeSurface.rpc("WebView", "destroy", {
  payload: WebViewHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["destroy"] })
  ),
  endpoint: "mutation",
  support: WebViewNavigationSupport
})

const webViewCapabilityFact = (
  method:
    | "captureScreenshot"
    | "printToPdf"
    | "findInPage"
    | "setUserAgent"
    | "setAudioMuted"
    | "respondToPermission"
    | "listFrames"
    | "postToFrame"
    | "attachDebugger",
  support: RpcSupportMetadata
) =>
  NativeSurface.capabilityFact("WebView", method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: "WebView", methods: [method] })
    ),
    support
  })

export const WebViewCapabilityFacts = Object.freeze([
  webViewCapabilityFact("captureScreenshot", WebViewDocumentUnsupportedSupport),
  webViewCapabilityFact("printToPdf", WebViewDocumentUnsupportedSupport),
  webViewCapabilityFact("findInPage", WebViewDocumentUnsupportedSupport),
  webViewCapabilityFact("setUserAgent", WebViewRuntimeUserAgentSupport),
  webViewCapabilityFact("setAudioMuted", WebViewRuntimeMediaControlSupport),
  webViewCapabilityFact("respondToPermission", WebViewRuntimePermissionSupport),
  webViewCapabilityFact("listFrames", WebViewFrameRoutingSupport),
  webViewCapabilityFact("postToFrame", WebViewFrameRoutingSupport),
  webViewCapabilityFact("attachDebugger", WebViewDebuggerSupport)
])

export const WebViewRpcEvents = Object.freeze({
  NavigationBlocked: { payload: WebViewNavigationBlockedEvent },
  ApiCall: { payload: WebViewApiCallEvent },
  Runtime: { payload: WebViewRuntimeEvent },
  Frame: { payload: WebViewFrameEvent }
})

export type WebViewRpcEvents = typeof WebViewRpcEvents

const WebViewRpcGroup = RpcGroup.make(
  WebViewCreate,
  WebViewLoadRoute,
  WebViewLoadUrl,
  WebViewReload,
  WebViewStop,
  WebViewGoBack,
  WebViewGoForward,
  WebViewGetNavigationState,
  WebViewPrint,
  WebViewSetZoom,
  WebViewOpenDevTools,
  WebViewCloseDevTools,
  WebViewSetNavigationPolicy,
  WebViewDestroy
)

export const WebViewRpcs: RpcGroup.RpcGroup<WebViewRpc> = WebViewRpcGroup

export const WebViewMethodNames = Object.freeze([
  "create",
  "loadRoute",
  "loadUrl",
  "reload",
  "stop",
  "goBack",
  "goForward",
  "getNavigationState",
  "print",
  "setZoom",
  "openDevTools",
  "closeDevTools",
  "setNavigationPolicy",
  "destroy"
] as const)

const WebViewCapabilityMethods = Object.freeze([
  "create",
  "loadRoute",
  "loadUrl",
  "reload",
  "stop",
  "goBack",
  "goForward",
  "getNavigationState",
  "print",
  "setZoom",
  "openDevTools",
  "closeDevTools",
  "setNavigationPolicy",
  "destroy"
] as const satisfies readonly (typeof WebViewMethodNames)[number][])

export interface WebViewClientApi {
  readonly create: (
    input: WebViewCreateOptions
  ) => Effect.Effect<WebViewHandle, WebViewError, never>
  readonly loadRoute: (
    webview: WebViewHandle,
    route: string
  ) => Effect.Effect<void, WebViewError, never>
  readonly loadUrl: (
    webview: WebViewHandle,
    url: string
  ) => Effect.Effect<void, WebViewError, never>
  readonly reload: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly stop: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly goBack: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly goForward: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly getNavigationState: (
    webview: WebViewHandle
  ) => Effect.Effect<WebViewNavigationState, WebViewError, never>
  readonly print: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly setZoom: (
    webview: WebViewHandle,
    zoom: number
  ) => Effect.Effect<void, WebViewError, never>
  readonly openDevTools: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly closeDevTools: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly setNavigationPolicy: (
    webview: WebViewHandle,
    policy: WebViewNavigationPolicyOptions
  ) => Effect.Effect<void, WebViewError, never>
  readonly destroy: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly onNavigationBlocked: () => Stream.Stream<
    WebViewNavigationBlockedEvent,
    WebViewError,
    never
  >
  readonly onApiCall: () => Stream.Stream<WebViewApiCallEvent, WebViewError, never>
  readonly onRuntimeEvent: (
    webview?: WebViewHandle
  ) => Stream.Stream<WebViewRuntimeEvent, WebViewError, never>
  readonly onFrameEvent: (
    webview?: WebViewHandle
  ) => Stream.Stream<WebViewFrameEvent, WebViewError, never>
}

export class WebViewClient extends Context.Service<WebViewClient, WebViewClientApi>()(
  "@effect-desktop/native/WebViewClient"
) {}

export interface WebViewServiceApi extends Omit<WebViewClientApi, "create"> {
  readonly create: (
    window: WindowHandle,
    input?: WebViewCreateNavigationOptions
  ) => Effect.Effect<WebViewHandle, WebViewError, never>
}

export class WebView extends Context.Service<WebView, WebViewServiceApi>()(
  "@effect-desktop/native/WebView"
) {
  static readonly layer = Layer.effect(WebView)(
    Effect.gen(function* () {
      const client = yield* WebViewClient
      return WebView.of(makeWebViewService(client))
    })
  )
}

export const WebViewLive = WebView.layer

export const makeWebViewClientLayer = (client: WebViewClientApi): Layer.Layer<WebViewClient> =>
  Layer.succeed(WebViewClient)(client)

export const makeWebViewServiceLayer = (client: WebViewClientApi): Layer.Layer<WebView> =>
  Layer.provide(WebViewLive, makeWebViewClientLayer(client))

export const makeWebViewBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<WebViewClient> => WebViewSurface.bridgeClientLayer(exchange, options)

export type WebViewRpc = RpcGroup.Rpcs<typeof WebViewRpcGroup>

export type WebViewRpcHandlers = RpcGroup.HandlersFrom<WebViewRpc>

export const WebViewHandlersLive = WebViewRpcGroup.toLayer({
  "WebView.create": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      return yield* webview.create(input.window, {
        url: input.url,
        originPolicy: input.originPolicy,
        ...(input.isolation === undefined ? {} : { isolation: input.isolation })
      })
    }),
  "WebView.loadRoute": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.loadRoute(input.webview, input.route)
    }),
  "WebView.loadUrl": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.loadUrl(input.webview, input.url)
    }),
  "WebView.reload": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.reload(input.webview)
    }),
  "WebView.stop": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.stop(input.webview)
    }),
  "WebView.goBack": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.goBack(input.webview)
    }),
  "WebView.goForward": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.goForward(input.webview)
    }),
  "WebView.getNavigationState": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      return yield* webview.getNavigationState(input.webview)
    }),
  "WebView.print": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.print(input.webview)
    }),
  "WebView.setZoom": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.setZoom(input.webview, input.zoom)
    }),
  "WebView.openDevTools": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.openDevTools(input.webview)
    }),
  "WebView.closeDevTools": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.closeDevTools(input.webview)
    }),
  "WebView.setNavigationPolicy": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.setNavigationPolicy(input.webview, input.policy)
    }),
  "WebView.destroy": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.destroy(input.webview)
    })
})

export const WebViewSurface = NativeSurface.make("WebView", WebViewRpcGroup, {
  service: WebViewClient,
  capabilities: WebViewCapabilityMethods,
  handlers: WebViewHandlersLive,
  capabilityFacts: WebViewCapabilityFacts,
  client: (client) => webViewClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => webViewClientFromRpcClient(client, exchange)
})

export const makeHostWebViewRpcRuntime = (
  handlers: WebViewRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => WebViewSurface.hostRuntime(handlers, runtimeOptions)

export const webViewCapability = (
  name: WebViewCapabilityName,
  platform: WebViewPlatform = currentWebViewPlatform(),
  mode: WebViewRuntimeMode = "prod"
): boolean => {
  const support = WEBVIEW_CAPABILITY_MATRIX[platform][name]
  return support === "dev-only" ? mode === "dev" : support
}

const makeWebViewService = (client: WebViewClientApi): WebViewServiceApi => {
  const service: WebViewServiceApi = {
    create: (window, input) =>
      client.create({ window: toWindowHandle(window), ...defaultWebViewCreateOptions(input) }),
    loadRoute: (webview, route) => client.loadRoute(webview, route),
    loadUrl: (webview, url) => client.loadUrl(webview, url),
    reload: (webview) => client.reload(webview),
    stop: (webview) => client.stop(webview),
    goBack: (webview) => client.goBack(webview),
    goForward: (webview) => client.goForward(webview),
    getNavigationState: (webview) => client.getNavigationState(webview),
    print: (webview) => client.print(webview),
    setZoom: (webview, zoom) => client.setZoom(webview, zoom),
    openDevTools: (webview) => client.openDevTools(webview),
    closeDevTools: (webview) => client.closeDevTools(webview),
    setNavigationPolicy: (webview, policy) => client.setNavigationPolicy(webview, policy),
    destroy: (webview) => client.destroy(webview),
    onNavigationBlocked: () => client.onNavigationBlocked(),
    onApiCall: () => client.onApiCall(),
    onRuntimeEvent: (webview) => client.onRuntimeEvent(webview),
    onFrameEvent: (webview) => client.onFrameEvent(webview)
  }

  return Object.freeze(service)
}

const webViewClientFromRpcClient = (
  client: DesktopRpcClient<WebViewRpc>,
  exchange: BridgeClientExchange | undefined
): WebViewClientApi => {
  const webViewClient: WebViewClientApi = {
    create: (input) =>
      decodeWebViewCreateInput(input).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.create"](decoded), "WebView.create")
        )
      ),
    loadRoute: (webview, route) =>
      decodeWebViewLoadRouteInput({ webview: toWebViewHandle(webview), route }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.loadRoute"](decoded), "WebView.loadRoute")
        )
      ),
    loadUrl: (webview, url) =>
      decodeWebViewLoadUrlInput({ webview: toWebViewHandle(webview), url }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.loadUrl"](decoded), "WebView.loadUrl")
        )
      ),
    reload: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.reload"](decoded), "WebView.reload")
        )
      ),
    stop: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) => runWebViewRpc(client["WebView.stop"](decoded), "WebView.stop"))
      ),
    goBack: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.goBack"](decoded), "WebView.goBack")
        )
      ),
    goForward: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.goForward"](decoded), "WebView.goForward")
        )
      ),
    getNavigationState: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.getNavigationState"](decoded), "WebView.getNavigationState")
        ),
        Effect.flatMap(decodeWebViewNavigationState)
      ),
    print: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.print"](decoded), "WebView.print")
        )
      ),
    setZoom: (webview, zoom) =>
      decodeWebViewSetZoomInput({ webview: toWebViewHandle(webview), zoom }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.setZoom"](decoded), "WebView.setZoom")
        )
      ),
    openDevTools: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.openDevTools"](decoded), "WebView.openDevTools")
        )
      ),
    closeDevTools: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.closeDevTools"](decoded), "WebView.closeDevTools")
        )
      ),
    setNavigationPolicy: (webview, policy) =>
      decodeWebViewSetNavigationPolicyInput({ webview: toWebViewHandle(webview), policy }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(
            client["WebView.setNavigationPolicy"](decoded),
            "WebView.setNavigationPolicy"
          )
        )
      ),
    destroy: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.destroy"](decoded), "WebView.destroy")
        )
      ),
    onNavigationBlocked: () => subscribeWebViewNavigationBlockedEvent(exchange),
    onApiCall: () => subscribeWebViewApiCallEvent(exchange),
    onRuntimeEvent: (webview) => subscribeWebViewRuntimeEvent(exchange, webview),
    onFrameEvent: (webview) => subscribeWebViewFrameEvent(exchange, webview)
  }

  return Object.freeze(webViewClient)
}

const subscribeWebViewNavigationBlockedEvent = (
  exchange: BridgeClientExchange | undefined
): Stream.Stream<WebViewNavigationBlockedEvent, WebViewError, never> =>
  subscribeNativeEvent(exchange, "WebView.NavigationBlocked", WebViewNavigationBlockedEvent)

const subscribeWebViewApiCallEvent = (
  exchange: BridgeClientExchange | undefined
): Stream.Stream<WebViewApiCallEvent, WebViewError, never> =>
  subscribeNativeEvent(exchange, "WebView.ApiCall", WebViewApiCallEvent)

const subscribeWebViewRuntimeEvent = (
  exchange: BridgeClientExchange | undefined,
  webview?: WebViewHandle
): Stream.Stream<WebViewRuntimeEvent, WebViewError, never> => {
  const stream = subscribeNativeEvent(exchange, "WebView.RuntimeEvent", WebViewRuntimeEvent)
  return webview === undefined
    ? stream
    : stream.pipe(Stream.filter((event) => event.webview.id === webview.id))
}

const subscribeWebViewFrameEvent = (
  exchange: BridgeClientExchange | undefined,
  webview?: WebViewHandle
): Stream.Stream<WebViewFrameEvent, WebViewError, never> => {
  const stream = subscribeNativeEvent(exchange, "WebView.FrameEvent", WebViewFrameEvent)
  return webview === undefined
    ? stream
    : stream.pipe(Stream.filter((event) => event.webview.id === webview.id))
}

const defaultWebViewCreateOptions = (
  input?: WebViewCreateNavigationOptions
): WebViewCreateNavigationOptions => ({
  ...input,
  url: input?.url ?? "app://localhost/",
  originPolicy: input?.originPolicy ?? {
    allowedOrigins: ["app://localhost"],
    onDisallowed: "block"
  }
})

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

const toWebViewHandle = (handle: WebViewHandle): WebViewHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

const decodeWebViewCreateInput = (
  input: unknown
): Effect.Effect<WebViewCreateInput, WebViewError, never> =>
  decodeInput(WebViewCreateInput, input, "WebView.create")

const decodeWebViewLoadRouteInput = (
  input: unknown
): Effect.Effect<WebViewLoadRouteInput, WebViewError, never> =>
  decodeInput(WebViewLoadRouteInput, input, "WebView.loadRoute")

const decodeWebViewLoadUrlInput = (
  input: unknown
): Effect.Effect<WebViewLoadUrlInput, WebViewError, never> =>
  decodeInput(WebViewLoadUrlInput, input, "WebView.loadUrl")

const decodeWebViewHandleInput = (
  input: unknown
): Effect.Effect<WebViewHandleInput, WebViewError, never> =>
  decodeInput(WebViewHandleInput, input, "WebView.handle")

const decodeWebViewNavigationState = (
  input: unknown
): Effect.Effect<WebViewNavigationState, WebViewError, never> =>
  Schema.decodeUnknownEffect(WebViewNavigationState)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError("WebView.getNavigationState", formatUnknownError(error))
    )
  )

const decodeWebViewSetNavigationPolicyInput = (
  input: unknown
): Effect.Effect<WebViewSetNavigationPolicyInput, WebViewError, never> =>
  decodeInput(WebViewSetNavigationPolicyInput, input, "WebView.setNavigationPolicy")

const decodeWebViewSetZoomInput = (
  input: unknown
): Effect.Effect<WebViewSetZoomInput, WebViewError, never> =>
  decodeInput(WebViewSetZoomInput, input, "WebView.setZoom")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, WebViewError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const runWebViewRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, WebViewError, never> =>
  effect.pipe(
    Effect.mapError(mapWebViewRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapWebViewRpcClientError = (error: unknown): WebViewError =>
  isWebViewError(error)
    ? error
    : makeHostProtocolInternalError("WebView RPC client failed", "WebView")

const isWebViewError = (error: unknown): error is WebViewError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const currentWebViewPlatform = (): WebViewPlatform => {
  if (process.platform === "darwin") {
    return "macos"
  }
  if (process.platform === "win32") {
    return "windows"
  }
  return "linux"
}

const WEBVIEW_CAPABILITY_MATRIX: Readonly<
  Record<WebViewPlatform, Readonly<Record<WebViewCapabilityName, boolean | "dev-only">>>
> = Object.freeze({
  macos: Object.freeze({
    print: true,
    "popup blocking": true,
    autofill: true,
    "devtools open": "dev-only",
    getUserMedia: true,
    "service workers in app:": false,
    "PDF embedded viewer": true
  }),
  windows: Object.freeze({
    print: true,
    "popup blocking": true,
    autofill: true,
    "devtools open": "dev-only",
    getUserMedia: true,
    "service workers in app:": true,
    "PDF embedded viewer": true
  }),
  linux: Object.freeze({
    print: true,
    "popup blocking": false,
    autofill: false,
    "devtools open": "dev-only",
    getUserMedia: false,
    "service workers in app:": false,
    "PDF embedded viewer": false
  })
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
