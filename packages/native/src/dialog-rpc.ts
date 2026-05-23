import { type RpcSupportMetadata, RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import {
  DialogConfirmInput,
  DialogConfirmResult,
  DialogMessageInput,
  DialogOpenDirectoryInput,
  DialogOpenFileInput,
  DialogOpenResult,
  DialogSaveFileInput,
  DialogSaveResult
} from "./contracts/dialog.js"
import { nativeAuthority, nativeRpc, NativeRpcSupport } from "./native-rpc-descriptor.js"

const DialogLinuxMultiSelectionReason = "linux-zenity-multi-selection-unavailable"
export const DialogSelectionSupport = NativeRpcSupport.partial(DialogLinuxMultiSelectionReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "supported" },
    { platform: "linux", status: "partial", reason: DialogLinuxMultiSelectionReason }
  ]
}) satisfies RpcSupportMetadata

export const DialogOpenFile = nativeRpc("Dialog", "openFile", {
  payload: DialogOpenFileInput,
  success: DialogOpenResult,
  authority: nativeAuthority.native("Dialog"),
  endpoint: "mutation",
  support: DialogSelectionSupport
})

export const DialogOpenDirectory = nativeRpc("Dialog", "openDirectory", {
  payload: DialogOpenDirectoryInput,
  success: DialogOpenResult,
  authority: nativeAuthority.native("Dialog"),
  endpoint: "mutation",
  support: DialogSelectionSupport
})

export const DialogSaveFile = nativeRpc("Dialog", "saveFile", {
  payload: DialogSaveFileInput,
  success: DialogSaveResult,
  authority: nativeAuthority.native("Dialog"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const DialogMessage = nativeRpc("Dialog", "message", {
  payload: DialogMessageInput,
  success: Schema.Void,
  authority: nativeAuthority.native("Dialog"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const DialogConfirm = nativeRpc("Dialog", "confirm", {
  payload: DialogConfirmInput,
  success: DialogConfirmResult,
  authority: nativeAuthority.native("Dialog"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const DialogRpcEvents = Object.freeze({})

export type DialogRpcEvents = typeof DialogRpcEvents

const DialogRpcGroup = RpcGroup.make(
  DialogOpenFile,
  DialogOpenDirectory,
  DialogSaveFile,
  DialogMessage,
  DialogConfirm
)

export type DialogRpc = RpcGroup.Rpcs<typeof DialogRpcGroup>

export const DialogRpcs: RpcGroup.RpcGroup<DialogRpc> = DialogRpcGroup

export const DialogMethodNames = Object.freeze([
  "openFile",
  "openDirectory",
  "saveFile",
  "message",
  "confirm"
] as const)
