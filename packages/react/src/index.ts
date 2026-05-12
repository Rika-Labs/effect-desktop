export {
  BrowserHttpClient,
  BrowserKeyValueStore,
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion
} from "./platform-browser.js"
export {
  RendererSqliteMemoryLive,
  RendererSqliteWorkerLive,
  SqliteWasmClient,
  SqlClient,
  SqlError,
  SqlModel,
  type RendererSqliteClient,
  type RendererSqliteMemoryOptions,
  type RendererSqliteWorkerOptions
} from "./sqlite-wasm.js"

export * as indexedDbStorage from "./storage/idb.js"
export * as keyValueStorage from "./storage/kv.js"
export type { HostProtocolError } from "@effect-desktop/bridge"
export type { WindowError } from "@effect-desktop/native"
export type { WindowCreateOptions, WindowHandle } from "@effect-desktop/native/contracts"

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
  useSetCurrentWindowTitleMutation,
  type CurrentWindowCloseMutation,
  type CurrentWindowSetTitleInput,
  type CurrentWindowSetTitleMutation
} from "./current-window.js"

export {
  windows,
  useCloseWindowMutation,
  useCreateWindowMutation,
  useSetWindowTitleMutation,
  type WindowCloseInput,
  type WindowCloseMutation,
  type WindowCreateMutation,
  type WindowSetTitleInput,
  type WindowSetTitleMutation
} from "./windows.js"

export { useAtom, useAtomValue, useAtomSet } from "./atoms.js"

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
  type ApprovalDecision,
  type ApprovalResolver,
  type PendingApproval,
  type PermissionApprovalPromptProps,
  type PermissionApprovalQueueProps,
  type PermissionApprovalState
} from "./permission-approval.js"
