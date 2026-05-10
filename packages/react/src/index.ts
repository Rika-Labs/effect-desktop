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

export {
  defineApi,
  mutation,
  query,
  stream,
  type MutationEndpoint,
  type QueryEndpoint,
  type QueryHook,
  type QueryResult,
  type ReactApiEndpoint,
  type StreamEndpoint,
  type StreamHook
} from "./api.js"

export {
  MissingDesktopContextError,
  MissingDesktopRpcClientError,
  ReactDesktop,
  type ReactDesktopAdapter,
  type ReactDesktopClientMap,
  type ReactDesktopRpcClient,
  type ReactDesktopRpcClientMethod,
  type ReactDesktopRootProps,
  type ReactDesktopRpcs
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
