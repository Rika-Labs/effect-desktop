import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { WebRequestEvent, WebRequestSupportedResult } from "./contracts/web-request.js"
import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/web-request.js"

const Surface = "WebRequest"
const UnsupportedReason = "host-web-request-unavailable"
const EventMethod = "WebRequest.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type WebRequestError = HostProtocolError

export const WebRequestIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: WebRequestSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const webRequestCapabilityFact = (
  method: "onBeforeRequest" | "onHeadersReceived" | "removeListener"
) =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const WebRequestCapabilityFacts = Object.freeze([
  webRequestCapabilityFact("onBeforeRequest"),
  webRequestCapabilityFact("onHeadersReceived"),
  webRequestCapabilityFact("removeListener")
])

const WebRequestEventStream = NativeSurface.event(Surface, "Event", {
  payload: WebRequestEvent,
  support: UnsupportedSupport
})

const WebRequestRpcGroup = RpcGroup.make(WebRequestIsSupported, WebRequestEventStream)

export const WebRequestRpcs: RpcGroup.RpcGroup<WebRequestRpc> = WebRequestRpcGroup

export const WebRequestMethodNames = Object.freeze(["isSupported"] as const)

export interface WebRequestClientApi {
  readonly isSupported: () => Effect.Effect<WebRequestSupportedResult, WebRequestError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<WebRequestEvent, WebRequestError, never>
}

export class WebRequestClient extends Context.Service<WebRequestClient, WebRequestClientApi>()(
  "@orika/native/WebRequestClient"
) {}

export interface WebRequestServiceApi {
  readonly isSupported: () => Effect.Effect<WebRequestSupportedResult, WebRequestError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<WebRequestEvent, WebRequestError, never>
}

export class WebRequest extends Context.Service<WebRequest, WebRequestServiceApi>()(
  "@orika/native/WebRequest"
) {
  static readonly layer = Layer.effect(WebRequest)(
    Effect.gen(function* () {
      const client = yield* WebRequestClient
      return makeWebRequestService(client)
    })
  )
}

export const WebRequestLive = WebRequest.layer

export type WebRequestRpc = RpcGroup.Rpcs<typeof WebRequestRpcGroup>
export type WebRequestRpcHandlers<R = never> = NativeRpcHandlers<typeof WebRequestRpcGroup, R>

export const WebRequestHandlersLive = WebRequestRpcGroup.toLayer({
  "WebRequest.isSupported": () =>
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* webRequest.isSupported()
    }),
  "WebRequest.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const webRequest = yield* WebRequest
        return webRequest.events()
      })
    )
})

export const WebRequestSurface = NativeSurface.make(Surface, WebRequestRpcGroup, {
  service: WebRequestClient,
  handlers: WebRequestHandlersLive,
  capabilityFacts: WebRequestCapabilityFacts,
  client: (client) => webRequestClientFromRpcClient(client),
  bridgeClient: (client, exchange) => webRequestBridgeClientFromRpcClient(client, exchange)
})

export const makeWebRequestMemoryClient = (): Effect.Effect<WebRequestClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new WebRequestSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies WebRequestClientApi)
  )

export const makeWebRequestUnsupportedClient = (): WebRequestClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new WebRequestSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies WebRequestClientApi)

const makeWebRequestService = (client: WebRequestClientApi): WebRequestServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  } satisfies WebRequestServiceApi)

const webRequestClientFromRpcClient = (
  client: DesktopRpcClient<WebRequestRpc>
): WebRequestClientApi =>
  Object.freeze({
    isSupported: () =>
      runWebRequestRpc(client["WebRequest.isSupported"](undefined), "WebRequest.isSupported"),
    events: (profile) =>
      runWebRequestRpcStream(
        client["WebRequest.events.Event"](undefined),
        "WebRequest.events.Event"
      ).pipe(Stream.filter((event) => profile === undefined || event.profile.id === profile.id))
  } satisfies WebRequestClientApi)

const webRequestBridgeClientFromRpcClient = (
  client: DesktopRpcClient<WebRequestRpc>,
  exchange: BridgeClientExchange
): WebRequestClientApi =>
  Object.freeze({
    isSupported: () =>
      runWebRequestRpc(client["WebRequest.isSupported"](undefined), "WebRequest.isSupported"),
    events: (profile) =>
      NativeSurface.subscribeEvent(exchange, WebRequestEventStream).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies WebRequestClientApi)

const runWebRequestRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, WebRequestError, never> => runNativeRpc(effect, operation, Surface)

const runWebRequestRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, WebRequestError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
