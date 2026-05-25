import { type BridgeClientExchange, type HostProtocolError, RpcGroup } from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  RecentDocumentsAddInput,
  type RecentDocumentsAddOptions,
  RecentDocumentsEvent,
  RecentDocumentsListResult
} from "./contracts/recent-documents.js"
import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/recent-documents.js"

const Surface = "RecentDocuments"
const RecentDocumentsSupport = NativeSurface.support.supported

export type RecentDocumentsError = HostProtocolError

export const RecentDocumentsAdd = NativeSurface.rpc(Surface, "add", {
  payload: RecentDocumentsAddInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["add"] })
  ),
  endpoint: "mutation",
  support: RecentDocumentsSupport
})
export const RecentDocumentsClear = NativeSurface.rpc(Surface, "clear", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["clear"] })
  ),
  endpoint: "mutation",
  support: RecentDocumentsSupport
})
export const RecentDocumentsList = NativeSurface.rpc(Surface, "list", {
  payload: Schema.Void,
  success: RecentDocumentsListResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["list"] })
  ),
  endpoint: "query",
  support: RecentDocumentsSupport
})

const RecentDocumentsEventStream = NativeSurface.event(Surface, "Event", {
  payload: RecentDocumentsEvent,
  support: RecentDocumentsSupport
})

const RecentDocumentsRpcGroup = RpcGroup.make(
  RecentDocumentsAdd,
  RecentDocumentsClear,
  RecentDocumentsList,
  RecentDocumentsEventStream
)

export const RecentDocumentsRpcs: RpcGroup.RpcGroup<RecentDocumentsRpc> = RecentDocumentsRpcGroup

export const RecentDocumentsMethodNames = Object.freeze(["add", "clear", "list"] as const)

export interface RecentDocumentsClientApi {
  readonly add: (input: RecentDocumentsAddOptions) => Effect.Effect<void, RecentDocumentsError>
  readonly clear: () => Effect.Effect<void, RecentDocumentsError>
  readonly list: () => Effect.Effect<RecentDocumentsListResult, RecentDocumentsError>
  readonly events: () => Stream.Stream<RecentDocumentsEvent, RecentDocumentsError>
}

export class RecentDocuments extends Context.Service<RecentDocuments, RecentDocumentsClientApi>()(
  "@orika/native/RecentDocuments"
) {}

export type RecentDocumentsRpc = RpcGroup.Rpcs<typeof RecentDocumentsRpcGroup>
export type RecentDocumentsRpcHandlers<R = never> = NativeRpcHandlers<
  typeof RecentDocumentsRpcGroup,
  R
>

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
    }),
  "RecentDocuments.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const recentDocuments = yield* RecentDocuments
        return recentDocuments.events()
      })
    )
})

export const RecentDocumentsSurface = NativeSurface.make(
  "RecentDocuments",
  RecentDocumentsRpcGroup,
  {
    service: RecentDocuments,
    capabilities: RecentDocumentsMethodNames,
    handlers: RecentDocumentsHandlersLive,
    client: (client) => recentDocumentsClientFromRpcClient(client),
    bridgeClient: (client, exchange) => recentDocumentsBridgeClientFromRpcClient(client, exchange)
  }
)

const recentDocumentsClientFromRpcClient = (
  client: DesktopRpcClient<RecentDocumentsRpc>
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
    events: () =>
      runRecentDocumentsRpcStream(
        client["RecentDocuments.events.Event"](undefined),
        "RecentDocuments.events.Event"
      )
  } satisfies RecentDocumentsClientApi)

const recentDocumentsBridgeClientFromRpcClient = (
  client: DesktopRpcClient<RecentDocumentsRpc>,
  exchange: BridgeClientExchange
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
    events: () => NativeSurface.subscribeEvent(exchange, RecentDocumentsEventStream)
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

const runRecentDocumentsRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, RecentDocumentsError> => runNativeRpcStream(stream, operation, Surface)
