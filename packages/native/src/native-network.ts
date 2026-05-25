import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import { NativeNetworkEvent, NativeNetworkSupportedResult } from "./contracts/native-network.js"
import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

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

const UnsupportedCapabilityFacts = Object.freeze([
  nativeNetworkCapabilityFact("fetch"),
  nativeNetworkCapabilityFact("upload"),
  nativeNetworkCapabilityFact("connectWebSocket"),
  nativeNetworkCapabilityFact("closeWebSocket"),
  nativeNetworkCapabilityFact("localhostUrl")
])

const NativeNetworkEventStream = NativeSurface.event(Surface, "Event", {
  payload: NativeNetworkEvent,
  support: NativeSurface.support.supported
})

const NativeNetworkRpcGroup = RpcGroup.make(NativeNetworkIsSupported, NativeNetworkEventStream)

export const NativeNetworkRpcs: RpcGroup.RpcGroup<NativeNetworkRpc> = NativeNetworkRpcGroup

export const NativeNetworkMethodNames = Object.freeze(["isSupported"] as const)

export interface NativeNetworkClientApi {
  readonly isSupported: () => Effect.Effect<NativeNetworkSupportedResult, NativeNetworkError, never>
  readonly events: () => Stream.Stream<NativeNetworkEvent, NativeNetworkError, never>
}

export class NativeNetwork extends Context.Service<NativeNetwork, NativeNetworkClientApi>()(
  "@orika/native/NativeNetwork"
) {}

export type NativeNetworkRpc = RpcGroup.Rpcs<typeof NativeNetworkRpcGroup>
export type NativeNetworkRpcHandlers<R = never> = NativeRpcHandlers<typeof NativeNetworkRpcGroup, R>

export const NativeNetworkHandlersLive = NativeNetworkRpcGroup.toLayer({
  "NativeNetwork.isSupported": () =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.isSupported()
    }),
  "NativeNetwork.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const network = yield* NativeNetwork
        return network.events()
      })
    )
})

export const NativeNetworkSurface = NativeSurface.make(Surface, NativeNetworkRpcGroup, {
  service: NativeNetwork,
  handlers: NativeNetworkHandlersLive,
  capabilityFacts: UnsupportedCapabilityFacts,
  client: (client) => nativeNetworkClientFromRpcClient(client),
  bridgeClient: (client, exchange) => nativeNetworkBridgeClientFromRpcClient(client, exchange)
})

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

const nativeNetworkClientFromRpcClient = (
  client: DesktopRpcClient<NativeNetworkRpc>
): NativeNetworkClientApi =>
  Object.freeze({
    isSupported: () =>
      runNativeNetworkRpc(
        client["NativeNetwork.isSupported"](undefined),
        "NativeNetwork.isSupported"
      ),
    events: () =>
      runNativeNetworkRpcStream(
        client["NativeNetwork.events.Event"](undefined),
        "NativeNetwork.events.Event"
      )
  } satisfies NativeNetworkClientApi)

const nativeNetworkBridgeClientFromRpcClient = (
  client: DesktopRpcClient<NativeNetworkRpc>,
  exchange: BridgeClientExchange
): NativeNetworkClientApi =>
  Object.freeze({
    isSupported: () =>
      runNativeNetworkRpc(
        client["NativeNetwork.isSupported"](undefined),
        "NativeNetwork.isSupported"
      ),
    events: () => NativeSurface.subscribeEvent(exchange, NativeNetworkEventStream)
  } satisfies NativeNetworkClientApi)

const runNativeNetworkRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NativeNetworkError, never> => runNativeRpc(effect, operation, Surface)

const runNativeNetworkRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, NativeNetworkError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
