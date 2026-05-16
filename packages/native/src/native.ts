import {
  Desktop,
  DesktopNativeRegistry,
  NormalizedCapability as NormalizedCapabilitySchema,
  type DesktopNativeLayer,
  type DesktopPermissionsLayer,
  type AnyDesktopNativeRegistration,
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
  readonly tag: string
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

export type NativePermissionGroup<Method extends string = string> = Readonly<
  Record<Method, NormalizedCapability> & {
    readonly all: readonly NormalizedCapability[]
  }
>

export interface NativePermissionsApi {
  readonly app: NativePermissionGroup<
    "quit" | "restart" | "focus" | "setOpenAtLogin" | "registerProtocol"
  >
  readonly clipboard: NativePermissionGroup<
    "readText" | "writeText" | "readImage" | "writeImage" | "clear"
  >
  readonly contextMenu: NativePermissionGroup<"show" | "buildFromTemplate" | "bindCommand">
  readonly crashReporter: NativePermissionGroup<"start" | "recordBreadcrumb" | "flush">
  readonly dialog: NativePermissionGroup<
    "openFile" | "openDirectory" | "saveFile" | "message" | "confirm"
  >
  readonly dock: NativePermissionGroup<
    | "setBadgeCount"
    | "setBadgeText"
    | "setProgress"
    | "setMenu"
    | "setJumpList"
    | "requestAttention"
  >
  readonly globalShortcut: NativePermissionGroup<"register" | "unregister" | "unregisterAll">
  readonly menu: NativePermissionGroup<
    "setApplicationMenu" | "setWindowMenu" | "clear" | "bindCommand"
  >
  readonly notification: NativePermissionGroup<"show" | "close" | "requestPermission">
  readonly path: NativePermissionGroup<"appData" | "cache" | "logs" | "temp" | "home" | "downloads">
  readonly powerMonitor: NativePermissionGroup<never>
  readonly protocol: NativePermissionGroup<
    "registerAppProtocol" | "serveAsset" | "serveRoute" | "deny"
  >
  readonly safeStorage: NativePermissionGroup<"set" | "get" | "delete" | "list">
  readonly screen: NativePermissionGroup<"getDisplays" | "getPrimaryDisplay" | "getPointerPoint">
  readonly shell: NativePermissionGroup<
    "openExternal" | "showItemInFolder" | "openPath" | "trashItem"
  >
  readonly systemAppearance: NativePermissionGroup<
    "getAppearance" | "getAccentColor" | "getReducedMotion" | "getReducedTransparency"
  >
  readonly tray: NativePermissionGroup<"create" | "setIcon" | "setTooltip" | "setMenu" | "destroy">
  readonly updater: NativePermissionGroup<
    "check" | "download" | "install" | "installAndRestart" | "getStatus" | "readyForRestart"
  >
  readonly webView: NativePermissionGroup<
    | "create"
    | "loadRoute"
    | "loadUrl"
    | "reload"
    | "goBack"
    | "goForward"
    | "captureScreenshot"
    | "setNavigationPolicy"
    | "destroy"
  >
  readonly window: NativePermissionGroup<"create" | "close">
  readonly all: readonly NormalizedCapability[]
}

export interface NativeApi {
  readonly surface: (registration: AnyDesktopNativeRegistration) => DesktopNativeLayer
  readonly app: DesktopNativeLayer
  readonly clipboard: DesktopNativeLayer
  readonly contextMenu: DesktopNativeLayer
  readonly crashReporter: DesktopNativeLayer
  readonly dialog: DesktopNativeLayer
  readonly dock: DesktopNativeLayer
  readonly globalShortcut: DesktopNativeLayer
  readonly menu: DesktopNativeLayer
  readonly notification: DesktopNativeLayer
  readonly path: DesktopNativeLayer
  readonly powerMonitor: DesktopNativeLayer
  readonly protocol: DesktopNativeLayer
  readonly safeStorage: DesktopNativeLayer
  readonly screen: DesktopNativeLayer
  readonly shell: DesktopNativeLayer
  readonly systemAppearance: DesktopNativeLayer
  readonly tray: DesktopNativeLayer
  readonly updater: DesktopNativeLayer
  readonly webView: DesktopNativeLayer
  readonly window: DesktopNativeLayer
  readonly all: DesktopNativeLayer
  readonly Permissions: NativePermissionsApi
  readonly permissions: (
    ...capabilities: readonly NormalizedCapability[]
  ) => DesktopPermissionsLayer
}

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

export const surface = (registration: AnyDesktopNativeRegistration): DesktopNativeLayer =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const nativeRegistry = yield* DesktopNativeRegistry
      yield* nativeRegistry.register(registration)
    })
  )

