import { RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import {
  ScreenDisplay,
  ScreenDisplaysChangedEvent,
  ScreenDisplaysResult,
  ScreenIsSupportedInput,
  ScreenPoint,
  ScreenSupportedResult
} from "./contracts/screen.js"
import { nativeAuthority, nativeRpc, NativeRpcSupport } from "./native-rpc-descriptor.js"

export const ScreenGetDisplays = nativeRpc("Screen", "getDisplays", {
  payload: Schema.Void,
  success: ScreenDisplaysResult,
  authority: nativeAuthority.native("Screen"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ScreenGetPrimaryDisplay = nativeRpc("Screen", "getPrimaryDisplay", {
  payload: Schema.Void,
  success: ScreenDisplay,
  authority: nativeAuthority.native("Screen"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ScreenGetPointerPoint = nativeRpc("Screen", "getPointerPoint", {
  payload: Schema.Void,
  success: ScreenPoint,
  authority: nativeAuthority.native("Screen"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const ScreenIsSupported = nativeRpc("Screen", "isSupported", {
  payload: ScreenIsSupportedInput,
  success: ScreenSupportedResult,
  authority: nativeAuthority.none,
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

const ScreenRpcGroup = RpcGroup.make(
  ScreenGetDisplays,
  ScreenGetPrimaryDisplay,
  ScreenGetPointerPoint,
  ScreenIsSupported
)

export const ScreenRpcs: RpcGroup.RpcGroup<ScreenRpc> = ScreenRpcGroup

export const ScreenRpcEvents = Object.freeze({
  DisplaysChanged: { payload: ScreenDisplaysChangedEvent }
})

export type ScreenRpcEvents = typeof ScreenRpcEvents

export type ScreenRpc = RpcGroup.Rpcs<typeof ScreenRpcGroup>

export const ScreenMethodNames = Object.freeze([
  "getDisplays",
  "getPrimaryDisplay",
  "getPointerPoint",
  "isSupported"
] as const)

export const ScreenCapabilityMethods = Object.freeze([
  "getDisplays",
  "getPrimaryDisplay",
  "getPointerPoint"
] as const satisfies readonly (typeof ScreenMethodNames)[number][])
