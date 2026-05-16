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

import { AppMethodNames, AppSurface } from "./app.js"
import { ClipboardMethodNames, ClipboardSurface } from "./clipboard.js"
import { ContextMenuMethodNames, ContextMenuSurface } from "./context-menu.js"
import { CrashReporterMethodNames, CrashReporterSurface } from "./crash-reporter.js"
import { DialogMethodNames, DialogSurface } from "./dialog.js"
import { DockMethodNames, DockSurface } from "./dock.js"
import { GlobalShortcutMethodNames, GlobalShortcutSurface } from "./global-shortcut.js"
import { MenuMethodNames, MenuSurface } from "./menu.js"
import { NotificationMethodNames, NotificationSurface } from "./notification.js"
import { PathMethodNames, PathSurface } from "./path.js"
import { PowerMonitorMethodNames, PowerMonitorSurface } from "./power-monitor.js"
import { ProtocolMethodNames, ProtocolSurface } from "./protocol.js"
import { SafeStorageMethodNames, SafeStorageSurface } from "./safe-storage.js"
import { ScreenMethodNames, ScreenSurface } from "./screen.js"
import { ShellMethodNames, ShellSurface } from "./shell.js"
import { SystemAppearanceMethodNames, SystemAppearanceSurface } from "./system-appearance.js"
import { TrayMethodNames, TraySurface } from "./tray.js"
import { UpdaterMethodNames, UpdaterSurface } from "./updater.js"
import { WebViewMethodNames, WebViewSurface } from "./webview.js"
import { WindowMethodNames, WindowSurface } from "./window.js"

interface NativePermissionSource {
  readonly tag: string
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

export interface NativeSelectionOptions<Method extends string = string> {
  readonly permissions?: "all" | readonly Method[]
}

export interface NativeAllSelectionOptions {
  readonly permissions?: "all"
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

export const surface = (
  registration: AnyDesktopNativeRegistration,
  options: NativeSelectionOptions = {}
): DesktopNativeLayer =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const nativeRegistry = yield* DesktopNativeRegistry
      yield* nativeRegistry.register(registration)

      const permissionRegistry = yield* DesktopPermissionRegistry
      yield* Effect.forEach(
        selectedPermissionCapabilities(registration, options.permissions),
        (capability) => permissionRegistry.register(capability),
        { discard: true }
      )
    })
  )

const defineSurface =
  <const Methods extends readonly string[]>(
    registration: AnyDesktopNativeRegistration,
    _methodNames: Methods
  ): ((options?: NativeSelectionOptions<Methods[number]>) => DesktopNativeLayer) =>
  (options = {}) =>
    surface(registration, options)

export const app = defineSurface(AppSurface, AppMethodNames)
export const clipboard = defineSurface(ClipboardSurface, ClipboardMethodNames)
export const contextMenu = defineSurface(ContextMenuSurface, ContextMenuMethodNames)
export const crashReporter = defineSurface(CrashReporterSurface, CrashReporterMethodNames)
export const dialog = defineSurface(DialogSurface, DialogMethodNames)
export const dock = defineSurface(DockSurface, DockMethodNames)
export const globalShortcut = defineSurface(GlobalShortcutSurface, GlobalShortcutMethodNames)
export const menu = defineSurface(MenuSurface, MenuMethodNames)
export const notification = defineSurface(NotificationSurface, NotificationMethodNames)
export const path = defineSurface(PathSurface, PathMethodNames)
export const powerMonitor = defineSurface(PowerMonitorSurface, PowerMonitorMethodNames)
export const protocol = defineSurface(ProtocolSurface, ProtocolMethodNames)
export const safeStorage = defineSurface(SafeStorageSurface, SafeStorageMethodNames)
export const screen = defineSurface(ScreenSurface, ScreenMethodNames)
export const shell = defineSurface(ShellSurface, ShellMethodNames)
export const systemAppearance = defineSurface(SystemAppearanceSurface, SystemAppearanceMethodNames)
export const tray = defineSurface(TraySurface, TrayMethodNames)
export const updater = defineSurface(UpdaterSurface, UpdaterMethodNames)
export const webView = defineSurface(WebViewSurface, WebViewMethodNames)
export const window = defineSurface(WindowSurface, WindowMethodNames)

export const all = (options: NativeAllSelectionOptions = {}): DesktopNativeLayer =>
  Desktop.native(
    ...BuiltInSurfaces.map((registration) =>
      surface(
        registration,
        options.permissions === undefined ? {} : { permissions: options.permissions }
      )
    )
  )

const selectedPermissionCapabilities = (
  registration: NativePermissionSource,
  permissions: NativeSelectionOptions["permissions"]
): readonly NormalizedCapability[] => {
  if (permissions === undefined) {
    return []
  }

  if (permissions === "all") {
    return allPermissionCapabilities([registration])
  }

  const capabilities = permissionCapabilitiesByMethod(registration)
  return Object.freeze(
    permissions.map((method) => {
      const capability = capabilities.get(method)
      if (capability === undefined) {
        throw new TypeError(
          `Native.${registration.tag} cannot declare permission for unprivileged or unknown method ${JSON.stringify(method)}`
        )
      }
      return capability
    })
  )
}

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
  all
})
