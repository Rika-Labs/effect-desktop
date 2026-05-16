import {
  Desktop,
  DesktopNativeRegistry,
  NormalizedCapability as NormalizedCapabilitySchema,
  P,
  type DesktopNativeLayer,
  type DesktopNativeRegistration,
  type DesktopRpcSchemaDoc,
  type NormalizedCapability
} from "@effect-desktop/core"
import { Effect, Layer, Option, Schema } from "effect"

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

interface NativePermissionSource {
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

type NativeInvokeCapability = Extract<NormalizedCapability, { readonly kind: "native.invoke" }>

const BuiltInPermissionSources: readonly NativePermissionSource[] = Object.freeze([
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
])

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

const nativePermission = (primitive: string, method: string): NativeInvokeCapability =>
  P.nativeInvoke({ primitive, methods: [method] })

const permissionsLayer = (
  ...surfaces: readonly NativePermissionSource[]
): ReturnType<typeof Desktop.permissions> =>
  Desktop.permissions(...allPermissionCapabilities(surfaces).map(Desktop.permission))

const permissionGroup = (surface: NativePermissionSource) =>
  Object.freeze({
    all: permissionsLayer(surface)
  })

const allPermissionCapabilities = (
  surfaces: readonly NativePermissionSource[]
): readonly NormalizedCapability[] => {
  const permissions: NormalizedCapability[] = []
  const seen = new Set<string>()

  for (const nativeSurface of surfaces) {
    for (const doc of nativeSurface.schemaDocs) {
      const capability = Option.getOrUndefined(doc.capability)
      if (capability === undefined || capability.kind === "none") {
        continue
      }

      const decoded = Schema.decodeUnknownOption(NormalizedCapabilitySchema)(capability)
      if (Option.isNone(decoded)) {
        throw new TypeError(
          `Native.Permissions.all cannot declare non-normalized capability metadata for ${doc.tag}: ${capability.kind}`
        )
      }

      const key = JSON.stringify(decoded.value)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      permissions.push(decoded.value)
    }
  }

  return Object.freeze(permissions)
}

const allNativePermissionCapabilities = allPermissionCapabilities(BuiltInPermissionSources)

export const Permissions = Object.freeze({
  app: permissionGroup(AppSurface),
  clipboard: Object.freeze({
    ...permissionGroup(ClipboardSurface),
    readText: nativePermission("Clipboard", "readText"),
    writeText: nativePermission("Clipboard", "writeText"),
    readImage: nativePermission("Clipboard", "readImage"),
    writeImage: nativePermission("Clipboard", "writeImage"),
    clear: nativePermission("Clipboard", "clear")
  }),
  contextMenu: permissionGroup(ContextMenuSurface),
  crashReporter: permissionGroup(CrashReporterSurface),
  dialog: permissionGroup(DialogSurface),
  dock: permissionGroup(DockSurface),
  globalShortcut: permissionGroup(GlobalShortcutSurface),
  menu: permissionGroup(MenuSurface),
  notification: permissionGroup(NotificationSurface),
  path: permissionGroup(PathSurface),
  powerMonitor: permissionGroup(PowerMonitorSurface),
  protocol: permissionGroup(ProtocolSurface),
  safeStorage: permissionGroup(SafeStorageSurface),
  screen: permissionGroup(ScreenSurface),
  shell: permissionGroup(ShellSurface),
  systemAppearance: permissionGroup(SystemAppearanceSurface),
  tray: permissionGroup(TraySurface),
  updater: permissionGroup(UpdaterSurface),
  webView: permissionGroup(WebViewSurface),
  window: permissionGroup(WindowSurface),
  all: Desktop.permissions(...allNativePermissionCapabilities.map(Desktop.permission))
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
