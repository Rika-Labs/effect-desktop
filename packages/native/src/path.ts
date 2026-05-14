import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolError as HostProtocolErrorSchema,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { PermissionRegistry } from "@effect-desktop/core"
import { P, DesktopRpc, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import { CanonicalPath } from "./contracts/path.js"

export type PathError = HostProtocolError

export const PathAppData = pathRpc(
  "appData",
  P.nativeInvoke({ primitive: "Path", methods: ["appData"] })
)
export const PathCache = pathRpc("cache", P.nativeInvoke({ primitive: "Path", methods: ["cache"] }))
export const PathLogs = pathRpc("logs", P.nativeInvoke({ primitive: "Path", methods: ["logs"] }))
export const PathTemp = pathRpc("temp", P.nativeInvoke({ primitive: "Path", methods: ["temp"] }))
export const PathHome = pathRpc("home", P.nativeInvoke({ primitive: "Path", methods: ["home"] }))
export const PathDownloads = pathRpc(
  "downloads",
  P.nativeInvoke({ primitive: "Path", methods: ["downloads"] })
)

export const PathRpcEvents = Object.freeze({})

export type PathRpcEvents = typeof PathRpcEvents

const PathRpcGroup = RpcGroup.make(
  PathAppData,
  PathCache,
  PathLogs,
  PathTemp,
  PathHome,
  PathDownloads
)

export const PathRpcs: RpcGroup.RpcGroup<PathRpc> = PathRpcGroup

export const PathMethodNames = Object.freeze([
  "appData",
  "cache",
  "logs",
  "temp",
  "home",
  "downloads"
] as const)

export interface PathClientApi {
  readonly appData: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly cache: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly logs: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly temp: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly home: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly downloads: () => Effect.Effect<CanonicalPath, PathError, never>
}

export class PathClient extends Context.Service<PathClient, PathClientApi>()(
  "@effect-desktop/native/PathClient"
) {}

export interface PathServiceApi {
  readonly appData: () => Effect.Effect<string, PathError, never>
  readonly cache: () => Effect.Effect<string, PathError, never>
  readonly logs: () => Effect.Effect<string, PathError, never>
  readonly temp: () => Effect.Effect<string, PathError, never>
  readonly home: () => Effect.Effect<string, PathError, never>
  readonly downloads: () => Effect.Effect<string, PathError, never>
}

export class Path extends Context.Service<Path, PathServiceApi>()("@effect-desktop/native/Path") {}

export const PathLive = Layer.effect(Path)(
  Effect.gen(function* () {
    const client = yield* PathClient
    return makePathService(client)
  })
)

export const makePathClientLayer = (client: PathClientApi): Layer.Layer<PathClient> =>
  Layer.succeed(PathClient)(client)

export const makePathServiceLayer = (client: PathClientApi): Layer.Layer<Path> =>
  Layer.provide(PathLive, makePathClientLayer(client))

export const makePathBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<PathClient> =>
  Layer.provide(PathSurface.clientLayer, makePathBridgeProtocolLayer(exchange, options))

export type PathRpc = RpcGroup.Rpcs<typeof PathRpcGroup>

export type PathRpcHandlers = Parameters<typeof PathRpcGroup.toLayer>[0]

export const PathHandlersLive = PathRpcGroup.toLayer({
  "Path.appData": () =>
    Effect.gen(function* () {
      const path = yield* Path
      const value = yield* path.appData()
      return new CanonicalPath({ path: value })
    }),
  "Path.cache": () =>
    Effect.gen(function* () {
      const path = yield* Path
      const value = yield* path.cache()
      return new CanonicalPath({ path: value })
    }),
  "Path.logs": () =>
    Effect.gen(function* () {
      const path = yield* Path
      const value = yield* path.logs()
      return new CanonicalPath({ path: value })
    }),
  "Path.temp": () =>
    Effect.gen(function* () {
      const path = yield* Path
      const value = yield* path.temp()
      return new CanonicalPath({ path: value })
    }),
  "Path.home": () =>
    Effect.gen(function* () {
      const path = yield* Path
      const value = yield* path.home()
      return new CanonicalPath({ path: value })
    }),
  "Path.downloads": () =>
    Effect.gen(function* () {
      const path = yield* Path
      const value = yield* path.downloads()
      return new CanonicalPath({ path: value })
    })
})

export const PathSurface = DesktopRpc.surface("Path", PathRpcGroup, {
  service: PathClient,
  handlers: PathHandlersLive,
  client: (client) => pathClientFromRpcClient(client)
})

export const makeHostPathRpcRuntime = (
  handlers: PathRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  makeNativeHostRpcRuntime(PathRpcGroup, PathRpcGroup.toLayer(handlers), runtimeOptions)

const makePathService = (client: PathClientApi): PathServiceApi => {
  const toStringPath = (effect: Effect.Effect<CanonicalPath, PathError, never>) =>
    effect.pipe(Effect.map((result) => result.path))

  const service: PathServiceApi = {
    appData: () => toStringPath(client.appData()),
    cache: () => toStringPath(client.cache()),
    logs: () => toStringPath(client.logs()),
    temp: () => toStringPath(client.temp()),
    home: () => toStringPath(client.home()),
    downloads: () => toStringPath(client.downloads())
  }

  return Object.freeze(service)
}

const pathClientFromRpcClient = (client: DesktopRpcClient<PathRpc>): PathClientApi => {
  const pathClient: PathClientApi = {
    appData: () => runPathRpc(client["Path.appData"](undefined), "Path.appData"),
    cache: () => runPathRpc(client["Path.cache"](undefined), "Path.cache"),
    logs: () => runPathRpc(client["Path.logs"](undefined), "Path.logs"),
    temp: () => runPathRpc(client["Path.temp"](undefined), "Path.temp"),
    home: () => runPathRpc(client["Path.home"](undefined), "Path.home"),
    downloads: () => runPathRpc(client["Path.downloads"](undefined), "Path.downloads")
  }

  return Object.freeze(pathClient)
}

const makePathBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

function pathRpc<const Method extends (typeof PathMethodNames)[number]>(
  method: Method,
  permission: RpcCapabilityMetadata
) {
  return Rpc.make(`Path.${method}` as const, {
    success: CanonicalPath,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability(permission))
}

const runPathRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, PathError, never> =>
  effect.pipe(
    Effect.mapError(mapPathRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapPathRpcClientError = (error: unknown): PathError =>
  isPathError(error) ? error : makeHostProtocolInternalError("Path RPC client failed", "Path")

const isPathError = (error: unknown): error is PathError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
