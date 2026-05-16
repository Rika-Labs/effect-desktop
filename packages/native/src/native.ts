import {
  Desktop,
  DesktopNativeRegistry,
  P,
  type DesktopNativeLayer,
  type DesktopNativeRegistration,
  type NormalizedCapability
} from "@effect-desktop/core"
import { Effect, Layer } from "effect"

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

export const surface = <RIn = never, E = never>(
  registration: DesktopNativeRegistration<E, RIn>
): DesktopNativeLayer =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* DesktopNativeRegistry
      yield* registry.register(registration)
    })
  )

export const app = surface(AppSurface)
export const clipboard = surface(ClipboardSurface)
export const contextMenu = surface(ContextMenuSurface)
export const crashReporter = surface(CrashReporterSurface)
export const dialog = surface(DialogSurface)
export const dock = surface(DockSurface)
export const globalShortcut = surface(GlobalShortcutSurface)
export const menu = surface(MenuSurface)
export const notification = surface(NotificationSurface)
export const path = surface(PathSurface)
export const powerMonitor = surface(PowerMonitorSurface)
export const protocol = surface(ProtocolSurface)
export const safeStorage = surface(SafeStorageSurface)
export const screen = surface(ScreenSurface)
export const shell = surface(ShellSurface)
export const systemAppearance = surface(SystemAppearanceSurface)
export const tray = surface(TraySurface)
export const updater = surface(UpdaterSurface)
export const webView = surface(WebViewSurface)
export const window = surface(WindowSurface)

export const all = Desktop.native(
  app,
  clipboard,
  contextMenu,
  crashReporter,
  dialog,
  dock,
  globalShortcut,
  menu,
  notification,
  path,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  shell,
  systemAppearance,
  tray,
  updater,
  webView,
  window
)

const nativePermission = (primitive: string, method: string): NormalizedCapability =>
  P.nativeInvoke({ primitive, methods: [method] })

export const Permissions = Object.freeze({
  clipboard: Object.freeze({
    readText: nativePermission("Clipboard", "readText"),
    writeText: nativePermission("Clipboard", "writeText"),
    readImage: nativePermission("Clipboard", "readImage"),
    writeImage: nativePermission("Clipboard", "writeImage"),
    clear: nativePermission("Clipboard", "clear")
  })
})

export const Native = Object.freeze({
  surface,
  app,
  clipboard,
  contextMenu,
  crashReporter,
  dialog,
  dock,
  globalShortcut,
  menu,
  notification,
  path,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  shell,
  systemAppearance,
  tray,
  updater,
  webView,
  window,
  all,
  Permissions
})
