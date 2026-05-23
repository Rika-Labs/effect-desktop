import {
  type BridgeClientExchange,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  type RpcEndpointKind,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  AppMetadataEvent,
  AppMetadataInfo,
  AppMetadataLaunchContext,
  AppMetadataPaths
} from "./contracts/app-metadata.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/app-metadata.js"

const Surface = "AppMetadata"
const AppMetadataSupport = NativeSurface.support.supported

export type AppMetadataError = HostProtocolError

export const AppMetadataGetInfo = appMetadataRpc(
  "getInfo",
  AppMetadataInfo,
  P.nativeInvoke({ primitive: Surface, methods: ["getInfo"] })
)
export const AppMetadataGetPaths = appMetadataRpc(
  "getPaths",
  AppMetadataPaths,
  P.nativeInvoke({ primitive: Surface, methods: ["getPaths"] })
)
export const AppMetadataGetLaunchContext = appMetadataRpc(
  "getLaunchContext",
  AppMetadataLaunchContext,
  P.nativeInvoke({ primitive: Surface, methods: ["getLaunchContext"] })
)

export const AppMetadataRpcEvents = Object.freeze({
  Event: { payload: AppMetadataEvent }
})

const AppMetadataRpcGroup = RpcGroup.make(
  AppMetadataGetInfo,
  AppMetadataGetPaths,
  AppMetadataGetLaunchContext
)

export const AppMetadataRpcs: RpcGroup.RpcGroup<AppMetadataRpc> = AppMetadataRpcGroup

export const AppMetadataMethodNames = Object.freeze([
  "getInfo",
  "getPaths",
  "getLaunchContext"
] as const)

export interface AppMetadataClientApi {
  readonly getInfo: () => Effect.Effect<AppMetadataInfo, AppMetadataError>
  readonly getPaths: () => Effect.Effect<AppMetadataPaths, AppMetadataError>
  readonly getLaunchContext: () => Effect.Effect<AppMetadataLaunchContext, AppMetadataError>
  readonly events: () => Stream.Stream<AppMetadataEvent, AppMetadataError>
}

export class AppMetadata extends Context.Service<AppMetadata, AppMetadataClientApi>()(
  "@orika/native/app-metadata/AppMetadata"
) {}

export type AppMetadataRpc = RpcGroup.Rpcs<typeof AppMetadataRpcGroup>
export type AppMetadataRpcHandlers<R = never> = NativeRpcHandlers<typeof AppMetadataRpcGroup, R>

export const AppMetadataHandlersLive = AppMetadataRpcGroup.toLayer({
  "AppMetadata.getInfo": () =>
    Effect.gen(function* () {
      const metadata = yield* AppMetadata
      return yield* metadata.getInfo()
    }),
  "AppMetadata.getPaths": () =>
    Effect.gen(function* () {
      const metadata = yield* AppMetadata
      return yield* metadata.getPaths()
    }),
  "AppMetadata.getLaunchContext": () =>
    Effect.gen(function* () {
      const metadata = yield* AppMetadata
      return yield* metadata.getLaunchContext()
    })
})

export const AppMetadataSurface = NativeSurface.make("AppMetadata", AppMetadataRpcGroup, {
  service: AppMetadata,
  capabilities: AppMetadataMethodNames,
  handlers: AppMetadataHandlersLive,
  client: (client) => appMetadataClientFromRpcClient(client),
  bridgeClient: (client, exchange) => appMetadataClientFromRpcClient(client, exchange)
})

export const makeHostAppMetadataRpcRuntime = <R = never>(
  handlers: AppMetadataRpcHandlers<R>,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
) => AppMetadataSurface.hostRuntime(handlers, runtimeOptions)

const appMetadataClientFromRpcClient = (
  client: DesktopRpcClient<AppMetadataRpc>,
  exchange?: BridgeClientExchange
): AppMetadataClientApi =>
  Object.freeze({
    getInfo: () => runAppMetadataRpc(client["AppMetadata.getInfo"](), "AppMetadata.getInfo"),
    getPaths: () => runAppMetadataRpc(client["AppMetadata.getPaths"](), "AppMetadata.getPaths"),
    getLaunchContext: () =>
      runAppMetadataRpc(client["AppMetadata.getLaunchContext"](), "AppMetadata.getLaunchContext"),
    events: () => subscribeNativeEvent(exchange, "AppMetadata.Event", AppMetadataEvent)
  } satisfies AppMetadataClientApi)

function appMetadataRpc<
  const Method extends string,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, success: Success, authority: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload: Schema.Void,
    success,
    authority: NativeSurface.authority.custom(authority),
    endpoint: "query" satisfies RpcEndpointKind,
    support: AppMetadataSupport
  })
}

const runAppMetadataRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AppMetadataError> => runNativeRpc(effect, operation, Surface)
