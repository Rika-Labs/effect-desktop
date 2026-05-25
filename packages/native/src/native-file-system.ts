import {
  type BridgeClientExchange,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  type RpcEndpointKind,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  NativeFileSystemEvent,
  NativeFileSystemMetadata,
  NativeFileSystemOpenInput,
  type NativeFileSystemOpenOptions,
  NativeFileSystemOpenResult,
  NativeFileSystemStatInput,
  type NativeFileSystemStatOptions,
  NativeFileSystemStopWatchingInput,
  type NativeFileSystemStopWatchingOptions,
  NativeFileSystemStopWatchingResult,
  NativeFileSystemSupportedResult,
  NativeFileSystemWatchInput,
  type NativeFileSystemWatchOptions,
  NativeFileSystemWatchResult
} from "./contracts/native-file-system.js"
import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/native-file-system.js"

const Surface = "NativeFileSystem"
const NativeFileSystemSupport = NativeSurface.support.supported

export type NativeFileSystemError = HostProtocolError

export const NativeFileSystemOpen = nativeFileSystemRpc(
  "open",
  NativeFileSystemOpenInput,
  NativeFileSystemOpenResult,
  P.nativeInvoke({ primitive: Surface, methods: ["open"] }),
  "mutation"
)
export const NativeFileSystemStat = nativeFileSystemRpc(
  "stat",
  NativeFileSystemStatInput,
  NativeFileSystemMetadata,
  P.nativeInvoke({ primitive: Surface, methods: ["stat"] }),
  "query"
)
export const NativeFileSystemWatch = nativeFileSystemRpc(
  "watch",
  NativeFileSystemWatchInput,
  NativeFileSystemWatchResult,
  P.nativeInvoke({ primitive: Surface, methods: ["watch"] }),
  "mutation"
)
export const NativeFileSystemStopWatching = nativeFileSystemRpc(
  "stopWatching",
  NativeFileSystemStopWatchingInput,
  NativeFileSystemStopWatchingResult,
  P.nativeInvoke({ primitive: Surface, methods: ["stopWatching"] }),
  "mutation"
)
export const NativeFileSystemIsSupported = nativeFileSystemRpc(
  "isSupported",
  Schema.Void,
  NativeFileSystemSupportedResult,
  NativeSurface.authority.none,
  "query"
)

const NativeFileSystemEventStream = NativeSurface.event(Surface, "Event", {
  payload: NativeFileSystemEvent,
  support: NativeFileSystemSupport
})

const NativeFileSystemRpcGroup = RpcGroup.make(
  NativeFileSystemOpen,
  NativeFileSystemStat,
  NativeFileSystemWatch,
  NativeFileSystemStopWatching,
  NativeFileSystemIsSupported,
  NativeFileSystemEventStream
)

export const NativeFileSystemRpcs: RpcGroup.RpcGroup<NativeFileSystemRpc> = NativeFileSystemRpcGroup

export const NativeFileSystemMethodNames = Object.freeze([
  "open",
  "stat",
  "watch",
  "stopWatching",
  "isSupported"
] as const)

const NativeFileSystemCapabilityMethods = Object.freeze([
  "open",
  "stat",
  "watch",
  "stopWatching"
] as const satisfies readonly (typeof NativeFileSystemMethodNames)[number][])

export interface NativeFileSystemClientApi {
  readonly open: (
    input: NativeFileSystemOpenOptions
  ) => Effect.Effect<NativeFileSystemOpenResult, NativeFileSystemError, never>
  readonly stat: (
    input: NativeFileSystemStatOptions
  ) => Effect.Effect<NativeFileSystemMetadata, NativeFileSystemError, never>
  readonly watch: (
    input: NativeFileSystemWatchOptions
  ) => Effect.Effect<NativeFileSystemWatchResult, NativeFileSystemError, never>
  readonly stopWatching: (
    input: NativeFileSystemStopWatchingOptions
  ) => Effect.Effect<NativeFileSystemStopWatchingResult, NativeFileSystemError, never>
  readonly isSupported: () => Effect.Effect<
    NativeFileSystemSupportedResult,
    NativeFileSystemError,
    never
  >
  readonly events: () => Stream.Stream<NativeFileSystemEvent, NativeFileSystemError, never>
}

export class NativeFileSystem extends Context.Service<
  NativeFileSystem,
  NativeFileSystemClientApi
>()("@orika/native/NativeFileSystem") {}

export type NativeFileSystemRpc = RpcGroup.Rpcs<typeof NativeFileSystemRpcGroup>
export type NativeFileSystemRpcHandlers<R = never> = NativeRpcHandlers<
  typeof NativeFileSystemRpcGroup,
  R
>

export const NativeFileSystemHandlersLive = NativeFileSystemRpcGroup.toLayer({
  "NativeFileSystem.open": (input) =>
    Effect.gen(function* () {
      const nativeFileSystem = yield* NativeFileSystem
      return yield* nativeFileSystem.open(input)
    }),
  "NativeFileSystem.stat": (input) =>
    Effect.gen(function* () {
      const nativeFileSystem = yield* NativeFileSystem
      return yield* nativeFileSystem.stat(input)
    }),
  "NativeFileSystem.watch": (input) =>
    Effect.gen(function* () {
      const nativeFileSystem = yield* NativeFileSystem
      return yield* nativeFileSystem.watch(input)
    }),
  "NativeFileSystem.stopWatching": (input) =>
    Effect.gen(function* () {
      const nativeFileSystem = yield* NativeFileSystem
      return yield* nativeFileSystem.stopWatching(input)
    }),
  "NativeFileSystem.isSupported": () =>
    Effect.gen(function* () {
      const nativeFileSystem = yield* NativeFileSystem
      return yield* nativeFileSystem.isSupported()
    }),
  "NativeFileSystem.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const nativeFileSystem = yield* NativeFileSystem
        return nativeFileSystem.events()
      })
    )
})

