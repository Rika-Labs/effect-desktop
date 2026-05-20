import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@effect-desktop/bridge"
import { type DesktopRpcClient, P, type PermissionRegistry } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeNetworkEvent, NativeNetworkSupportedResult } from "./contracts/native-network.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/native-network.js"

const Surface = "NativeNetwork"
const UnsupportedReason = "host-native-network-unavailable"
const EventMethod = "NativeNetwork.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type NativeNetworkError = HostProtocolError

export const NativeNetworkIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: NativeNetworkSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const nativeNetworkCapabilityFact = (
  method: "fetch" | "upload" | "connectWebSocket" | "closeWebSocket" | "localhostUrl"
) =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const NativeNetworkCapabilityFacts = Object.freeze([
  nativeNetworkCapabilityFact("fetch"),
  nativeNetworkCapabilityFact("upload"),
  nativeNetworkCapabilityFact("connectWebSocket"),
  nativeNetworkCapabilityFact("closeWebSocket"),
  nativeNetworkCapabilityFact("localhostUrl")
])

export const NativeNetworkRpcEvents = Object.freeze({
  Event: { payload: NativeNetworkEvent }
})

const NativeNetworkRpcGroup = RpcGroup.make(NativeNetworkIsSupported)

export const NativeNetworkRpcs: RpcGroup.RpcGroup<NativeNetworkRpc> = NativeNetworkRpcGroup

export const NativeNetworkMethodNames = Object.freeze(["isSupported"] as const)

export interface NativeNetworkClientApi {
  readonly isSupported: () => Effect.Effect<NativeNetworkSupportedResult, NativeNetworkError, never>
  readonly events: () => Stream.Stream<NativeNetworkEvent, NativeNetworkError, never>
}

export class NativeNetworkClient extends Context.Service<
  NativeNetworkClient,
  NativeNetworkClientApi
>()("@effect-desktop/native/NativeNetworkClient") {}

export interface NativeNetworkServiceApi {
  readonly isSupported: () => Effect.Effect<NativeNetworkSupportedResult, NativeNetworkError, never>
  readonly events: () => Stream.Stream<NativeNetworkEvent, NativeNetworkError, never>
}

export class NativeNetwork extends Context.Service<NativeNetwork, NativeNetworkServiceApi>()(
  "@effect-desktop/native/NativeNetwork"
) {
  static readonly layer = Layer.effect(NativeNetwork)(
    Effect.gen(function* () {
      const client = yield* NativeNetworkClient
      return makeNativeNetworkService(client)
    })
  )
}

export const NativeNetworkLive = NativeNetwork.layer

export const makeNativeNetworkClientLayer = (
  client: NativeNetworkClientApi
): Layer.Layer<NativeNetworkClient> => Layer.succeed(NativeNetworkClient)(client)

export const makeNativeNetworkServiceLayer = (
  client: NativeNetworkClientApi
): Layer.Layer<NativeNetwork> => Layer.succeed(NativeNetwork)(makeNativeNetworkService(client))

export const makeNativeNetworkBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<NativeNetworkClient> => NativeNetworkSurface.bridgeClientLayer(exchange, options)

export type NativeNetworkRpc = RpcGroup.Rpcs<typeof NativeNetworkRpcGroup>
export type NativeNetworkRpcHandlers = RpcGroup.HandlersFrom<NativeNetworkRpc>

export const NativeNetworkHandlersLive = NativeNetworkRpcGroup.toLayer({
  "NativeNetwork.isSupported": () =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.isSupported()
    })
})

export const NativeNetworkSurface = NativeSurface.make(Surface, NativeNetworkRpcGroup, {
  service: NativeNetworkClient,
  handlers: NativeNetworkHandlersLive,
  capabilityFacts: NativeNetworkCapabilityFacts,
  client: (client) => nativeNetworkClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => nativeNetworkClientFromRpcClient(client, exchange)
})

export const makeHostNativeNetworkRpcRuntime = (
  handlers: NativeNetworkRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  NativeNetworkSurface.hostRuntime(handlers, runtimeOptions)

export const makeNativeNetworkMemoryClient = (): Effect.Effect<
  NativeNetworkClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new NativeNetworkSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies NativeNetworkClientApi)
  )

export const makeNativeNetworkUnsupportedClient = (): NativeNetworkClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new NativeNetworkSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies NativeNetworkClientApi)

const makeNativeNetworkService = (client: NativeNetworkClientApi): NativeNetworkServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies NativeNetworkServiceApi)

const nativeNetworkClientFromRpcClient = (
  client: DesktopRpcClient<NativeNetworkRpc>,
  exchange: BridgeClientExchange | undefined
): NativeNetworkClientApi =>
  Object.freeze({
    isSupported: () =>
      runNativeNetworkRpc(
        client["NativeNetwork.isSupported"](undefined),
        "NativeNetwork.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, EventMethod, NativeNetworkEvent)
  } satisfies NativeNetworkClientApi)

const runNativeNetworkRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NativeNetworkError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