const defineSurface = (registration: AnyDesktopNativeRegistration): DesktopNativeLayer =>
  surface(registration)

export const app = defineSurface(AppSurface)
export const clipboard = defineSurface(ClipboardSurface)
export const contextMenu = defineSurface(ContextMenuSurface)
export const crashReporter = defineSurface(CrashReporterSurface)
export const dialog = defineSurface(DialogSurface)
export const dock = defineSurface(DockSurface)
export const globalShortcut = defineSurface(GlobalShortcutSurface)
export const menu = defineSurface(MenuSurface)
export const notification = defineSurface(NotificationSurface)
export const path = defineSurface(PathSurface)
export const powerMonitor = defineSurface(PowerMonitorSurface)
export const protocol = defineSurface(ProtocolSurface)
export const safeStorage = defineSurface(SafeStorageSurface)
export const screen = defineSurface(ScreenSurface)
export const shell = defineSurface(ShellSurface)
export const systemAppearance = defineSurface(SystemAppearanceSurface)
export const tray = defineSurface(TraySurface)
export const updater = defineSurface(UpdaterSurface)
export const webView = defineSurface(WebViewSurface)
export const window = defineSurface(WindowSurface)

export const all: DesktopNativeLayer = Desktop.native(...BuiltInSurfaces.map(surface))

const permissionCapability = (
  registration: NativePermissionSource,
  method: string
): NormalizedCapability => {
  const capability = permissionCapabilitiesByMethod(registration).get(method)
  if (capability === undefined) {
    throw new TypeError(
      `Native.Permissions.${registration.tag} cannot expose permission for unprivileged or unknown method ${JSON.stringify(method)}`
    )
  }
  return capability
}

export const permissions = (
  ...capabilities: readonly NormalizedCapability[]
): DesktopPermissionsLayer => Desktop.permissions(...capabilities.map(Desktop.permission))

