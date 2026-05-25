import { RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import {
  ShellOpenExternalInput,
  ShellOpenPathInput,
  ShellShowItemInFolderInput,
  ShellTrashItemInput
} from "./contracts/shell.js"
import { nativeAuthority, nativeRpc, NativeRpcSupport } from "./native-rpc-descriptor.js"

export const ShellOpenExternal = nativeRpc("Shell", "openExternal", {
  payload: ShellOpenExternalInput,
  success: Schema.Void,
  authority: nativeAuthority.native("Shell"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ShellShowItemInFolder = nativeRpc("Shell", "showItemInFolder", {
  payload: ShellShowItemInFolderInput,
  success: Schema.Void,
  authority: nativeAuthority.native("Shell"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ShellOpenPath = nativeRpc("Shell", "openPath", {
  payload: ShellOpenPathInput,
  success: Schema.Void,
  authority: nativeAuthority.native("Shell"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ShellTrashItem = nativeRpc("Shell", "trashItem", {
  payload: ShellTrashItemInput,
  success: Schema.Void,
  authority: nativeAuthority.native("Shell"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

const ShellRpcGroup = RpcGroup.make(
  ShellOpenExternal,
  ShellShowItemInFolder,
  ShellOpenPath,
  ShellTrashItem
)

export const ShellRpcs: RpcGroup.RpcGroup<ShellRpc> = ShellRpcGroup

export type ShellRpc = RpcGroup.Rpcs<typeof ShellRpcGroup>

export const ShellMethodNames = Object.freeze([
  "openExternal",
  "showItemInFolder",
  "openPath",
  "trashItem"
] as const)
