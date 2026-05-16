import {
  Desktop,
  type DesktopNativeLayer,
  type AnyDesktopNativeRegistration
} from "@effect-desktop/core"

import { AppSurface } from "./app.js"
import { ClipboardSurface } from "./clipboard.js"
import { ContextMenuSurface } from "./context-menu.js"
import { CrashReporterSurface } from "./crash-reporter.js"
import { DialogSurface } from "./dialog.js"
import { DockSurface } from "./dock.js"
import { GlobalShortcutSurface } from "./global-shortcut.js"
import { MenuSurface } from "./menu.js"
import { NotificationSurface } from "./notification.js"
import { PathSurface } from "./path.js"
import { PowerMonitorSurface } from "./power-monitor.js"
import { ProtocolSurface } from "./protocol.js"
import { SafeStorageSurface } from "./safe-storage.js"
import { ScreenSurface } from "./screen.js"
import { ShellSurface } from "./shell.js"
import { SystemAppearanceSurface } from "./system-appearance.js"
import { TraySurface } from "./tray.js"
import { UpdaterSurface } from "./updater.js"
import { WebViewSurface } from "./webview.js"
import { WindowSurface } from "./window.js"
import {
  allCapabilitySelection,
  type NativeCapabilitySelection,
  type NativeSurfaceSelection
} from "./native-surface.js"

const BuiltInSurfaces = Object.freeze([
  AppSurface,
  ClipboardSurface,
  ContextMenuSurface,
  CrashReporterSurface,
  DialogSurface,
  DockSurface,
  GlobalShortcutSurface,
  MenuSurface,
  NotificationSurface,
  PathSurface,
  PowerMonitorSurface,
  ProtocolSurface,
  SafeStorageSurface,
  ScreenSurface,
  ShellSurface,
  SystemAppearanceSurface,
  TraySurface,
  UpdaterSurface,
  WebViewSurface,
  WindowSurface
]) satisfies readonly AnyDesktopNativeRegistration[]

export const available = (...selections: readonly NativeSurfaceSelection[]): DesktopNativeLayer =>
  Desktop.native(...selections)

export const capabilities = (
  ...selections: readonly NativeCapabilitySelection[]
): DesktopNativeLayer => Desktop.native(...selections)

const App = AppSurface.selection
const Clipboard = ClipboardSurface.selection
const ContextMenu = ContextMenuSurface.selection
const CrashReporter = CrashReporterSurface.selection
const Dialog = DialogSurface.selection
const Dock = DockSurface.selection
const GlobalShortcut = GlobalShortcutSurface.selection
const Menu = MenuSurface.selection
const Notification = NotificationSurface.selection
const Path = PathSurface.selection
const PowerMonitor = PowerMonitorSurface.selection
const Protocol = ProtocolSurface.selection
const SafeStorage = SafeStorageSurface.selection
const Screen = ScreenSurface.selection
const Shell = ShellSurface.selection
const SystemAppearance = SystemAppearanceSurface.selection
const Tray = TraySurface.selection
const Updater = UpdaterSurface.selection
const WebView = WebViewSurface.selection
const Window = WindowSurface.selection

export const all: NativeCapabilitySelection = allCapabilitySelection(BuiltInSurfaces)

export const Native = Object.freeze({
  App,
  Clipboard,
  ContextMenu,
  CrashReporter,
  Dialog,
  Dock,
  GlobalShortcut,
  Menu,
  Notification,
  Path,
  PowerMonitor,
  Protocol,
  SafeStorage,
  Screen,
  Shell,
  SystemAppearance,
  Tray,
  Updater,
  WebView,
  Window,
  all,
  capabilities,
  available
})

export type NativeApi = typeof Native
export type { NativeCapabilitySelection, NativeSurfaceSelection } from "./native-surface.js"
