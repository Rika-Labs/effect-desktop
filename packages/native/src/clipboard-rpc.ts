import { RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import {
  ClipboardHtml,
  ClipboardImage,
  ClipboardIsSupportedInput,
  ClipboardSupportedResult,
  ClipboardText
} from "./contracts/clipboard.js"
import { nativeAuthority, nativeRpc, NativeRpcSupport } from "./native-rpc-descriptor.js"

export const ClipboardReadText = nativeRpc("Clipboard", "readText", {
  payload: Schema.Void,
  success: ClipboardText,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "query",
  support: NativeRpcSupport.supported
})

export const ClipboardWriteText = nativeRpc("Clipboard", "writeText", {
  payload: ClipboardText,
  success: Schema.Void,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ClipboardReadHtml = nativeRpc("Clipboard", "readHtml", {
  payload: Schema.Void,
  success: ClipboardHtml,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "query",
  support: NativeRpcSupport.supported
})

export const ClipboardWriteHtml = nativeRpc("Clipboard", "writeHtml", {
  payload: ClipboardHtml,
  success: Schema.Void,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ClipboardReadImage = nativeRpc("Clipboard", "readImage", {
  payload: Schema.Void,
  success: ClipboardImage,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "query",
  support: NativeRpcSupport.supported
})

export const ClipboardWriteImage = nativeRpc("Clipboard", "writeImage", {
  payload: ClipboardImage,
  success: Schema.Void,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ClipboardClear = nativeRpc("Clipboard", "clear", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: nativeAuthority.native("Clipboard"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ClipboardIsSupported = nativeRpc("Clipboard", "isSupported", {
  payload: ClipboardIsSupportedInput,
  success: ClipboardSupportedResult,
  authority: nativeAuthority.none,
  endpoint: "query",
  support: NativeRpcSupport.supported
})

const ClipboardRpcGroup = RpcGroup.make(
  ClipboardReadText,
  ClipboardWriteText,
  ClipboardReadHtml,
  ClipboardWriteHtml,
  ClipboardReadImage,
  ClipboardWriteImage,
  ClipboardClear,
  ClipboardIsSupported
)

export type ClipboardRpc = RpcGroup.Rpcs<typeof ClipboardRpcGroup>

export const ClipboardRpcs: RpcGroup.RpcGroup<ClipboardRpc> = ClipboardRpcGroup

export const ClipboardMethodNames = Object.freeze([
  "readText",
  "writeText",
  "readHtml",
  "writeHtml",
  "readImage",
  "writeImage",
  "clear",
  "isSupported"
] as const)

export const ClipboardCapabilityMethods = Object.freeze([
  "readText",
  "writeText",
  "readHtml",
  "writeHtml",
  "readImage",
  "writeImage",
  "clear"
] as const satisfies readonly (typeof ClipboardMethodNames)[number][])
