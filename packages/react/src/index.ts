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

export type { HostProtocolError } from "@effect-desktop/bridge"
export type { WindowCreateOptions, WindowError, WindowHandle } from "@effect-desktop/native"
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode
} from "react"

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
