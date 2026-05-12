import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  Rpc,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
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

export const PathRpcs = BridgeRpc.fromGroup("Path", PathRpcGroup, PathRpcEvents)

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

export type PathRpcSpec = (typeof PathRpcs)["spec"]

export const makeHostPathBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<PathRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Path", PathRpcSpec, Handlers, PathRpcEvents> =>
  BridgeRpc.layer(PathRpcs)(handlers)

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
  const client = Client({ Path: PathRpcs }, exchange, options).Path as unknown as PathClientApi

  const pathClient: PathClientApi = {
    appData: () => client.appData(),
    cache: () => client.cache(),
    logs: () => client.logs(),
    temp: () => client.temp(),
    home: () => client.home(),
    downloads: () => client.downloads()
  }

  return Object.freeze(pathClient)
}

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

function pathRpc(method: (typeof PathMethodNames)[number], permission: string) {
  return Rpc.make(`Path.${method}`, {
    success: CanonicalPath,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: permission }))
}
