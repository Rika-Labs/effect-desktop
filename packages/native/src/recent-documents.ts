import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  RpcGroup
} from "@effect-desktop/bridge"
import { type DesktopRpcClient, type PermissionRegistry, P } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  RecentDocumentsAddInput,
  type RecentDocumentsAddOptions,
  RecentDocumentsEvent,
  RecentDocumentsListResult
} from "./contracts/recent-documents.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/recent-documents.js"

const Surface = "RecentDocuments"
const UnsupportedReason = "host-adapter-unimplemented"
const RecentDocumentsAddSupport = NativeSurface.support.supported
const MacOsRecentDocumentsSupport = NativeSurface.support.partial("macos-recent-documents-only", {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type RecentDocumentsError = HostProtocolError

export const RecentDocumentsAdd = NativeSurface.rpc(Surface, "add", {
  payload: RecentDocumentsAddInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["add"] })
  ),
  endpoint: "mutation",
  support: RecentDocumentsAddSupport
})
export const RecentDocumentsClear = NativeSurface.rpc(Surface, "clear", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["clear"] })
  ),
  endpoint: "mutation",
  support: MacOsRecentDocumentsSupport
})
export const RecentDocumentsList = NativeSurface.rpc(Surface, "list", {
  payload: Schema.Void,
  success: RecentDocumentsListResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["list"] })
  ),
  endpoint: "query",
  support: MacOsRecentDocumentsSupport
})

export const RecentDocumentsRpcEvents = Object.freeze({
  Event: { payload: RecentDocumentsEvent }
})

const RecentDocumentsRpcGroup = RpcGroup.make(
  RecentDocumentsAdd,
  RecentDocumentsClear,
  RecentDocumentsList
)

export const RecentDocumentsRpcs: RpcGroup.RpcGroup<RecentDocumentsRpc> = RecentDocumentsRpcGroup

export const RecentDocumentsMethodNames = Object.freeze(["add", "clear", "list"] as const)

export interface RecentDocumentsClientApi {
  readonly add: (input: RecentDocumentsAddOptions) => Effect.Effect<void, RecentDocumentsError>
  readonly clear: () => Effect.Effect<void, RecentDocumentsError>
  readonly list: () => Effect.Effect<RecentDocumentsListResult, RecentDocumentsError>
  readonly events: () => Stream.Stream<RecentDocumentsEvent, RecentDocumentsError>
}

export class RecentDocumentsClient extends Context.Service<
  RecentDocumentsClient,
  RecentDocumentsClientApi
>()("@effect-desktop/native/RecentDocumentsClient") {}

export type RecentDocumentsServiceApi = RecentDocumentsClientApi

export class RecentDocuments extends Context.Service<RecentDocuments, RecentDocumentsServiceApi>()(
  "@effect-desktop/native/RecentDocuments"
) {
  static readonly layer = Layer.effect(RecentDocuments)(
    Effect.gen(function* () {
      const client = yield* RecentDocumentsClient
      return RecentDocuments.of({
        add: (input) => client.add(input),
        clear: () => client.clear(),
        list: () => client.list(),
        events: () => client.events()
      } satisfies RecentDocumentsServiceApi)
    })
  )
}

export const RecentDocumentsLive = RecentDocuments.layer

export const makeRecentDocumentsClientLayer = (
  client: RecentDocumentsClientApi
): Layer.Layer<RecentDocumentsClient> => Layer.succeed(RecentDocumentsClient)(client)

export const makeRecentDocumentsServiceLayer = (
  client: RecentDocumentsClientApi
): Layer.Layer<RecentDocuments> =>
  Layer.provide(RecentDocumentsLive, makeRecentDocumentsClientLayer(client))

export const makeRecentDocumentsBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<RecentDocumentsClient> => RecentDocumentsSurface.bridgeClientLayer(exchange, options)

export type RecentDocumentsRpc = RpcGroup.Rpcs<typeof RecentDocumentsRpcGroup>
export type RecentDocumentsRpcHandlers = RpcGroup.HandlersFrom<RecentDocumentsRpc>

export const RecentDocumentsHandlersLive = RecentDocumentsRpcGroup.toLayer({
  "RecentDocuments.add": (input) =>
    Effect.gen(function* () {
      const recentDocuments = yield* RecentDocuments
      yield* recentDocuments.add(input)
    }),
  "RecentDocuments.clear": () =>
    Effect.gen(function* () {
      const recentDocuments = yield* RecentDocuments
      yield* recentDocuments.clear()
    }),
  "RecentDocuments.list": () =>
    Effect.gen(function* () {
      const recentDocuments = yield* RecentDocuments
      return yield* recentDocuments.list()
    })
})

export const RecentDocumentsSurface = NativeSurface.make(
  "RecentDocuments",
  RecentDocumentsRpcGroup,
  {
    service: RecentDocumentsClient,
    capabilities: RecentDocumentsMethodNames,
    handlers: RecentDocumentsHandlersLive,
    client: (client) => recentDocumentsClientFromRpcClient(client),
    bridgeClient: (client, exchange) => recentDocumentsClientFromRpcClient(client, exchange)
  }
)

export const makeHostRecentDocumentsRpcRuntime = (
  handlers: RecentDocumentsRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  RecentDocumentsSurface.hostRuntime(handlers, runtimeOptions)

const recentDocumentsClientFromRpcClient = (
  client: DesktopRpcClient<RecentDocumentsRpc>,
  exchange?: BridgeClientExchange
): RecentDocumentsClientApi =>
  Object.freeze({
    add: (input) =>
      decodeRecentDocumentsAddInput(input, "RecentDocuments.add").pipe(
        Effect.flatMap((decoded) =>
          runRecentDocumentsRpc(client["RecentDocuments.add"](decoded), "RecentDocuments.add")
        )
      ),
    clear: () => runRecentDocumentsRpc(client["RecentDocuments.clear"](), "RecentDocuments.clear"),
    list: () => runRecentDocumentsRpc(client["RecentDocuments.list"](), "RecentDocuments.list"),
    events: () => subscribeNativeEvent(exchange, "RecentDocuments.Event", RecentDocumentsEvent)
  } satisfies RecentDocumentsClientApi)

const decodeRecentDocumentsAddInput = (
  input: unknown,
  operation: string
): Effect.Effect<RecentDocumentsAddInput, RecentDocumentsError> =>
  decodeNativeInput(RecentDocumentsAddInput, input, operation)

const runRecentDocumentsRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, RecentDocumentsError> => runNativeRpc(effect, operation, Surface)
