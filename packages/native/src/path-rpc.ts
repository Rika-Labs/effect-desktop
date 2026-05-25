import { RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import { CanonicalPath } from "./contracts/path.js"
import { nativeAuthority, nativeRpc, NativeRpcSupport } from "./native-rpc-descriptor.js"

export const PathAppData = nativeRpc("Path", "appData", {
  payload: Schema.Void,
  success: CanonicalPath,
  authority: nativeAuthority.native("Path"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const PathCache = nativeRpc("Path", "cache", {
  payload: Schema.Void,
  success: CanonicalPath,
  authority: nativeAuthority.native("Path"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const PathLogs = nativeRpc("Path", "logs", {
  payload: Schema.Void,
  success: CanonicalPath,
  authority: nativeAuthority.native("Path"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const PathTemp = nativeRpc("Path", "temp", {
  payload: Schema.Void,
  success: CanonicalPath,
  authority: nativeAuthority.native("Path"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const PathHome = nativeRpc("Path", "home", {
  payload: Schema.Void,
  success: CanonicalPath,
  authority: nativeAuthority.native("Path"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const PathDownloads = nativeRpc("Path", "downloads", {
  payload: Schema.Void,
  success: CanonicalPath,
  authority: nativeAuthority.native("Path"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

const PathRpcGroup = RpcGroup.make(
  PathAppData,
  PathCache,
  PathLogs,
  PathTemp,
  PathHome,
  PathDownloads
)

export const PathRpcs: RpcGroup.RpcGroup<PathRpc> = PathRpcGroup

export type PathRpc = RpcGroup.Rpcs<typeof PathRpcGroup>

export const PathMethodNames = Object.freeze([
  "appData",
  "cache",
  "logs",
  "temp",
  "home",
  "downloads"
] as const)
