import { type BridgeClientExchange, type HostProtocolError, RpcGroup } from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  AppMetadataEvent,
  AppMetadataInfo,
  AppMetadataLaunchContext,
  AppMetadataPaths
} from "./contracts/app-metadata.js"
import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/app-metadata.js"

const Surface = "AppMetadata"
const AppMetadataSupport = NativeSurface.support.supported

export type AppMetadataError = HostProtocolError

export const AppMetadataGetInfo = NativeSurface.rpc(Surface, "getInfo", {
  payload: Schema.Void,
  success: AppMetadataInfo,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["getInfo"] })
  ),
  endpoint: "query",
  support: AppMetadataSupport
})
export const AppMetadataGetPaths = NativeSurface.rpc(Surface, "getPaths", {
  payload: Schema.Void,
  success: AppMetadataPaths,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["getPaths"] })
  ),
  endpoint: "query",
  support: AppMetadataSupport
})
export const AppMetadataGetLaunchContext = NativeSurface.rpc(Surface, "getLaunchContext", {
  payload: Schema.Void,
  success: AppMetadataLaunchContext,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["getLaunchContext"] })
  ),
  endpoint: "query",
  support: AppMetadataSupport
})

const AppMetadataEventStream = NativeSurface.event(Surface, "Event", {
  payload: AppMetadataEvent,
  support: AppMetadataSupport
})

const AppMetadataRpcGroup = RpcGroup.make(
  AppMetadataGetInfo,
  AppMetadataGetPaths,
  AppMetadataGetLaunchContext,
  AppMetadataEventStream
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
    }),
  "AppMetadata.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const metadata = yield* AppMetadata
        return metadata.events()
      })
    )
})

export const AppMetadataSurface = NativeSurface.make("AppMetadata", AppMetadataRpcGroup, {
  service: AppMetadata,
  capabilities: AppMetadataMethodNames,
  handlers: AppMetadataHandlersLive,
  client: (client) => appMetadataClientFromRpcClient(client),
  bridgeClient: (client, exchange) => appMetadataBridgeClientFromRpcClient(client, exchange)
})

const appMetadataClientFromRpcClient = (
  client: DesktopRpcClient<AppMetadataRpc>
): AppMetadataClientApi =>
  Object.freeze({
    getInfo: () => runAppMetadataRpc(client["AppMetadata.getInfo"](), "AppMetadata.getInfo"),
    getPaths: () => runAppMetadataRpc(client["AppMetadata.getPaths"](), "AppMetadata.getPaths"),
    getLaunchContext: () =>
      runAppMetadataRpc(client["AppMetadata.getLaunchContext"](), "AppMetadata.getLaunchContext"),
    events: () =>
      runAppMetadataRpcStream(
        client["AppMetadata.events.Event"](undefined),
        "AppMetadata.events.Event"
      )
  } satisfies AppMetadataClientApi)

const appMetadataBridgeClientFromRpcClient = (
  client: DesktopRpcClient<AppMetadataRpc>,
  exchange: BridgeClientExchange
): AppMetadataClientApi =>
  Object.freeze({
    getInfo: () => runAppMetadataRpc(client["AppMetadata.getInfo"](), "AppMetadata.getInfo"),
    getPaths: () => runAppMetadataRpc(client["AppMetadata.getPaths"](), "AppMetadata.getPaths"),
    getLaunchContext: () =>
      runAppMetadataRpc(client["AppMetadata.getLaunchContext"](), "AppMetadata.getLaunchContext"),
    events: () => NativeSurface.subscribeEvent(exchange, AppMetadataEventStream)
  } satisfies AppMetadataClientApi)

const runAppMetadataRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AppMetadataError> => runNativeRpc(effect, operation, Surface)

const runAppMetadataRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, AppMetadataError> => runNativeRpcStream(stream, operation, Surface)
