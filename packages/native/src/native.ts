import {
  Desktop,
  type DesktopNativeLayer,
  type AnyDesktopNativeRegistration
} from "@effect-desktop/core"

import { AppSurface } from "./app.js"
import { ClipboardSurface } from "./clipboard.js"
import { ContextMenuSurface } from "./context-menu.js"
import { CrashReporterSurface } from "./crash-reporter.js"
import { DiagnosticsBundleSurface } from "./diagnostics-bundle.js"
import { DialogSurface } from "./dialog.js"
import { EgressPolicySurface } from "./egress-policy.js"
import { ExecutionSandboxSurface } from "./execution-sandbox.js"
import { DockSurface } from "./dock.js"
import { GlobalShortcutSurface } from "./global-shortcut.js"
import { MenuSurface } from "./menu.js"
import { NotificationSurface } from "./notification.js"
import { PathSurface } from "./path.js"
import { PowerMonitorSurface } from "./power-monitor.js"
import { ProtocolSurface } from "./protocol.js"
import { RealtimeMediaSessionSurface } from "./realtime-media-session.js"
import { SafeStorageSurface } from "./safe-storage.js"
import { ScreenSurface } from "./screen.js"
import { ShellSurface } from "./shell.js"
import { SystemAppearanceSurface } from "./system-appearance.js"
import { TraySurface } from "./tray.js"
import { UpdaterSurface } from "./updater.js"
import { WebViewSurface } from "./webview.js"
import { WindowSurface } from "./window.js"
import type { NativeSurfaceSelection } from "./native-surface.js"

const BuiltInSurfaces = Object.freeze([
  AppSurface,
  ClipboardSurface,
  ContextMenuSurface,
  CrashReporterSurface,
  DiagnosticsBundleSurface,
  DialogSurface,
  EgressPolicySurface,
  ExecutionSandboxSurface,
  DockSurface,
  GlobalShortcutSurface,
  MenuSurface,
  NotificationSurface,
  PathSurface,
  PowerMonitorSurface,
  ProtocolSurface,
  RealtimeMediaSessionSurface,
  SafeStorageSurface,
  ScreenSurface,
  ShellSurface,
  SystemAppearanceSurface,
  TraySurface,
  UpdaterSurface,
  WebViewSurface,
  WindowSurface
])

const BuiltInRegistrations = Object.freeze([
  ...BuiltInSurfaces
]) satisfies readonly AnyDesktopNativeRegistration[]

export const available = (...selections: readonly NativeSurfaceSelection[]): DesktopNativeLayer =>
  Desktop.native(...selections)

const App = AppSurface.selection
const Clipboard = ClipboardSurface.selection
const ContextMenu = ContextMenuSurface.selection
const CrashReporter = CrashReporterSurface.selection
const DiagnosticsBundle = DiagnosticsBundleSurface.selection
const Dialog = DialogSurface.selection
const EgressPolicy = EgressPolicySurface.selection
const ExecutionSandbox = ExecutionSandboxSurface.selection
const Dock = DockSurface.selection
const GlobalShortcut = GlobalShortcutSurface.selection
const Menu = MenuSurface.selection
const Notification = NotificationSurface.selection
const Path = PathSurface.selection
const PowerMonitor = PowerMonitorSurface.selection
const Protocol = ProtocolSurface.selection
const RealtimeMediaSession = RealtimeMediaSessionSurface.selection
const SafeStorage = SafeStorageSurface.selection
const Screen = ScreenSurface.selection
const Shell = ShellSurface.selection
const SystemAppearance = SystemAppearanceSurface.selection
const Tray = TraySurface.selection
const Updater = UpdaterSurface.selection
const WebView = WebViewSurface.selection
const Window = WindowSurface.selection

export const all: NativeSurfaceSelection = Object.freeze({
  _tag: "NativeSurfaceSelection" as const,
  surfaces: BuiltInRegistrations
})

const permissionAll = Object.freeze(BuiltInSurfaces.flatMap((surface) => surface.permissions.all))

export const Permissions = Object.freeze({
  app: AppSurface.permissions,
  clipboard: ClipboardSurface.permissions,
  contextMenu: ContextMenuSurface.permissions,
  crashReporter: CrashReporterSurface.permissions,
  diagnosticsBundle: DiagnosticsBundleSurface.permissions,
  dialog: DialogSurface.permissions,
  egressPolicy: EgressPolicySurface.permissions,
  executionSandbox: ExecutionSandboxSurface.permissions,
  dock: DockSurface.permissions,
  globalShortcut: GlobalShortcutSurface.permissions,
  menu: MenuSurface.permissions,
  notification: NotificationSurface.permissions,
  path: PathSurface.permissions,
  powerMonitor: PowerMonitorSurface.permissions,
  protocol: ProtocolSurface.permissions,
  realtimeMediaSession: RealtimeMediaSessionSurface.permissions,
  safeStorage: SafeStorageSurface.permissions,
  screen: ScreenSurface.permissions,
  shell: ShellSurface.permissions,
  systemAppearance: SystemAppearanceSurface.permissions,
  tray: TraySurface.permissions,
  updater: UpdaterSurface.permissions,
  webView: WebViewSurface.permissions,
  window: WindowSurface.permissions,
  all: permissionAll
})

export const Native = Object.freeze({
  App,
  Clipboard,
  ContextMenu,
  CrashReporter,
  DiagnosticsBundle,
  Dialog,
  EgressPolicy,
  ExecutionSandbox,
  Dock,
  GlobalShortcut,
  Menu,
  Notification,
  Path,
  PowerMonitor,
  Protocol,
  RealtimeMediaSession,
  SafeStorage,
  Screen,
  Shell,
  SystemAppearance,
  Tray,
  Updater,
  WebView,
  Window,
  Permissions,
  all,
  available
})

export type NativeApi = typeof Native
export type { NativePermissionsApi, NativeSurfaceSelection } from "./native-surface.js"
