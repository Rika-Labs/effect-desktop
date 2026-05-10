export type { HostProtocolError } from "@effect-desktop/bridge"
export type { WindowCreateOptions, WindowError, WindowHandle } from "@effect-desktop/native"

export { AsyncResult, Atom } from "effect/unstable/reactivity"

export {
  DesktopProvider,
  useDesktop,
  useWindow,
  type DesktopClient,
  type DesktopProviderProps,
  type DesktopRuntimeContext,
  type DesktopWindowClient
} from "./provider.js"

export { useAtom, useAtomValue, useAtomSet } from "./atoms.js"

export {
  useStream,
  useSubscribable,
  useEffectResult,
  type StreamState,
  type StreamStatus
} from "./hooks/stream.js"

export {
  useTheme,
  useThemeMode,
  usePower,
  useDisplays,
  type ThemeState,
  type PowerState,
  type PowerEvent,
  type DisplaysResult,
  type ThemeMode
} from "./hooks/native.js"

export { usePermission, type PermissionState } from "./permission.js"

export {
  PermissionApprovalQueue,
  useApprovalNotifications,
  usePermissionApproval,
  type ApprovalDecision,
  type ApprovalResolver,
  type PendingApproval,
  type PermissionApprovalPromptProps,
  type PermissionApprovalQueueProps,
  type PermissionApprovalState
} from "./permission-approval.js"
