import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidArgumentError,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
export * from "./contracts/webview.js"
import {
  type WebViewCapabilityName,
  WebViewCapabilityResult,
  WebViewCapabilityInput,
  type WebViewCapabilityOptions,
  WebViewApiCallEvent,
  type WebViewCreateNavigationOptions,
  type WebViewCreateOptions,
  WebViewCreateInput,
  type WebViewHandle,
  WebViewHandleInput,
  WebViewLoadRouteInput,
  WebViewLoadUrlInput,
  WebViewNavigationBlockedEvent,
  WebViewNavigationState,
  type WebViewNavigationPolicyOptions,
  WebViewResource,
  type WebViewPlatform,
  type WebViewRuntimeMode,
  WebViewSetNavigationPolicyInput,
  WebViewScreenshot
} from "./contracts/webview.js"
import type { WindowHandle } from "./contracts/window.js"
import { isSupportedImageHeader } from "./contracts/image.js"
const StrictParseOptions = { onExcessProperty: "error" } as const
type WebViewError = HostProtocolError
const WebViewUnsupportedReason = "host-adapter-unimplemented"
const WebViewNavigationPartialReason = "host-navigation-state-tracked"
const WebViewRpcSupport = NativeSurface.support.unsupported(WebViewUnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: WebViewUnsupportedReason },
    { platform: "windows", status: "unsupported", reason: WebViewUnsupportedReason },
    { platform: "linux", status: "unsupported", reason: WebViewUnsupportedReason }
  ]
})
const WebViewNavigationSupport = NativeSurface.support.partial(WebViewNavigationPartialReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: WebViewNavigationPartialReason },
    { platform: "windows", status: "partial", reason: WebViewNavigationPartialReason },
    { platform: "linux", status: "partial", reason: WebViewNavigationPartialReason }
  ]
})

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
export const WebViewCaptureScreenshot = NativeSurface.rpc("WebView", "captureScreenshot", {
  payload: WebViewHandleInput,
  success: WebViewScreenshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "WebView", methods: ["captureScreenshot"] })
  ),
  endpoint: "mutation",
  support: WebViewRpcSupport
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
export const WebViewCapability = NativeSurface.rpc("WebView", "capability", {
  payload: WebViewCapabilityInput,
  success: WebViewCapabilityResult,
  authority: NativeSurface.authority.custom({ kind: "none" }),
  endpoint: "mutation",
  support: WebViewRpcSupport
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

export const WebViewRpcEvents = Object.freeze({
  NavigationBlocked: { payload: WebViewNavigationBlockedEvent },
  ApiCall: { payload: WebViewApiCallEvent }
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
  WebViewCaptureScreenshot,
  WebViewSetNavigationPolicy,
  WebViewCapability,
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
  "captureScreenshot",
  "setNavigationPolicy",
  "capability",
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
  "captureScreenshot",
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
  readonly captureScreenshot: (
    webview: WebViewHandle
  ) => Effect.Effect<WebViewScreenshot, WebViewError, never>
  readonly setNavigationPolicy: (
    webview: WebViewHandle,
    policy: WebViewNavigationPolicyOptions
  ) => Effect.Effect<void, WebViewError, never>
  readonly capability: (
    input: WebViewCapabilityOptions
  ) => Effect.Effect<WebViewCapabilityResult, WebViewError, never>
  readonly destroy: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly onNavigationBlocked: () => Stream.Stream<
    WebViewNavigationBlockedEvent,
    WebViewError,
    never
  >
  readonly onApiCall: () => Stream.Stream<WebViewApiCallEvent, WebViewError, never>
}

export class WebViewClient extends Context.Service<WebViewClient, WebViewClientApi>()(
  "@effect-desktop/native/WebViewClient"
) {}

export interface WebViewServiceApi extends Omit<WebViewClientApi, "create" | "capability"> {
  readonly create: (
    window: WindowHandle,
    input?: WebViewCreateNavigationOptions
  ) => Effect.Effect<WebViewHandle, WebViewError, never>
  readonly capability: (
    name: WebViewCapabilityName,
    options?: { readonly mode?: WebViewRuntimeMode; readonly platform?: WebViewPlatform }
  ) => Effect.Effect<boolean, WebViewError, never>
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
  "WebView.captureScreenshot": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      return yield* webview.captureScreenshot(input.webview)
    }),
  "WebView.setNavigationPolicy": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.setNavigationPolicy(input.webview, input.policy)
    }),
  "WebView.capability": (input) =>
    Effect.gen(function* () {
      const webview = yield* WebView
      const supported = yield* webview.capability(input.name, {
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        ...(input.platform === undefined ? {} : { platform: input.platform })
      })
      return new WebViewCapabilityResult({ supported })
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
    captureScreenshot: (webview) => client.captureScreenshot(webview),
    setNavigationPolicy: (webview, policy) => client.setNavigationPolicy(webview, policy),
    capability: (name, options) =>
      client
        .capability({
          name,
          ...(options?.platform === undefined ? {} : { platform: options.platform }),
          ...(options?.mode === undefined ? {} : { mode: options.mode })
        })
        .pipe(Effect.map((result) => result.supported)),
    destroy: (webview) => client.destroy(webview),
    onNavigationBlocked: () => client.onNavigationBlocked(),
    onApiCall: () => client.onApiCall()
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
    captureScreenshot: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.captureScreenshot"](decoded), "WebView.captureScreenshot")
        ),
        Effect.flatMap(validateWebViewScreenshot)
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
    capability: (input) =>
      decodeWebViewCapabilityInput(input).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.capability"](decoded), "WebView.capability")
        )
      ),
    destroy: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          runWebViewRpc(client["WebView.destroy"](decoded), "WebView.destroy")
        )
      ),
    onNavigationBlocked: () => subscribeWebViewNavigationBlockedEvent(exchange),
    onApiCall: () => subscribeWebViewApiCallEvent(exchange)
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

const decodeWebViewCapabilityInput = (
  input: unknown
): Effect.Effect<WebViewCapabilityInput, WebViewError, never> =>
  decodeInput(WebViewCapabilityInput, input, "WebView.capability")

const validateWebViewScreenshot = (
  screenshot: WebViewScreenshot
): Effect.Effect<WebViewScreenshot, WebViewError, never> =>
  Effect.gen(function* () {
    if (screenshot.bytes.length === 0) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          "WebView.captureScreenshot",
          "screenshot bytes must not be empty"
        )
      )
    }

    if (!isSupportedImageHeader(screenshot.mime, screenshot.bytes)) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          "WebView.captureScreenshot",
          `declared ${screenshot.mime} does not match image header`
        )
      )
    }

    return screenshot
  })

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
    "devtools open": true,
    getUserMedia: true,
    "service workers in app:": true,
    "PDF embedded viewer": true
  }),
  linux: Object.freeze({
    print: false,
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
