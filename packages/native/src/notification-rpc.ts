import { type RpcSupportMetadata, RpcGroup } from "@orika/bridge"
import { Schema } from "effect"

import {
  NotificationActionEvent,
  NotificationClickEvent,
  NotificationCloseInput,
  NotificationPermissionResult,
  NotificationResource,
  NotificationShowInput,
  NotificationSupportedResult
} from "./contracts/notification.js"
import {
  nativeAuthority,
  nativeEvent,
  nativeRpc,
  NativeRpcSupport
} from "./native-rpc-descriptor.js"

export const NotificationPlatformSupport = NativeRpcSupport.partial(
  "host-notification-unavailable",
  {
    platforms: [
      { platform: "macos", status: "unsupported", reason: "host-notification-unavailable" },
      { platform: "windows", status: "unsupported", reason: "host-notification-unavailable" },
      { platform: "linux", status: "supported" }
    ]
  }
) satisfies RpcSupportMetadata

export const NotificationShow = nativeRpc("Notification", "show", {
  payload: NotificationShowInput,
  success: NotificationResource,
  authority: nativeAuthority.native("Notification"),
  endpoint: "mutation",
  support: NotificationPlatformSupport
})

export const NotificationClose = nativeRpc("Notification", "close", {
  payload: NotificationCloseInput,
  success: Schema.Void,
  authority: nativeAuthority.native("Notification"),
  endpoint: "mutation",
  support: NotificationPlatformSupport
})

export const NotificationIsSupported = nativeRpc("Notification", "isSupported", {
  payload: Schema.Void,
  success: NotificationSupportedResult,
  authority: nativeAuthority.none,
  endpoint: "query",
  support: NativeRpcSupport.supported
})

export const NotificationRequestPermission = nativeRpc("Notification", "requestPermission", {
  payload: Schema.Void,
  success: NotificationPermissionResult,
  authority: nativeAuthority.native("Notification"),
  endpoint: "mutation",
  support: NotificationPlatformSupport
})

export const NotificationGetPermissionStatus = nativeRpc("Notification", "getPermissionStatus", {
  payload: Schema.Void,
  success: NotificationPermissionResult,
  authority: nativeAuthority.none,
  endpoint: "query",
  support: NotificationPlatformSupport
})

export const NotificationClick = nativeEvent("Notification", "Click", {
  payload: NotificationClickEvent,
  support: NotificationPlatformSupport
})

export const NotificationAction = nativeEvent("Notification", "Action", {
  payload: NotificationActionEvent,
  support: NotificationPlatformSupport
})

const NotificationRpcGroup = RpcGroup.make(
  NotificationShow,
  NotificationClose,
  NotificationIsSupported,
  NotificationRequestPermission,
  NotificationGetPermissionStatus,
  NotificationClick,
  NotificationAction
)

export type NotificationRpc = RpcGroup.Rpcs<typeof NotificationRpcGroup>

export const NotificationRpcs: RpcGroup.RpcGroup<NotificationRpc> = NotificationRpcGroup

export const NotificationMethodNames = Object.freeze([
  "show",
  "close",
  "isSupported",
  "requestPermission",
  "getPermissionStatus"
] as const)

export const NotificationCapabilityMethods = Object.freeze([
  "show",
  "close",
  "requestPermission"
] as const satisfies readonly (typeof NotificationMethodNames)[number][])
