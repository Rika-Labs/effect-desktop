import {
  Desktop,
  DesktopNativeRegistry,
  DesktopPermissionRegistry,
  NormalizedCapability as NormalizedCapabilitySchema,
  type DesktopNativeLayer,
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

interface NativeSurfaceSource {
  readonly tag: string
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

export interface NativeSurfaceSelection {
  readonly _tag: "NativeSurfaceSelection" | "NativeCapabilitySelection"
  readonly surfaces: readonly AnyDesktopNativeRegistration[]
}

export interface NativeCapabilitySelection extends NativeSurfaceSelection {
  readonly _tag: "NativeCapabilitySelection"
  readonly permissions: readonly NormalizedCapability[]
}

type NativeSurfaceApi<Method extends string = string> = Readonly<
  NativeSurfaceSelection &
    Record<Method, NativeCapabilitySelection> & {
      readonly all: NativeCapabilitySelection
    }
>

export interface NativeApi {
  readonly App: NativeSurfaceApi<
    "quit" | "restart" | "focus" | "setOpenAtLogin" | "registerProtocol"
  >
  readonly Clipboard: NativeSurfaceApi<
    "readText" | "writeText" | "readImage" | "writeImage" | "clear"
  >
  readonly ContextMenu: NativeSurfaceApi<"show" | "buildFromTemplate" | "bindCommand">
  readonly CrashReporter: NativeSurfaceApi<"start" | "recordBreadcrumb" | "flush">
  readonly Dialog: NativeSurfaceApi<
    "openFile" | "openDirectory" | "saveFile" | "message" | "confirm"
  >
  readonly Dock: NativeSurfaceApi<
    | "setBadgeCount"
    | "setBadgeText"
    | "setProgress"
    | "setMenu"
    | "setJumpList"
    | "requestAttention"
  >
  readonly GlobalShortcut: NativeSurfaceApi<"register" | "unregister" | "unregisterAll">
  readonly Menu: NativeSurfaceApi<"setApplicationMenu" | "setWindowMenu" | "clear" | "bindCommand">
  readonly Notification: NativeSurfaceApi<"show" | "close" | "requestPermission">
  readonly Path: NativeSurfaceApi<"appData" | "cache" | "logs" | "temp" | "home" | "downloads">
  readonly PowerMonitor: NativeSurfaceApi<never>
  readonly Protocol: NativeSurfaceApi<"registerAppProtocol" | "serveAsset" | "serveRoute" | "deny">
  readonly SafeStorage: NativeSurfaceApi<"set" | "get" | "delete" | "list">
  readonly Screen: NativeSurfaceApi<"getDisplays" | "getPrimaryDisplay" | "getPointerPoint">
  readonly Shell: NativeSurfaceApi<"openExternal" | "showItemInFolder" | "openPath" | "trashItem">
  readonly SystemAppearance: NativeSurfaceApi<
    "getAppearance" | "getAccentColor" | "getReducedMotion" | "getReducedTransparency"
  >
  readonly Tray: NativeSurfaceApi<"create" | "setIcon" | "setTooltip" | "setMenu" | "destroy">
  readonly Updater: NativeSurfaceApi<
    "check" | "download" | "install" | "installAndRestart" | "getStatus" | "readyForRestart"
  >
  readonly WebView: NativeSurfaceApi<
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
  readonly Window: NativeSurfaceApi<"create" | "close">
  readonly all: NativeCapabilitySelection
  readonly capabilities: (...tokens: readonly NativeCapabilitySelection[]) => DesktopNativeLayer
  readonly available: (...surfaces: readonly NativeSurfaceSelection[]) => DesktopNativeLayer
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

const registerSurface = (registration: AnyDesktopNativeRegistration): DesktopNativeLayer =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const nativeRegistry = yield* DesktopNativeRegistry
      yield* nativeRegistry.register(registration)
    })
  )

const registerPermissions = (permissions: readonly NormalizedCapability[]): DesktopNativeLayer =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const permissionRegistry = yield* DesktopPermissionRegistry
      for (const permission of permissions) {
        yield* permissionRegistry.register(permission)
      }
    })
  )

const permissionCapability = (
  registration: NativeSurfaceSource,
  method: string
): NormalizedCapability => {
  const capability = permissionCapabilitiesByMethod(registration).get(method)
  if (capability === undefined) {
    throw new TypeError(
      `Native.${registration.tag} cannot expose capability for unprivileged or unknown method ${JSON.stringify(method)}`
    )
  }
  return capability
}

const surfaceSelection = (registration: AnyDesktopNativeRegistration): NativeSurfaceSelection =>
  Object.freeze({
    _tag: "NativeSurfaceSelection" as const,
    surfaces: Object.freeze([registration])
  })

const capabilitySelection = (
  registration: AnyDesktopNativeRegistration,
  permissions: readonly NormalizedCapability[]
): NativeCapabilitySelection =>
  Object.freeze({
    _tag: "NativeCapabilitySelection" as const,
    surfaces: Object.freeze([registration]),
    permissions: Object.freeze([...permissions])
  })

