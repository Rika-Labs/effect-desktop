import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidArgumentError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

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
  "native.invoke:WebView.create"
)
export const WebViewLoadRoute = webviewRpc(
  "loadRoute",
  WebViewLoadRouteInput,
  Schema.Void,
  "native.invoke:WebView.loadRoute"
)
export const WebViewLoadUrl = webviewRpc(
  "loadUrl",
  WebViewLoadUrlInput,
  Schema.Void,
  "native.invoke:WebView.loadUrl"
)
export const WebViewReload = webviewRpc(
  "reload",
  WebViewHandleInput,
  Schema.Void,
  "native.invoke:WebView.reload"
)
export const WebViewGoBack = webviewRpc(
  "goBack",
  WebViewHandleInput,
  Schema.Void,
  "native.invoke:WebView.goBack"
)
export const WebViewGoForward = webviewRpc(
  "goForward",
  WebViewHandleInput,
  Schema.Void,
  "native.invoke:WebView.goForward"
)
export const WebViewCaptureScreenshot = webviewRpc(
  "captureScreenshot",
  WebViewHandleInput,
  WebViewScreenshot,
  "native.invoke:WebView.captureScreenshot"
)
export const WebViewSetNavigationPolicy = webviewRpc(
  "setNavigationPolicy",
  WebViewSetNavigationPolicyInput,
  Schema.Void,
  "native.invoke:WebView.setNavigationPolicy"
)
export const WebViewCapability = webviewRpc(
  "capability",
  WebViewCapabilityInput,
  WebViewCapabilityResult,
  "none"
)
export const WebViewDestroy = webviewRpc(
  "destroy",
  WebViewHandleInput,
  Schema.Void,
  "native.invoke:WebView.destroy"
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
) {}

export const WebViewLive = Layer.effect(WebView)(
  Effect.gen(function* () {
    const client = yield* WebViewClient
    return makeWebViewService(client)
  })
)

export const makeWebViewClientLayer = (client: WebViewClientApi): Layer.Layer<WebViewClient> =>
  Layer.succeed(WebViewClient)(client)

export const makeWebViewServiceLayer = (client: WebViewClientApi): Layer.Layer<WebView> =>
  Layer.provide(WebViewLive, makeWebViewClientLayer(client))

export const makeWebViewBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<WebViewClient> =>
  Layer.succeed(WebViewClient)(makeWebViewBridgeClient(exchange, options))

export type WebViewRpc = RpcGroup.Rpcs<typeof WebViewRpcGroup>

export type WebViewRpcHandlers = Parameters<typeof WebViewRpcGroup.toLayer>[0]

export const makeHostWebViewRpcRuntime = (
  handlers: WebViewRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(WebViewRpcGroup, WebViewRpcGroup.toLayer(handlers), runtimeOptions)

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

const makeWebViewBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): WebViewClientApi => {
  const webViewClient: WebViewClientApi = {
    create: (input) =>
      decodeWebViewCreateInput(input).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.create"](decoded), "WebView.create")
          )
        )
      ),
    loadRoute: (webview, route) =>
      decodeWebViewLoadRouteInput({ webview: toWebViewHandle(webview), route }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.loadRoute"](decoded), "WebView.loadRoute")
          )
        )
      ),
    loadUrl: (webview, url) =>
      decodeWebViewLoadUrlInput({ webview: toWebViewHandle(webview), url }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.loadUrl"](decoded), "WebView.loadUrl")
          )
        )
      ),
    reload: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.reload"](decoded), "WebView.reload")
          )
        )
      ),
    goBack: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.goBack"](decoded), "WebView.goBack")
          )
        )
      ),
    goForward: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.goForward"](decoded), "WebView.goForward")
          )
        )
      ),
    captureScreenshot: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.captureScreenshot"](decoded), "WebView.captureScreenshot")
          )
        ),
        Effect.flatMap(validateWebViewScreenshot)
      ),
    setNavigationPolicy: (webview, policy) =>
      decodeWebViewSetNavigationPolicyInput({ webview: toWebViewHandle(webview), policy }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(
              client["WebView.setNavigationPolicy"](decoded),
              "WebView.setNavigationPolicy"
            )
          )
        )
      ),
    capability: (input) =>
      decodeWebViewCapabilityInput(input).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.capability"](decoded), "WebView.capability")
          )
        )
      ),
    destroy: (webview) =>
      decodeWebViewHandleInput({ webview: toWebViewHandle(webview) }).pipe(
        Effect.flatMap((decoded) =>
          withWebViewRpcClient(exchange, options, (client) =>
            runWebViewRpc(client["WebView.destroy"](decoded), "WebView.destroy")
          )
        )
      ),
    onNavigationBlocked: () => subscribeWebViewEvent(exchange, "WebView.NavigationBlocked")
  }

  return Object.freeze(webViewClient)
}

const makeWebViewBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withWebViewRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: WebViewGeneratedClient) => Effect.Effect<A, WebViewError, never>
): Effect.Effect<A, WebViewError, never> =>
  Effect.scoped(
    RpcClient.make(WebViewRpcGroup).pipe(
      Effect.map((client) => client as unknown as WebViewGeneratedClient),
      Effect.flatMap(use),
      Effect.provide(makeWebViewBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeWebViewEvent = (
  exchange: BridgeClientExchange,
  method: "WebView.NavigationBlocked"
): Stream.Stream<WebViewNavigationBlockedEvent, WebViewError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeWebViewEventEnvelope(method, envelope)))
}

const decodeWebViewEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<WebViewNavigationBlockedEvent, WebViewError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Effect.mapError(
    Schema.decodeUnknownEffect(WebViewNavigationBlockedEvent)(envelope.payload) as Effect.Effect<
      WebViewNavigationBlockedEvent,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
}

export const makeUnsupportedWebViewClient = (): WebViewClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, WebViewError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, WebViewError, never> =>
    Stream.fail(unsupportedError(method))

  const client: WebViewClientApi = {
    create: () => unsupportedEffect<WebViewHandle>("WebView.create"),
    loadRoute: () => unsupportedEffect<void>("WebView.loadRoute"),
    loadUrl: () => unsupportedEffect<void>("WebView.loadUrl"),
    reload: () => unsupportedEffect<void>("WebView.reload"),
    goBack: () => unsupportedEffect<void>("WebView.goBack"),
    goForward: () => unsupportedEffect<void>("WebView.goForward"),
    captureScreenshot: () => unsupportedEffect<WebViewScreenshot>("WebView.captureScreenshot"),
    setNavigationPolicy: () => unsupportedEffect<void>("WebView.setNavigationPolicy"),
    capability: (input) =>
      Effect.succeed(
        new WebViewCapabilityResult({
          supported: webViewCapability(input.name, input.platform, input.mode)
        })
      ),
    destroy: () => unsupportedEffect<void>("WebView.destroy"),
    onNavigationBlocked: () =>
      unsupportedStream<WebViewNavigationBlockedEvent>("WebView.NavigationBlocked")
  }

  return Object.freeze(client)
}

const defaultWebViewCreateOptions = (): WebViewCreateOptions => ({
  url: "app://localhost/",
  originPolicy: {
    allowedOrigins: ["app://localhost"],
    onDisallowed: "block"
  }
})

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host WebView platform adapter is not implemented yet",
    message: `unsupported WebView method: ${method}`,
    operation: method,
    recoverable: false
  })

const toWebViewHandle = (handle: WebViewHandle): WebViewHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as WebViewHandle

const decodeWebViewCreateInput = (
  input: unknown
): Effect.Effect<WebViewCreateInput, WebViewError, never> =>
  decodeInput(WebViewCreateInput, input, "WebView.create") as Effect.Effect<
    WebViewCreateInput,
    WebViewError,
    never
  >

const decodeWebViewLoadRouteInput = (
  input: unknown
): Effect.Effect<WebViewLoadRouteInput, WebViewError, never> =>
  decodeInput(WebViewLoadRouteInput, input, "WebView.loadRoute") as Effect.Effect<
    WebViewLoadRouteInput,
    WebViewError,
    never
  >

const decodeWebViewLoadUrlInput = (
  input: unknown
): Effect.Effect<WebViewLoadUrlInput, WebViewError, never> =>
  decodeInput(WebViewLoadUrlInput, input, "WebView.loadUrl") as Effect.Effect<
    WebViewLoadUrlInput,
    WebViewError,
    never
  >

const decodeWebViewHandleInput = (
  input: unknown
): Effect.Effect<WebViewHandleInput, WebViewError, never> =>
  decodeInput(WebViewHandleInput, input, "WebView.handle") as Effect.Effect<
    WebViewHandleInput,
    WebViewError,
    never
  >

const decodeWebViewSetNavigationPolicyInput = (
  input: unknown
): Effect.Effect<WebViewSetNavigationPolicyInput, WebViewError, never> =>
  decodeInput(
    WebViewSetNavigationPolicyInput,
    input,
    "WebView.setNavigationPolicy"
  ) as Effect.Effect<WebViewSetNavigationPolicyInput, WebViewError, never>

const decodeWebViewCapabilityInput = (
  input: unknown
): Effect.Effect<WebViewCapabilityInput, WebViewError, never> =>
  decodeInput(WebViewCapabilityInput, input, "WebView.capability") as Effect.Effect<
    WebViewCapabilityInput,
    WebViewError,
    never
  >

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

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, WebViewError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function webviewRpc<Payload extends Schema.Schema<unknown>, Success extends Schema.Schema<unknown>>(
  method: string,
  payload: Payload,
  success: Success,
  capability: string
) {
  return Rpc.make(`WebView.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

interface WebViewGeneratedClient {
  readonly "WebView.create": (
    input: WebViewCreateInput
  ) => Effect.Effect<WebViewHandle, unknown, never>
  readonly "WebView.loadRoute": (
    input: WebViewLoadRouteInput
  ) => Effect.Effect<void, unknown, never>
  readonly "WebView.loadUrl": (input: WebViewLoadUrlInput) => Effect.Effect<void, unknown, never>
  readonly "WebView.reload": (input: WebViewHandleInput) => Effect.Effect<void, unknown, never>
  readonly "WebView.goBack": (input: WebViewHandleInput) => Effect.Effect<void, unknown, never>
  readonly "WebView.goForward": (input: WebViewHandleInput) => Effect.Effect<void, unknown, never>
  readonly "WebView.captureScreenshot": (
    input: WebViewHandleInput
  ) => Effect.Effect<WebViewScreenshot, unknown, never>
  readonly "WebView.setNavigationPolicy": (
    input: WebViewSetNavigationPolicyInput
  ) => Effect.Effect<void, unknown, never>
  readonly "WebView.capability": (
    input: WebViewCapabilityInput
  ) => Effect.Effect<WebViewCapabilityResult, unknown, never>
  readonly "WebView.destroy": (input: WebViewHandleInput) => Effect.Effect<void, unknown, never>
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