const permissionGroup = <const Method extends string>(
  registration: NativePermissionSource,
  capabilities: Record<Method, NormalizedCapability>
): NativePermissionGroup<Method> =>
  Object.freeze({
    ...capabilities,
    all: allPermissionCapabilities([registration])
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
          `Native.${nativeSurface.tag} cannot declare non-normalized capability metadata for ${doc.tag}: ${capability.kind}`
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

const permissionCapabilitiesByMethod = (
  surfaceRegistration: NativePermissionSource
): ReadonlyMap<string, NormalizedCapability> => {
  const capabilities = new Map<string, NormalizedCapability>()

  for (const doc of surfaceRegistration.schemaDocs) {
    const method = methodNameFromTag(surfaceRegistration.tag, doc.tag)
    const capability = Option.getOrUndefined(doc.capability)
    if (capability === undefined || capability.kind === "none") {
      continue
    }

    const decoded = Schema.decodeUnknownOption(NormalizedCapabilitySchema)(capability)
    if (Option.isNone(decoded)) {
      throw new TypeError(
        `Native.${surfaceRegistration.tag} cannot declare non-normalized capability metadata for ${doc.tag}: ${capability.kind}`
      )
    }

    capabilities.set(method, decoded.value)
  }

  return capabilities
}

const methodNameFromTag = (surfaceTag: string, tag: string): string => {
  const prefix = `${surfaceTag}.`
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : tag
}

const AppPermissions = permissionGroup(AppSurface, {
  quit: permissionCapability(AppSurface, "quit"),
  restart: permissionCapability(AppSurface, "restart"),
  focus: permissionCapability(AppSurface, "focus"),
  setOpenAtLogin: permissionCapability(AppSurface, "setOpenAtLogin"),
  registerProtocol: permissionCapability(AppSurface, "registerProtocol")
})

const ClipboardPermissions = permissionGroup(ClipboardSurface, {
  readText: permissionCapability(ClipboardSurface, "readText"),
  writeText: permissionCapability(ClipboardSurface, "writeText"),
  readImage: permissionCapability(ClipboardSurface, "readImage"),
  writeImage: permissionCapability(ClipboardSurface, "writeImage"),
  clear: permissionCapability(ClipboardSurface, "clear")
})

const ContextMenuPermissions = permissionGroup(ContextMenuSurface, {
  show: permissionCapability(ContextMenuSurface, "show"),
  buildFromTemplate: permissionCapability(ContextMenuSurface, "buildFromTemplate"),
  bindCommand: permissionCapability(ContextMenuSurface, "bindCommand")
})

const CrashReporterPermissions = permissionGroup(CrashReporterSurface, {
  start: permissionCapability(CrashReporterSurface, "start"),
  recordBreadcrumb: permissionCapability(CrashReporterSurface, "recordBreadcrumb"),
  flush: permissionCapability(CrashReporterSurface, "flush")
})

const DialogPermissions = permissionGroup(DialogSurface, {
  openFile: permissionCapability(DialogSurface, "openFile"),
  openDirectory: permissionCapability(DialogSurface, "openDirectory"),
  saveFile: permissionCapability(DialogSurface, "saveFile"),
  message: permissionCapability(DialogSurface, "message"),
  confirm: permissionCapability(DialogSurface, "confirm")
})

const DockPermissions = permissionGroup(DockSurface, {
  setBadgeCount: permissionCapability(DockSurface, "setBadgeCount"),
  setBadgeText: permissionCapability(DockSurface, "setBadgeText"),
  setProgress: permissionCapability(DockSurface, "setProgress"),
  setMenu: permissionCapability(DockSurface, "setMenu"),
  setJumpList: permissionCapability(DockSurface, "setJumpList"),
  requestAttention: permissionCapability(DockSurface, "requestAttention")
})

const GlobalShortcutPermissions = permissionGroup(GlobalShortcutSurface, {
  register: permissionCapability(GlobalShortcutSurface, "register"),
  unregister: permissionCapability(GlobalShortcutSurface, "unregister"),
  unregisterAll: permissionCapability(GlobalShortcutSurface, "unregisterAll")
})

const MenuPermissions = permissionGroup(MenuSurface, {
  setApplicationMenu: permissionCapability(MenuSurface, "setApplicationMenu"),
  setWindowMenu: permissionCapability(MenuSurface, "setWindowMenu"),
  clear: permissionCapability(MenuSurface, "clear"),
  bindCommand: permissionCapability(MenuSurface, "bindCommand")
})

const NotificationPermissions = permissionGroup(NotificationSurface, {
  show: permissionCapability(NotificationSurface, "show"),
  close: permissionCapability(NotificationSurface, "close"),
  requestPermission: permissionCapability(NotificationSurface, "requestPermission")
})

const PathPermissions = permissionGroup(PathSurface, {
  appData: permissionCapability(PathSurface, "appData"),
  cache: permissionCapability(PathSurface, "cache"),
  logs: permissionCapability(PathSurface, "logs"),
  temp: permissionCapability(PathSurface, "temp"),
  home: permissionCapability(PathSurface, "home"),
  downloads: permissionCapability(PathSurface, "downloads")
})

const PowerMonitorPermissions = permissionGroup(PowerMonitorSurface, {})

const ProtocolPermissions = permissionGroup(ProtocolSurface, {
  registerAppProtocol: permissionCapability(ProtocolSurface, "registerAppProtocol"),
  serveAsset: permissionCapability(ProtocolSurface, "serveAsset"),
  serveRoute: permissionCapability(ProtocolSurface, "serveRoute"),
  deny: permissionCapability(ProtocolSurface, "deny")
})

const SafeStoragePermissions = permissionGroup(SafeStorageSurface, {
  set: permissionCapability(SafeStorageSurface, "set"),
  get: permissionCapability(SafeStorageSurface, "get"),
  delete: permissionCapability(SafeStorageSurface, "delete"),
  list: permissionCapability(SafeStorageSurface, "list")
})

const ScreenPermissions = permissionGroup(ScreenSurface, {
  getDisplays: permissionCapability(ScreenSurface, "getDisplays"),
  getPrimaryDisplay: permissionCapability(ScreenSurface, "getPrimaryDisplay"),
  getPointerPoint: permissionCapability(ScreenSurface, "getPointerPoint")
})

const ShellPermissions = permissionGroup(ShellSurface, {
  openExternal: permissionCapability(ShellSurface, "openExternal"),
  showItemInFolder: permissionCapability(ShellSurface, "showItemInFolder"),
  openPath: permissionCapability(ShellSurface, "openPath"),
  trashItem: permissionCapability(ShellSurface, "trashItem")
})

const SystemAppearancePermissions = permissionGroup(SystemAppearanceSurface, {
  getAppearance: permissionCapability(SystemAppearanceSurface, "getAppearance"),
  getAccentColor: permissionCapability(SystemAppearanceSurface, "getAccentColor"),
  getReducedMotion: permissionCapability(SystemAppearanceSurface, "getReducedMotion"),
  getReducedTransparency: permissionCapability(SystemAppearanceSurface, "getReducedTransparency")
})

const TrayPermissions = permissionGroup(TraySurface, {
  create: permissionCapability(TraySurface, "create"),
  setIcon: permissionCapability(TraySurface, "setIcon"),
  setTooltip: permissionCapability(TraySurface, "setTooltip"),
  setMenu: permissionCapability(TraySurface, "setMenu"),
  destroy: permissionCapability(TraySurface, "destroy")
})

const UpdaterPermissions = permissionGroup(UpdaterSurface, {
  check: permissionCapability(UpdaterSurface, "check"),
  download: permissionCapability(UpdaterSurface, "download"),
  install: permissionCapability(UpdaterSurface, "install"),
  installAndRestart: permissionCapability(UpdaterSurface, "installAndRestart"),
  getStatus: permissionCapability(UpdaterSurface, "getStatus"),
  readyForRestart: permissionCapability(UpdaterSurface, "readyForRestart")
})

const WebViewPermissions = permissionGroup(WebViewSurface, {
  create: permissionCapability(WebViewSurface, "create"),
  loadRoute: permissionCapability(WebViewSurface, "loadRoute"),
  loadUrl: permissionCapability(WebViewSurface, "loadUrl"),
  reload: permissionCapability(WebViewSurface, "reload"),
  goBack: permissionCapability(WebViewSurface, "goBack"),
  goForward: permissionCapability(WebViewSurface, "goForward"),
  captureScreenshot: permissionCapability(WebViewSurface, "captureScreenshot"),
  setNavigationPolicy: permissionCapability(WebViewSurface, "setNavigationPolicy"),
  destroy: permissionCapability(WebViewSurface, "destroy")
})

const WindowPermissions = permissionGroup(WindowSurface, {
  create: permissionCapability(WindowSurface, "create"),
  close: permissionCapability(WindowSurface, "close")
})

export const Permissions: NativePermissionsApi = Object.freeze({
  app: AppPermissions,
  clipboard: ClipboardPermissions,
  contextMenu: ContextMenuPermissions,
  crashReporter: CrashReporterPermissions,
  dialog: DialogPermissions,
  dock: DockPermissions,
  globalShortcut: GlobalShortcutPermissions,
  menu: MenuPermissions,
  notification: NotificationPermissions,
  path: PathPermissions,
  powerMonitor: PowerMonitorPermissions,
  protocol: ProtocolPermissions,
  safeStorage: SafeStoragePermissions,
  screen: ScreenPermissions,
  shell: ShellPermissions,
  systemAppearance: SystemAppearancePermissions,
  tray: TrayPermissions,
  updater: UpdaterPermissions,
  webView: WebViewPermissions,
  window: WindowPermissions,
  all: allPermissionCapabilities(BuiltInSurfaces)
})

export const Native: NativeApi = Object.freeze({
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
  Permissions,
  permissions
})