const surfaceCapability = (
  registration: AnyDesktopNativeRegistration,
  method: string
): NativeCapabilitySelection =>
  capabilitySelection(registration, [permissionCapability(registration, method)])

const nativeSurface = <const Method extends string>(
  registration: AnyDesktopNativeRegistration,
  capabilities: Record<Method, NativeCapabilitySelection>
): NativeSurfaceApi<Method> =>
  Object.freeze({
    ...surfaceSelection(registration),
    ...capabilities,
    all: capabilitySelection(registration, allPermissionCapabilities([registration]))
  })

const allCapabilitySelection = (
  surfaces: readonly AnyDesktopNativeRegistration[]
): NativeCapabilitySelection =>
  Object.freeze({
    _tag: "NativeCapabilitySelection" as const,
    surfaces: Object.freeze([...surfaces]),
    permissions: allPermissionCapabilities(surfaces)
  })

const allPermissionCapabilities = (
  surfaces: readonly NativeSurfaceSource[]
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
  surfaceRegistration: NativeSurfaceSource
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

const dedupeSurfaces = (
  selections: readonly NativeSurfaceSelection[]
): readonly AnyDesktopNativeRegistration[] => {
  const surfaces: AnyDesktopNativeRegistration[] = []
  const seen = new Set<string>()

  for (const selection of selections) {
    for (const nativeSurface of selection.surfaces) {
      if (seen.has(nativeSurface.tag)) {
        continue
      }
      seen.add(nativeSurface.tag)
      surfaces.push(nativeSurface)
    }
  }

  return Object.freeze(surfaces)
}

const dedupePermissions = (
  selections: readonly NativeCapabilitySelection[]
): readonly NormalizedCapability[] => {
  const permissions: NormalizedCapability[] = []
  const seen = new Set<string>()

  for (const selection of selections) {
    for (const permission of selection.permissions) {
      const key = JSON.stringify(permission)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      permissions.push(permission)
    }
  }

  return Object.freeze(permissions)
}

export const available = (...selections: readonly NativeSurfaceSelection[]): DesktopNativeLayer =>
  Desktop.native(...dedupeSurfaces(selections).map(registerSurface))

export const capabilities = (
  ...selections: readonly NativeCapabilitySelection[]
): DesktopNativeLayer =>
  Desktop.native(
    ...dedupeSurfaces(selections).map(registerSurface),
    registerPermissions(dedupePermissions(selections))
  )

const App = nativeSurface(AppSurface, {
  quit: surfaceCapability(AppSurface, "quit"),
  restart: surfaceCapability(AppSurface, "restart"),
  focus: surfaceCapability(AppSurface, "focus"),
  setOpenAtLogin: surfaceCapability(AppSurface, "setOpenAtLogin"),
  registerProtocol: surfaceCapability(AppSurface, "registerProtocol")
})

const Clipboard = nativeSurface(ClipboardSurface, {
  readText: surfaceCapability(ClipboardSurface, "readText"),
  writeText: surfaceCapability(ClipboardSurface, "writeText"),
  readImage: surfaceCapability(ClipboardSurface, "readImage"),
  writeImage: surfaceCapability(ClipboardSurface, "writeImage"),
  clear: surfaceCapability(ClipboardSurface, "clear")
})

const ContextMenu = nativeSurface(ContextMenuSurface, {
  show: surfaceCapability(ContextMenuSurface, "show"),
  buildFromTemplate: surfaceCapability(ContextMenuSurface, "buildFromTemplate"),
  bindCommand: surfaceCapability(ContextMenuSurface, "bindCommand")
})

const CrashReporter = nativeSurface(CrashReporterSurface, {
  start: surfaceCapability(CrashReporterSurface, "start"),
  recordBreadcrumb: surfaceCapability(CrashReporterSurface, "recordBreadcrumb"),
  flush: surfaceCapability(CrashReporterSurface, "flush")
})

const Dialog = nativeSurface(DialogSurface, {
  openFile: surfaceCapability(DialogSurface, "openFile"),
  openDirectory: surfaceCapability(DialogSurface, "openDirectory"),
  saveFile: surfaceCapability(DialogSurface, "saveFile"),
  message: surfaceCapability(DialogSurface, "message"),
  confirm: surfaceCapability(DialogSurface, "confirm")
})

const Dock = nativeSurface(DockSurface, {
  setBadgeCount: surfaceCapability(DockSurface, "setBadgeCount"),
  setBadgeText: surfaceCapability(DockSurface, "setBadgeText"),
  setProgress: surfaceCapability(DockSurface, "setProgress"),
  setMenu: surfaceCapability(DockSurface, "setMenu"),
  setJumpList: surfaceCapability(DockSurface, "setJumpList"),
  requestAttention: surfaceCapability(DockSurface, "requestAttention")
})

const GlobalShortcut = nativeSurface(GlobalShortcutSurface, {
  register: surfaceCapability(GlobalShortcutSurface, "register"),
  unregister: surfaceCapability(GlobalShortcutSurface, "unregister"),
  unregisterAll: surfaceCapability(GlobalShortcutSurface, "unregisterAll")
})

const Menu = nativeSurface(MenuSurface, {
  setApplicationMenu: surfaceCapability(MenuSurface, "setApplicationMenu"),
  setWindowMenu: surfaceCapability(MenuSurface, "setWindowMenu"),
  clear: surfaceCapability(MenuSurface, "clear"),
  bindCommand: surfaceCapability(MenuSurface, "bindCommand")
})

const Notification = nativeSurface(NotificationSurface, {
  show: surfaceCapability(NotificationSurface, "show"),
  close: surfaceCapability(NotificationSurface, "close"),
  requestPermission: surfaceCapability(NotificationSurface, "requestPermission")
})

const Path = nativeSurface(PathSurface, {
  appData: surfaceCapability(PathSurface, "appData"),
  cache: surfaceCapability(PathSurface, "cache"),
  logs: surfaceCapability(PathSurface, "logs"),
  temp: surfaceCapability(PathSurface, "temp"),
  home: surfaceCapability(PathSurface, "home"),
  downloads: surfaceCapability(PathSurface, "downloads")
})

const PowerMonitor = nativeSurface(PowerMonitorSurface, {})

const Protocol = nativeSurface(ProtocolSurface, {
  registerAppProtocol: surfaceCapability(ProtocolSurface, "registerAppProtocol"),
  serveAsset: surfaceCapability(ProtocolSurface, "serveAsset"),
  serveRoute: surfaceCapability(ProtocolSurface, "serveRoute"),
  deny: surfaceCapability(ProtocolSurface, "deny")
})

const SafeStorage = nativeSurface(SafeStorageSurface, {
  set: surfaceCapability(SafeStorageSurface, "set"),
  get: surfaceCapability(SafeStorageSurface, "get"),
  delete: surfaceCapability(SafeStorageSurface, "delete"),
  list: surfaceCapability(SafeStorageSurface, "list")
})

const Screen = nativeSurface(ScreenSurface, {
  getDisplays: surfaceCapability(ScreenSurface, "getDisplays"),
  getPrimaryDisplay: surfaceCapability(ScreenSurface, "getPrimaryDisplay"),
  getPointerPoint: surfaceCapability(ScreenSurface, "getPointerPoint")
})

const Shell = nativeSurface(ShellSurface, {
  openExternal: surfaceCapability(ShellSurface, "openExternal"),
  showItemInFolder: surfaceCapability(ShellSurface, "showItemInFolder"),
  openPath: surfaceCapability(ShellSurface, "openPath"),
  trashItem: surfaceCapability(ShellSurface, "trashItem")
})

const SystemAppearance = nativeSurface(SystemAppearanceSurface, {
  getAppearance: surfaceCapability(SystemAppearanceSurface, "getAppearance"),
  getAccentColor: surfaceCapability(SystemAppearanceSurface, "getAccentColor"),
  getReducedMotion: surfaceCapability(SystemAppearanceSurface, "getReducedMotion"),
  getReducedTransparency: surfaceCapability(SystemAppearanceSurface, "getReducedTransparency")
})

const Tray = nativeSurface(TraySurface, {
  create: surfaceCapability(TraySurface, "create"),
  setIcon: surfaceCapability(TraySurface, "setIcon"),
  setTooltip: surfaceCapability(TraySurface, "setTooltip"),
  setMenu: surfaceCapability(TraySurface, "setMenu"),
  destroy: surfaceCapability(TraySurface, "destroy")
})

const Updater = nativeSurface(UpdaterSurface, {
  check: surfaceCapability(UpdaterSurface, "check"),
  download: surfaceCapability(UpdaterSurface, "download"),
  install: surfaceCapability(UpdaterSurface, "install"),
  installAndRestart: surfaceCapability(UpdaterSurface, "installAndRestart"),
  getStatus: surfaceCapability(UpdaterSurface, "getStatus"),
  readyForRestart: surfaceCapability(UpdaterSurface, "readyForRestart")
})

const WebView = nativeSurface(WebViewSurface, {
  create: surfaceCapability(WebViewSurface, "create"),
  loadRoute: surfaceCapability(WebViewSurface, "loadRoute"),
  loadUrl: surfaceCapability(WebViewSurface, "loadUrl"),
  reload: surfaceCapability(WebViewSurface, "reload"),
  goBack: surfaceCapability(WebViewSurface, "goBack"),
  goForward: surfaceCapability(WebViewSurface, "goForward"),
  captureScreenshot: surfaceCapability(WebViewSurface, "captureScreenshot"),
  setNavigationPolicy: surfaceCapability(WebViewSurface, "setNavigationPolicy"),
  destroy: surfaceCapability(WebViewSurface, "destroy")
})

const Window = nativeSurface(WindowSurface, {
  create: surfaceCapability(WindowSurface, "create"),
  close: surfaceCapability(WindowSurface, "close")
})

export const all: NativeCapabilitySelection = allCapabilitySelection(BuiltInSurfaces)

export const Native: NativeApi = Object.freeze({
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
