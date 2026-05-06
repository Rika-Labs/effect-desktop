import {
  Api,
  Client,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiContractClass,
  type ApiContractError,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { CanonicalPath } from "./contracts/path.js"

export type PathError = HostProtocolError

export const PathApiSpec = Object.freeze({
  appData: pathMethodSpec("native.invoke:Path.appData"),
  cache: pathMethodSpec("native.invoke:Path.cache"),
  logs: pathMethodSpec("native.invoke:Path.logs"),
  temp: pathMethodSpec("native.invoke:Path.temp"),
  home: pathMethodSpec("native.invoke:Path.home"),
  downloads: pathMethodSpec("native.invoke:Path.downloads")
}) satisfies ApiContractSpec

export type PathApiSpec = typeof PathApiSpec

export const PathApiEvents = Object.freeze({})

export type PathApiEvents = typeof PathApiEvents

export const PathApi: ApiContractClass<"Path", PathApiSpec, PathApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Path"
    static readonly spec = PathApiSpec
    static readonly events = PathApiEvents

    static layer<Handlers extends ApiHandlers<PathApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Path", PathApiSpec, Handlers, PathApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"Path", PathApiSpec, PathApiEvents>

  return Object.freeze(contract)
})()

export const registerPathApi = (): Effect.Effect<
  ApiContractClass<"Path", PathApiSpec, PathApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Path")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Path", PathApiSpec, PathApiEvents>
    }

    return yield* Api.Tag("Path")<unknown>()(PathApiSpec, PathApiEvents)
  })

export const PathMethodNames = Object.freeze(
  Object.keys(PathApiSpec) as ReadonlyArray<keyof PathApiSpec>
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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<PathClient> => Layer.succeed(PathClient)(makePathBridgeClient(exchange, options))

export const makeHostPathApiLayer = <Handlers extends ApiHandlers<PathApiSpec>>(
  handlers: Handlers
): ApiLayer<"Path", PathApiSpec, Handlers, PathApiEvents> => PathApi.layer(handlers)

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
  exchange: ApiClientExchange,
  options: ApiClientOptions
): PathClientApi => {
  const client = Client({ Path: PathApi }, exchange, options).Path

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
