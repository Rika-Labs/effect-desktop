import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

import { CanonicalPath } from "./contracts/path.js"

export type PathError = HostProtocolError

export const PathRpcSpec = Object.freeze({
  appData: pathMethodSpec("native.invoke:Path.appData"),
  cache: pathMethodSpec("native.invoke:Path.cache"),
  logs: pathMethodSpec("native.invoke:Path.logs"),
  temp: pathMethodSpec("native.invoke:Path.temp"),
  home: pathMethodSpec("native.invoke:Path.home"),
  downloads: pathMethodSpec("native.invoke:Path.downloads")
}) satisfies BridgeRpcSpec

export type PathRpcSpec = typeof PathRpcSpec

export const PathRpcEvents = Object.freeze({})

export type PathRpcEvents = typeof PathRpcEvents

export const PathRpcs: BridgeRpcGroup<"Path", PathRpcSpec, PathRpcEvents> = BridgeRpc.group(
  "Path",
  PathRpcSpec,
  PathRpcEvents
)

export const PathMethodNames = Object.freeze(
  Object.keys(PathRpcSpec) as ReadonlyArray<keyof PathRpcSpec>
)

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
  const client = Client({ Path: PathRpcs }, exchange, options).Path

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

function pathMethodSpec(permission: string) {
  return {
    input: Schema.Void,
    output: CanonicalPath,
    error: HostProtocolErrorSchema,
    permission
  } as const
}