export const NativeFileSystemSurface = NativeSurface.make(
  "NativeFileSystem",
  NativeFileSystemRpcGroup,
  {
    service: NativeFileSystem,
    capabilities: NativeFileSystemCapabilityMethods,
    handlers: NativeFileSystemHandlersLive,
    client: (client) => nativeFileSystemClientFromRpcClient(client),
    bridgeClient: (client, exchange) => nativeFileSystemBridgeClientFromRpcClient(client, exchange)
  }
)

const nativeFileSystemClientFromRpcClient = (
  client: DesktopRpcClient<NativeFileSystemRpc>
): NativeFileSystemClientApi =>
  Object.freeze({
    open: (input) =>
      decodeNativeFileSystemOpenInput(input, "NativeFileSystem.open").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(client["NativeFileSystem.open"](decoded), "NativeFileSystem.open")
        )
      ),
    stat: (input) =>
      decodeNativeFileSystemStatInput(input, "NativeFileSystem.stat").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(client["NativeFileSystem.stat"](decoded), "NativeFileSystem.stat")
        )
      ),
    watch: (input) =>
      decodeNativeFileSystemWatchInput(input, "NativeFileSystem.watch").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(
            client["NativeFileSystem.watch"](decoded),
            "NativeFileSystem.watch"
          )
        )
      ),
    stopWatching: (input) =>
      decodeNativeFileSystemStopWatchingInput(input, "NativeFileSystem.stopWatching").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(
            client["NativeFileSystem.stopWatching"](decoded),
            "NativeFileSystem.stopWatching"
          )
        )
      ),
    isSupported: () =>
      runNativeFileSystemRpc(
        client["NativeFileSystem.isSupported"](),
        "NativeFileSystem.isSupported"
      ),
    events: () =>
      runNativeFileSystemRpcStream(
        client["NativeFileSystem.events.Event"](undefined),
        "NativeFileSystem.events.Event"
      )
  } satisfies NativeFileSystemClientApi)

const nativeFileSystemBridgeClientFromRpcClient = (
  client: DesktopRpcClient<NativeFileSystemRpc>,
  exchange: BridgeClientExchange
): NativeFileSystemClientApi =>
  Object.freeze({
    open: (input) =>
      decodeNativeFileSystemOpenInput(input, "NativeFileSystem.open").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(client["NativeFileSystem.open"](decoded), "NativeFileSystem.open")
        )
      ),
    stat: (input) =>
      decodeNativeFileSystemStatInput(input, "NativeFileSystem.stat").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(client["NativeFileSystem.stat"](decoded), "NativeFileSystem.stat")
        )
      ),
    watch: (input) =>
      decodeNativeFileSystemWatchInput(input, "NativeFileSystem.watch").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(
            client["NativeFileSystem.watch"](decoded),
            "NativeFileSystem.watch"
          )
        )
      ),
    stopWatching: (input) =>
      decodeNativeFileSystemStopWatchingInput(input, "NativeFileSystem.stopWatching").pipe(
        Effect.flatMap((decoded) =>
          runNativeFileSystemRpc(
            client["NativeFileSystem.stopWatching"](decoded),
            "NativeFileSystem.stopWatching"
          )
        )
      ),
    isSupported: () =>
      runNativeFileSystemRpc(
        client["NativeFileSystem.isSupported"](),
        "NativeFileSystem.isSupported"
      ),
    events: () => NativeSurface.subscribeEvent(exchange, NativeFileSystemEventStream)
  } satisfies NativeFileSystemClientApi)

const decodeNativeFileSystemOpenInput = (
  input: unknown,
  operation: string
): Effect.Effect<NativeFileSystemOpenInput, NativeFileSystemError, never> =>
  decodeNativeInput(NativeFileSystemOpenInput, input, operation)

const decodeNativeFileSystemStatInput = (
  input: unknown,
  operation: string
): Effect.Effect<NativeFileSystemStatInput, NativeFileSystemError, never> =>
  decodeNativeInput(NativeFileSystemStatInput, input, operation)

const decodeNativeFileSystemWatchInput = (
  input: unknown,
  operation: string
): Effect.Effect<NativeFileSystemWatchInput, NativeFileSystemError, never> =>
  decodeNativeInput(NativeFileSystemWatchInput, input, operation)

const decodeNativeFileSystemStopWatchingInput = (
  input: unknown,
  operation: string
): Effect.Effect<NativeFileSystemStopWatchingInput, NativeFileSystemError, never> =>
  decodeNativeInput(NativeFileSystemStopWatchingInput, input, operation)

function nativeFileSystemRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  authority: RpcCapabilityMetadata,
  endpoint: RpcEndpointKind
) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(authority),
    endpoint,
    support: NativeFileSystemSupport
  })
}

const runNativeFileSystemRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NativeFileSystemError, never> => runNativeRpc(effect, operation, Surface)

const runNativeFileSystemRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, NativeFileSystemError, never> => runNativeRpcStream(stream, operation, Surface)
