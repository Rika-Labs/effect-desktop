import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P, type PermissionRegistry } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  DownloadEvent,
  type DownloadHandle,
  DownloadSupportedResult
} from "./contracts/download.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/download.js"

const Surface = "Download"
const UnsupportedReason = "host-download-unavailable"
const EventMethod = "Download.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type DownloadError = HostProtocolError

export const DownloadIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: DownloadSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const downloadCapabilityFact = (method: "start" | "pause" | "resume" | "cancel" | "list") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const DownloadCapabilityFacts = Object.freeze([
  downloadCapabilityFact("start"),
  downloadCapabilityFact("pause"),
  downloadCapabilityFact("resume"),
  downloadCapabilityFact("cancel"),
  downloadCapabilityFact("list")
])

export const DownloadRpcEvents = Object.freeze({
  Event: { payload: DownloadEvent }
})

const DownloadRpcGroup = RpcGroup.make(DownloadIsSupported)

export const DownloadRpcs: RpcGroup.RpcGroup<DownloadRpc> = DownloadRpcGroup

export const DownloadMethodNames = Object.freeze(["isSupported"] as const)

export interface DownloadClientApi {
  readonly isSupported: () => Effect.Effect<DownloadSupportedResult, DownloadError, never>
  readonly events: (download?: DownloadHandle) => Stream.Stream<DownloadEvent, DownloadError, never>
}

export class DownloadClient extends Context.Service<DownloadClient, DownloadClientApi>()(
  "@orika/native/DownloadClient"
) {}

export interface DownloadServiceApi {
  readonly isSupported: () => Effect.Effect<DownloadSupportedResult, DownloadError, never>
  readonly events: (download?: DownloadHandle) => Stream.Stream<DownloadEvent, DownloadError, never>
}

export class Download extends Context.Service<Download, DownloadServiceApi>()(
  "@orika/native/Download"
) {
  static readonly layer = Layer.effect(Download)(
    Effect.gen(function* () {
      const client = yield* DownloadClient
      return makeDownloadService(client)
    })
  )
}

export const DownloadLive = Download.layer

export const makeDownloadClientLayer = (client: DownloadClientApi): Layer.Layer<DownloadClient> =>
  Layer.succeed(DownloadClient)(client)

export const makeDownloadServiceLayer = (client: DownloadClientApi): Layer.Layer<Download> =>
  Layer.succeed(Download)(makeDownloadService(client))

export const makeDownloadBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DownloadClient> => DownloadSurface.bridgeClientLayer(exchange, options)

export type DownloadRpc = RpcGroup.Rpcs<typeof DownloadRpcGroup>
export type DownloadRpcHandlers = RpcGroup.HandlersFrom<DownloadRpc>

export const DownloadHandlersLive = DownloadRpcGroup.toLayer({
  "Download.isSupported": () =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.isSupported()
    })
})

export const DownloadSurface = NativeSurface.make(Surface, DownloadRpcGroup, {
  service: DownloadClient,
  handlers: DownloadHandlersLive,
  capabilityFacts: DownloadCapabilityFacts,
  client: (client) => downloadClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => downloadClientFromRpcClient(client, exchange)
})

export const makeHostDownloadRpcRuntime = (
  handlers: DownloadRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => DownloadSurface.hostRuntime(handlers, runtimeOptions)

export const makeDownloadMemoryClient = (): Effect.Effect<DownloadClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new DownloadSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies DownloadClientApi)
  )

export const makeDownloadUnsupportedClient = (): DownloadClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(new DownloadSupportedResult({ supported: false, reason: UnsupportedReason })),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies DownloadClientApi)

const makeDownloadService = (client: DownloadClientApi): DownloadServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: (download) => client.events(download)
  } satisfies DownloadServiceApi)

const downloadClientFromRpcClient = (
  client: DesktopRpcClient<DownloadRpc>,
  exchange: BridgeClientExchange | undefined
): DownloadClientApi =>
  Object.freeze({
    isSupported: () =>
      runDownloadRpc(client["Download.isSupported"](undefined), "Download.isSupported"),
    events: (download) =>
      subscribeNativeEvent(exchange, EventMethod, DownloadEvent).pipe(
        Stream.filter((event) => download === undefined || event.download.id === download.id)
      )
  } satisfies DownloadClientApi)

const runDownloadRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DownloadError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
