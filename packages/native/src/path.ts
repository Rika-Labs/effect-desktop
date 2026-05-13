import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer } from "effect"

import { CanonicalPath } from "./contracts/path.js"

export type PathError = HostProtocolError

export const PathAppData = pathRpc("appData", "native.invoke:Path.appData")
export const PathCache = pathRpc("cache", "native.invoke:Path.cache")
export const PathLogs = pathRpc("logs", "native.invoke:Path.logs")
export const PathTemp = pathRpc("temp", "native.invoke:Path.temp")
export const PathHome = pathRpc("home", "native.invoke:Path.home")
export const PathDownloads = pathRpc("downloads", "native.invoke:Path.downloads")

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
): Layer.Layer<PathClient> => Layer.succeed(PathClient)(makePathBridgeClient(exchange, options))

export type PathRpc = RpcGroup.Rpcs<typeof PathRpcGroup>

export type PathRpcHandlers = Parameters<typeof PathRpcGroup.toLayer>[0]

export const makeHostPathRpcRuntime = (
  handlers: PathRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(PathRpcGroup, PathRpcGroup.toLayer(handlers), runtimeOptions)

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

const makePathBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): PathClientApi => {
  const pathClient: PathClientApi = {
    appData: () =>
      withPathRpcClient(exchange, options, (client) =>
        runPathRpc(client["Path.appData"](undefined), "Path.appData")
      ),
    cache: () =>
      withPathRpcClient(exchange, options, (client) =>
        runPathRpc(client["Path.cache"](undefined), "Path.cache")
      ),
    logs: () =>
      withPathRpcClient(exchange, options, (client) =>
        runPathRpc(client["Path.logs"](undefined), "Path.logs")
      ),
    temp: () =>
      withPathRpcClient(exchange, options, (client) =>
        runPathRpc(client["Path.temp"](undefined), "Path.temp")
      ),
    home: () =>
      withPathRpcClient(exchange, options, (client) =>
        runPathRpc(client["Path.home"](undefined), "Path.home")
      ),
    downloads: () =>
      withPathRpcClient(exchange, options, (client) =>
        runPathRpc(client["Path.downloads"](undefined), "Path.downloads")
      )
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

const withPathRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: PathRpcClient) => Effect.Effect<A, PathError, never>
): Effect.Effect<A, PathError, never> =>
  Effect.scoped(
    RpcClient.make(PathRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makePathBridgeProtocolLayer(exchange, options))
    )
  )

export const makeUnsupportedPathClient = (): PathClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, PathError, never> =>
    Effect.fail(unsupportedError(method))

  const client: PathClientApi = {
    appData: () => unsupportedEffect<CanonicalPath>("Path.appData"),
    cache: () => unsupportedEffect<CanonicalPath>("Path.cache"),
    logs: () => unsupportedEffect<CanonicalPath>("Path.logs"),
    temp: () => unsupportedEffect<CanonicalPath>("Path.temp"),
    home: () => unsupportedEffect<CanonicalPath>("Path.home"),
    downloads: () => unsupportedEffect<CanonicalPath>("Path.downloads")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Path platform adapter is not implemented yet",
    message: `unsupported Path method: ${method}`,
    operation: method,
    recoverable: false
  })

function pathRpc<const Method extends (typeof PathMethodNames)[number]>(
  method: Method,
  permission: string
) {
  return Rpc.make(`Path.${method}` as const, {
    success: CanonicalPath,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: permission }))
}

type PathRpcClient = DesktopRpcClient<PathRpc>

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
