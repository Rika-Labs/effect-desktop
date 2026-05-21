export type { HostProtocolError } from "@orika/bridge"
export type { WindowError } from "@orika/native"
export type { WindowCreateOptions, WindowHandle } from "@orika/native/contracts"

export { AsyncResult, Atom } from "effect/unstable/reactivity"

export {
  createUnavailableDesktopClient,
  DesktopProvider,
  useDesktop,
  useDesktopClient,
  useOptionalDesktopClient,
  useWindow,
  type DesktopClient,
  type DesktopProviderProps,
  type DesktopRuntimeContext,
  type DesktopWindowClient
} from "./provider.js"

export {
  MissingDesktopContextError,
  MissingDesktopRpcClientError,
  ReactDesktop,
  type ReactDesktopAdapter,
  type ReactDesktopClientMap,
  type ReactDesktopRpcClient,
  type ReactDesktopRpcClientMethod,
  type ReactDesktopRootProps,
  type ReactDesktopRpcs,
  type ReactDesktopSupport
} from "./desktop.js"

export {
  useMutation,
  type MutationResult,
  type MutationRun,
  type MutationRunPromise,
  type MutationState,
  type MutationStatus
} from "./mutation.js"

export {
  currentWindow,
  useCloseCurrentWindowMutation,
  useCurrentWindow,
  useCurrentWindowId,
  type CurrentWindowCloseMutation
} from "./current-window.js"

export {
  windows,
  useCloseWindowMutation,
  useCreateWindowMutation,
  type WindowCloseInput,
  type WindowCloseMutation,
  type WindowCreateMutation
} from "./windows.js"

export {
  RegistryContext as DesktopAtomRegistryContext,
  RegistryProvider as DesktopAtomRegistryProvider,
  useAtom,
  useAtomInitialValues,
  useAtomMount,
  useAtomRefresh,
  useAtomSet,
  useAtomSubscribe,
  useAtomSuspense,
  useAtomValue
} from "@effect/atom-react"

export {
  useDesktopStream,
  useSubscribable,
  useEffectResult,
  type DesktopStreamOptions,
  type StreamState,
  type StreamStatus
} from "./hooks/stream.js"

export type { QueryResult } from "./endpoints.js"

export {
  statusOf,
  useDesktopAction,
  useDesktopQuery,
  useDesktopResource,
  useResource,
  type DesktopAction,
  type DesktopActionConcurrency,
  type DesktopActionOptions,
  type DesktopAsyncState,
  type DesktopAsyncStatus,
  type DesktopDisposable,
  type DesktopQuery,
  type DesktopResourceState
} from "./hooks/desktop.js"

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
  type ApprovalResolver,
  type ApprovalResolution,
  type PendingApproval,
  type PermissionApprovalPromptProps,
  type PermissionApprovalQueueProps,
  type PermissionApprovalState
} from "./permission-approval.js"
