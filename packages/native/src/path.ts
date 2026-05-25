import {
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  type RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type DesktopRpcClient } from "@orika/core"
import { Context, Effect } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import { CanonicalPath } from "./contracts/path.js"
import { PathMethodNames, PathRpcs } from "./path-rpc.js"

export {
  PathAppData,
  PathCache,
  PathDownloads,
  PathHome,
  PathLogs,
  PathMethodNames,
  PathRpcs,
  PathTemp
} from "./path-rpc.js"

export type PathError = HostProtocolError

const PathRpcGroup = PathRpcs

export interface PathClientApi {
  readonly appData: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly cache: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly logs: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly temp: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly home: () => Effect.Effect<CanonicalPath, PathError, never>
  readonly downloads: () => Effect.Effect<CanonicalPath, PathError, never>
}

export class Path extends Context.Service<Path, PathClientApi>()("@orika/native/Path") {}

export type PathRpc = RpcGroup.Rpcs<typeof PathRpcGroup>

export type PathRpcHandlers<R = never> = NativeRpcHandlers<typeof PathRpcGroup, R>

export const PathHandlersLive = PathRpcGroup.toLayer({
  "Path.appData": () =>
    Effect.gen(function* () {
      const path = yield* Path
      return yield* path.appData()
    }),
  "Path.cache": () =>
    Effect.gen(function* () {
      const path = yield* Path
      return yield* path.cache()
    }),
  "Path.logs": () =>
    Effect.gen(function* () {
      const path = yield* Path
      return yield* path.logs()
    }),
  "Path.temp": () =>
    Effect.gen(function* () {
      const path = yield* Path
      return yield* path.temp()
    }),
  "Path.home": () =>
    Effect.gen(function* () {
      const path = yield* Path
      return yield* path.home()
    }),
  "Path.downloads": () =>
    Effect.gen(function* () {
      const path = yield* Path
      return yield* path.downloads()
    })
})

export const PathSurface = NativeSurface.make("Path", PathRpcGroup, {
  service: Path,
  capabilities: PathMethodNames,
  handlers: PathHandlersLive,
  client: (client) => pathClientFromRpcClient(client)
})

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
