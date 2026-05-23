import { type RpcSupportMetadata, RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import {
  SystemAppearanceAccentColorResult,
  SystemAppearanceBooleanResult,
  SystemAppearanceChangedEvent,
  SystemAppearanceIsSupportedInput,
  SystemAppearanceResult,
  SystemAppearanceSupportedResult
} from "./contracts/system-appearance.js"
import { nativeAuthority, nativeRpc, NativeRpcSupport } from "./native-rpc-descriptor.js"

const UnsupportedReason = "host-adapter-unimplemented"
const HostSnapshotReason = "host-system-appearance-snapshot"

export const SystemAppearanceSnapshotSupport = NativeRpcSupport.partial(HostSnapshotReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "supported" },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
}) satisfies RpcSupportMetadata

export const SystemAppearanceGetAppearance = nativeRpc("SystemAppearance", "getAppearance", {
  payload: Schema.Void,
  success: SystemAppearanceResult,
  authority: nativeAuthority.native("SystemAppearance"),
  endpoint: "mutation",
  support: SystemAppearanceSnapshotSupport
})

export const SystemAppearanceGetAccentColor = nativeRpc("SystemAppearance", "getAccentColor", {
  payload: Schema.Void,
  success: SystemAppearanceAccentColorResult,
  authority: nativeAuthority.native("SystemAppearance"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const SystemAppearanceGetReducedMotion = nativeRpc("SystemAppearance", "getReducedMotion", {
  payload: Schema.Void,
  success: SystemAppearanceBooleanResult,
  authority: nativeAuthority.native("SystemAppearance"),
  endpoint: "mutation",
  support: SystemAppearanceSnapshotSupport
})

export const SystemAppearanceGetReducedTransparency = nativeRpc(
  "SystemAppearance",
  "getReducedTransparency",
  {
    payload: Schema.Void,
    success: SystemAppearanceBooleanResult,
    authority: nativeAuthority.native("SystemAppearance"),
    endpoint: "mutation",
    support: SystemAppearanceSnapshotSupport
  }
)

export const SystemAppearanceIsSupported = nativeRpc("SystemAppearance", "isSupported", {
  payload: SystemAppearanceIsSupportedInput,
  success: SystemAppearanceSupportedResult,
  authority: nativeAuthority.native("SystemAppearance"),
  endpoint: "mutation",
  support: NativeRpcSupport.supported
})

export const SystemAppearanceRpcEvents = Object.freeze({
  AppearanceChanged: { payload: SystemAppearanceChangedEvent }
})

export type SystemAppearanceRpcEvents = typeof SystemAppearanceRpcEvents

const SystemAppearanceRpcGroup = RpcGroup.make(
  SystemAppearanceGetAppearance,
  SystemAppearanceGetAccentColor,
  SystemAppearanceGetReducedMotion,
  SystemAppearanceGetReducedTransparency,
  SystemAppearanceIsSupported
)

export const SystemAppearanceRpcs: RpcGroup.RpcGroup<SystemAppearanceRpc> = SystemAppearanceRpcGroup

export const SystemAppearanceMethodNames = Object.freeze([
  "getAppearance",
  "getAccentColor",
  "getReducedMotion",
  "getReducedTransparency",
  "isSupported"
] as const)

export const SystemAppearanceCapabilityMethods = Object.freeze([
  "getAppearance",
  "getAccentColor",
  "getReducedMotion",
  "getReducedTransparency",
  "isSupported"
] as const satisfies readonly (typeof SystemAppearanceMethodNames)[number][])

export type SystemAppearanceRpc = RpcGroup.Rpcs<typeof SystemAppearanceRpcGroup>
