import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidArgumentError,
  type RpcCapabilityMetadata,
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
  type WebViewCreateOptions,
  WebViewCreateInput,
  type WebViewHandle,
  WebViewHandleInput,
  WebViewLoadRouteInput,
  WebViewLoadUrlInput,
  WebViewNavigationBlockedEvent,
  type WebViewNavigationPolicyOptions,
  WebViewResource,
  type WebViewPlatform,
  type WebViewRuntimeMode,
  WebViewSetNavigationPolicyInput,
  WebViewScreenshot
} from "./contracts/webview.js"
import { isSupportedImageHeader } from "./contracts/image.js"
const StrictParseOptions = { onExcessProperty: "error" } as const
type WebViewError = HostProtocolError

export const WebViewCreate = webviewRpc(
  "create",
  WebViewCreateInput,
  WebViewResource,
  P.nativeInvoke({ primitive: "WebView", methods: ["create"] })
)
export const WebViewLoadRoute = webviewRpc(
  "loadRoute",
  WebViewLoadRouteInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["loadRoute"] })
)
export const WebViewLoadUrl = webviewRpc(
  "loadUrl",
  WebViewLoadUrlInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["loadUrl"] })
)
export const WebViewReload = webviewRpc(
  "reload",
  WebViewHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["reload"] })
)
export const WebViewGoBack = webviewRpc(
  "goBack",
  WebViewHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["goBack"] })
)
export const WebViewGoForward = webviewRpc(
  "goForward",
  WebViewHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["goForward"] })
)
export const WebViewCaptureScreenshot = webviewRpc(
  "captureScreenshot",
  WebViewHandleInput,
  WebViewScreenshot,
  P.nativeInvoke({ primitive: "WebView", methods: ["captureScreenshot"] })
)
export const WebViewSetNavigationPolicy = webviewRpc(
  "setNavigationPolicy",
  WebViewSetNavigationPolicyInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["setNavigationPolicy"] })
)
export const WebViewCapability = webviewRpc(
  "capability",
  WebViewCapabilityInput,
  WebViewCapabilityResult,
  { kind: "none" }
)
export const WebViewDestroy = webviewRpc(
  "destroy",
  WebViewHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "WebView", methods: ["destroy"] })
)

export const WebViewRpcEvents = Object.freeze({
  NavigationBlocked: { payload: WebViewNavigationBlockedEvent }
})

export type WebViewRpcEvents = typeof WebViewRpcEvents

const WebViewRpcGroup = RpcGroup.make(
  WebViewCreate,
  WebViewLoadRoute,
  WebViewLoadUrl,
  WebViewReload,
  WebViewGoBack,
  WebViewGoForward,
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
  "goBack",
  "goForward",
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
  "goBack",
  "goForward",
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
  readonly goBack: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
  readonly goForward: (webview: WebViewHandle) => Effect.Effect<void, WebViewError, never>
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
}

export class WebViewClient extends Context.Service<WebViewClient, WebViewClientApi>()(
  "@effect-desktop/native/WebViewClient"
) {}

export interface WebViewServiceApi extends Omit<WebViewClientApi, "create" | "capability"> {
  readonly create: (
    input?: WebViewCreateOptions
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
      return yield* webview.create(input)
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
    create: (input) => client.create(input ?? defaultWebViewCreateOptions()),
    loadRoute: (webview, route) => client.loadRoute(webview, route),
    loadUrl: (webview, url) => client.loadUrl(webview, url),
    reload: (webview) => client.reload(webview),
    goBack: (webview) => client.goBack(webview),
    goForward: (webview) => client.goForward(webview),
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
    onNavigationBlocked: () => client.onNavigationBlocked()
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
    onNavigationBlocked: () => subscribeWebViewEvent(exchange, "WebView.NavigationBlocked")
  }

  return Object.freeze(webViewClient)
}

const subscribeWebViewEvent = (
  exchange: BridgeClientExchange | undefined,
  method: "WebView.NavigationBlocked"
): Stream.Stream<WebViewNavigationBlockedEvent, WebViewError, never> =>
  subscribeNativeEvent(exchange, method, WebViewNavigationBlockedEvent)

const defaultWebViewCreateOptions = (): WebViewCreateOptions => ({
  url: "app://localhost/",
  originPolicy: {
    allowedOrigins: ["app://localhost"],
    onDisallowed: "block"
  }
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

function webviewRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("WebView", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

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
