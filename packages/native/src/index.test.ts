import { expect, test } from "bun:test"
import {
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  HostProtocolStaleHandleError,
  HostProtocolUnsupportedError,
  WINDOW_CANCEL_ATTENTION_METHOD,
  WINDOW_CLEAR_VIBRANCY_METHOD,
  RendererOriginAuth,
  WINDOW_CREATE_METHOD,
  WINDOW_CENTER_METHOD,
  WINDOW_CENTER_ON_DISPLAY_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_EVENT_METHOD,
  WINDOW_FOCUS_METHOD,
  WINDOW_GET_BOUNDS_METHOD,
  WINDOW_GET_BY_ID_METHOD,
  WINDOW_GET_CHILDREN_METHOD,
  WINDOW_GET_CURRENT_METHOD,
  WINDOW_GET_PARENT_METHOD,
  WINDOW_GET_STATE_METHOD,
  WINDOW_HIDE_METHOD,
  WINDOW_MAXIMIZE_METHOD,
  WINDOW_MINIMIZE_METHOD,
  WINDOW_RESTORE_METHOD,
  WINDOW_REQUEST_ATTENTION_METHOD,
  WINDOW_SET_ALWAYS_ON_TOP_METHOD,
  WINDOW_SET_BOUNDS_METHOD,
  WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
  WINDOW_SET_DECORATIONS_METHOD,
  WINDOW_SET_FULLSCREEN_METHOD,
  WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
  WINDOW_SET_PROGRESS_METHOD,
  WINDOW_SET_RESIZABLE_METHOD,
  WINDOW_SET_SHADOW_METHOD,
  WINDOW_SET_SKIP_TASKBAR_METHOD,
  WINDOW_SET_TITLE_BAR_STYLE_METHOD,
  WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
  WINDOW_SET_TITLE_METHOD,
  WINDOW_SET_TRANSPARENT_METHOD,
  WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
  WINDOW_SET_VIBRANCY_METHOD,
  WINDOW_SHOW_METHOD,
  WINDOW_SUBSCRIBE_EVENTS_METHOD,
  WEBVIEW_CLOSE_DEVTOOLS_METHOD,
  WEBVIEW_FRAME_EVENT_METHOD,
  WEBVIEW_OPEN_DEVTOOLS_METHOD,
  WEBVIEW_PRINT_METHOD,
  WEBVIEW_RUNTIME_EVENT_METHOD,
  WEBVIEW_SET_ZOOM_METHOD,
  makeHostProtocolHostUnavailableError,
  RpcCapability,
  rpcSupport,
  type BridgeClientExchange,
  type BridgeClientResponse,
  HostProtocolRequestEnvelope,
  HostProtocolEventEnvelope,
  type HostWindowClientOptions,
  type HostWindowExchange
} from "@orika/bridge"
import {
  AuditEvent,
  CommandRegistryHandlerFailureError,
  CommandRegistry,
  Desktop,
  DesktopSpineConfigError,
  type DesktopNativeLayer,
  type DesktopPermissionsLayer,
  type AnyDesktopRpcRegistration,
  P,
  PermissionRegistry,
  ResourceRegistry,
  makeCommandRegistry,
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  type AuditEventsApi,
  type CommandRegistryApi,
  type DesktopRpcClient,
  type NormalizedCapability
} from "@orika/core"
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schema,
  Stream
} from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  App,
  AppHandlersLive,
  AppRpcs,
  AppRpcEvents,
  AppLive,
  AppMethodNames,
  AppSurface,
  AppMetadata,
  AppMetadataLive,
  AppMetadataMethodNames,
  AppMetadataRpcEvents,
  AppMetadataRpcs,
  Association,
  AssociationLive,
  AssociationMethodNames,
  AssociationRpcs,
  AssociationRpcEvents,
  Autostart,
  AutostartLive,
  AutostartMethodNames,
  AutostartRpcEvents,
  AutostartRpcs,
  Native,
  NativeCapabilities,
  NativeCapabilitiesLive,
  UnsupportedCapability,
  Clipboard,
  ClipboardClient,
  ClipboardHandlersLive,
  ClipboardRpcs,
  ClipboardRpcEvents,
  ClipboardLive,
  ClipboardMethodNames,
  ClipboardSurface,
  ContextMenu,
  ContextMenuCapabilityFacts,
  ContextMenuHandlersLive,
  ContextMenuRpcs,
  ContextMenuRpcEvents,
  ContextMenuLive,
  ContextMenuMethodNames,
  ContextMenuSurface,
  CrashReporter,
  CrashReporterHandlersLive,
  CrashReporterRpcs,
  CrashReporterRpcEvents,
  CrashReporterLive,
  CrashReporterMethodNames,
  CrashReporterSurface,
  Dialog,
  DialogClient,
  DialogHandlersLive,
  DialogOpenDirectory,
  DialogOpenFile,
  DialogRpcs,
  DialogRpcEvents,
  DialogLive,
  DialogMethodNames,
  DialogSurface,
  Dock,
  DockCapabilityFacts,
  DockHandlersLive,
  DockRpcs,
  DockLive,
  DockMethodNames,
  DockSurface,
  ExecutionSandbox,
  ExecutionSandboxLive,
  ExecutionSandboxSurface,
  GlobalShortcut,
  GlobalShortcutCapabilityFacts,
  GlobalShortcutHandlersLive,
  GlobalShortcutRpcs,
  GlobalShortcutRpcEvents,
  GlobalShortcutLive,
  GlobalShortcutMethodNames,
  GlobalShortcutSurface,
  Menu,
  MenuCapabilityFacts,
  MenuHandlersLive,
  MenuRpcs,
  MenuRpcEvents,
  MenuLive,
  MenuMethodNames,
  MenuSurface,
  NativeFileSystem,
  NativeFileSystemLive,
  NativeFileSystemMethodNames,
  NativeFileSystemRpcEvents,
  NativeFileSystemRpcs,
  NativeFileSystemSurface,
  Notification,
  NotificationHandlersLive,
  NotificationRpcs,
  NotificationRpcEvents,
  NotificationLive,
  NotificationMethodNames,
  NotificationSurface,
  Path,
  PathHandlersLive,
  PathRpcs,
  PathLive,
  PathMethodNames,
  PathSurface,
  Protocol,
  ProtocolHandlersLive,
  ProtocolRpcs,
  ProtocolLive,
  ProtocolMethodNames,
  ProtocolSurface,
  PowerMonitor,
  PowerMonitorHandlersLive,
  PowerMonitorRpcs,
  PowerMonitorRpcEvents,
  PowerMonitorLive,
  PowerMonitorMethodNames,
  PowerMonitorSurface,
  RecentDocuments,
  RecentDocumentsLive,
  RecentDocumentsMethodNames,
  RecentDocumentsRpcEvents,
  RecentDocumentsRpcs,
  SafeStorage,
  SafeStorageHandlersLive,
  SafeStorageRpcs,
  SafeStorageRpcEvents,
  SafeStorageLive,
  SafeStorageMethodNames,
  SafeStorageSurface,
  Screen,
  ScreenClient,
  ScreenHandlersLive,
  ScreenRpcs,
  ScreenLive,
  ScreenMethodNames,
  ScreenRpcEvents,
  ScreenSurface,
  Shell,
  ShellHandlersLive,
  ShellRpcs,
  ShellLive,
  ShellMethodNames,
  ShellSurface,
  SystemAppearance,
  SystemAppearanceHandlersLive,
  SystemAppearanceRpcs,
  SystemAppearanceRpcEvents,
  SystemAppearanceLive,
  SystemAppearanceMethodNames,
  SystemAppearanceSurface,
  Tray,
  TrayHandlersLive,
  TrayRpcs,
  TrayRpcEvents,
  TrayLive,
  TrayMethodNames,
  TraySurface,
  Updater,
  UpdaterHandlersLive,
  UpdaterRpcs,
  UpdaterRpcEvents,
  UpdaterLive,
  UpdaterMethodNames,
  UpdaterSurface,
  WebView,
  WebViewCapabilityFacts,
  WebViewHandlersLive,
  WebViewRpcs,
  WebViewRpcEvents,
  WebViewLive,
  WebViewMethodNames,
  WebViewSurface,
  makeNativeCapabilityManifest,
  Window,
  WindowHandlersLive,
  WindowRpcs,
  WindowRpcEvents,
  WindowSupportedRpcs,
  WindowSurface,
  WindowClient,
  WindowLive,
  WindowMethodNames,
  makeAssociationServiceLayer,
  makeAppServiceLayer,
  makeAppMetadataServiceLayer,
  makeAutostartServiceLayer,
  makeClipboardServiceLayer,
  makeContextMenuServiceLayer,
  makeCrashReporterMemoryClient,
  makeCrashReporterServiceLayer,
  makeDialogServiceLayer,
  makeDockServiceLayer,
  makeGlobalShortcutAlreadyRegisteredError,
  makeLinuxDockClient,
  makeLinuxGlobalShortcutClient,
  makeLinuxSafeStorageClient,
  makeGlobalShortcutServiceLayer,
  makeScreenServiceLayer,
  makeSecretBytes,
  makeSystemAppearanceServiceLayer,
  makeUpdaterServiceLayer,
  makeMenuServiceLayer,
  makeNativeFileSystemServiceLayer,
  makeNotificationServiceLayer,
  makePathServiceLayer,
  makeProtocolServiceLayer,
  makeRecentDocumentsServiceLayer,
  makeSafeStorageServiceLayer,
  makeShellServiceLayer,
  makeTrayServiceLayer,
  makeWebViewServiceLayer,
  makeWindowServiceLayer,
  unsafeSecretBytes,
  wipeSecretBytes,
  type AppClientApi,
  type AppMetadataClientApi,
  type AssociationClientApi,
  type AutostartClientApi,
  type ClipboardClientApi,
  type ContextMenuClientApi,
  type DialogClientApi,
  type DockClientApi,
  type GlobalShortcutClientApi,
  type MenuClientApi,
  type NativeFileSystemClientApi,
  type NotificationClientApi,
  type PathClientApi,
  type ProtocolClientApi,
  type RecentDocumentsClientApi,
  type SafeStorageClientApi,
  type ScreenClientApi,
  type ShellClientApi,
  type SystemAppearanceClientApi,
  type TrayClientApi,
  type UpdaterClientApi,
  type WebViewClientApi,
  type WindowClientApi
} from "./index.js"
import { makeAppMetadataBridgeClientLayer, makeHostAppMetadataRpcRuntime } from "./app-metadata.js"
import { makeAppBridgeClientLayer, makeHostAppRpcRuntime } from "./app.js"
import { makeAssociationBridgeClientLayer, makeHostAssociationRpcRuntime } from "./association.js"
import { makeAutostartBridgeClientLayer, makeHostAutostartRpcRuntime } from "./autostart.js"
import { makeClipboardBridgeClientLayer, makeHostClipboardRpcRuntime } from "./clipboard.js"
import { makeContextMenuBridgeClientLayer } from "./context-menu.js"
import { makeCrashReporterBridgeClientLayer } from "./crash-reporter.js"
import { makeDialogBridgeClientLayer, makeHostDialogRpcRuntime } from "./dialog.js"
import { makeDockBridgeClientLayer, makeHostDockRpcRuntime } from "./dock.js"
import { makeGlobalShortcutBridgeClientLayer } from "./global-shortcut.js"
import { makeMenuBridgeClientLayer } from "./menu.js"
import {
  makeHostNativeFileSystemRpcRuntime,
  makeNativeFileSystemBridgeClientLayer
} from "./native-file-system.js"
import {
  makeHostNotificationRpcRuntime,
  makeNotificationBridgeClientLayer
} from "./notification.js"
import { makeHostPathRpcRuntime, makePathBridgeClientLayer } from "./path.js"
import {
  makeHostPowerMonitorRpcRuntime,
  makePowerMonitorBridgeClientLayer
} from "./power-monitor.js"
import { makeHostProtocolRpcRuntime, makeProtocolBridgeClientLayer } from "./protocol.js"
import {
  makeHostRecentDocumentsRpcRuntime,
  makeRecentDocumentsBridgeClientLayer
} from "./recent-documents.js"
import { makeHostSafeStorageRpcRuntime, makeSafeStorageBridgeClientLayer } from "./safe-storage.js"
import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import { makeHostScreenRpcRuntime, makeScreenBridgeClientLayer } from "./screen.js"
import { makeHostShellRpcRuntime, makeShellBridgeClientLayer } from "./shell.js"
import {
  makeHostSystemAppearanceRpcRuntime,
  makeSystemAppearanceBridgeClientLayer
} from "./system-appearance.js"
import { makeHostTrayRpcRuntime, makeTrayBridgeClientLayer } from "./tray.js"
import { makeUpdaterBridgeClientLayer } from "./updater.js"
import { makeWebViewBridgeClientLayer, webViewCapability } from "./webview.js"
import { makeHostWindowRpcRuntime, makeWindowBridgeClientLayer } from "./window.js"
import {
  AssociationEvent,
  AssociationFileAssociation,
  AssociationFileAssociationsResult,
  AssociationProtocolStatus,
  AutostartEvent,
  AutostartStatus,
  AppBeforeQuitEvent,
  AppMetadataEnvironmentShape,
  AppMetadataEvent,
  AppMetadataInfo,
  AppMetadataLaunchContext,
  AppMetadataPaths,
  AppOpenFileEvent,
  AppOpenUrlEvent,
  AppSecondInstanceEvent,
  AppSingleInstanceResult,
  ClipboardHtml,
  ClipboardImage,
  ClipboardSupportedResult,
  ClipboardText,
  ContextMenuActivatedEvent,
  ContextMenuBindCommandInput,
  DialogConfirmResult,
  DialogOpenResult,
  DialogSaveResult,
  DockSupportedResult,
  GlobalShortcutPressedEvent,
  GlobalShortcutRegisteredResult,
  GlobalShortcutSupportedResult,
  MenuActivatedEvent,
  MenuTemplate,
  NativeFileSystemEvent,
  NativeFileSystemMetadata,
  NativeFileSystemOpenResult,
  NativeFileSystemStopWatchingResult,
  NativeFileSystemSupportedResult,
  NativeFileSystemWatchResult,
  NotificationActionEvent,
  NotificationClickEvent,
  NotificationPermissionResult,
  NotificationSupportedResult,
  CanonicalPath,
  PowerMonitorLockScreenEvent,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSupportedResult,
  PowerMonitorSuspendEvent,
  PowerMonitorUnlockScreenEvent,
  RecentDocument,
  RecentDocumentsEvent,
  RecentDocumentsListResult,
  SafeStorageAvailabilityResult,
  SafeStorageListResult,
  SafeStorageSecretPayload,
  ScreenBounds,
  ScreenDisplay,
  ScreenDisplaysChangedEvent,
  ScreenDisplaysResult,
  ScreenIsSupportedInput,
  ScreenPoint,
  ScreenSupportedResult,
  SystemAppearanceAccentColorResult,
  SystemAppearanceBooleanResult,
  SystemAppearanceChangedEvent,
  SystemAppearanceColor,
  SystemAppearanceResult,
  SystemAppearanceSupportedResult,
  TrayActivatedEvent,
  TraySupportedResult,
  UpdaterPreparingRestartEvent,
  UpdaterStatusResult,
  UpdaterStatusState,
  WebViewApiCallEvent,
  WebViewFrameEvent,
  WebViewNavigationBlockedEvent,
  WebViewRuntimeEvent,
  WindowBounds,
  WindowBoundsEvent,
  WindowRegistryEvent,
  WindowState,
  type NotificationHandle,
  type TrayHandle,
  type WebViewHandle,
  type WebViewFrameHandle,
  type WindowCreateOptions,
  type WindowHandle
} from "./contracts/index.js"
import {
  AppEventRouter,
  AppEventRouterLive,
  broadcastRoute,
  firstResponderRoute,
  makeAppEventRouter,
  targetedRoute,
  windowScope
} from "./app-events.js"
import { commandBindingWarningError } from "./command-binding-log.js"

const AppEventOpenFilePayload = Schema.Struct({ path: Schema.String })
const decodeAppEventOpenFilePayload = Schema.decodeUnknownSync(AppEventOpenFilePayload)
const appEventOpenFilePaths = (
  events: Iterable<{ readonly payload: unknown }>
): readonly string[] =>
  Array.from(events, (event) => decodeAppEventOpenFilePayload(event.payload).path)

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

class TestCommandHandlerError extends Schema.ErrorClass<TestCommandHandlerError>(
  "TestCommandHandlerError"
)({
  message: Schema.String
}) {}

const snapshotSurfaceRegistrations = (
  serverLayer: ReadonlyArray<AnyDesktopRpcRegistration>
): Effect.Effect<ReadonlyArray<AnyDesktopRpcRegistration>> => Effect.succeed(serverLayer)

test("native package root keeps contracts and implementation helpers behind subpaths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const native = yield* Effect.promise(() => import("@orika/native"))

      expect(native.Window).toBeFunction()
      expect(native.WindowLive).toBeDefined()
      expect(native.ClipboardSurface).toBeDefined()
      expect(native.DialogSurface).toBeDefined()
      expect(native.Native.all).toBeDefined()
      expect(native.Native.Permissions.clipboard.readText).toBeDefined()
      expect(Array.isArray(native.Native.available(native.Native.Clipboard))).toBe(true)
      expect(Array.isArray(Desktop.native(native.Native.all))).toBe(true)
      expect("readText" in native.Native.Clipboard).toBe(false)
      expect("Permissions" in native.Native).toBe(true)
      expect(native.NativeCapabilities).toBeFunction()
      expect(native.NativeCapabilitiesLive).toBeDefined()
      expect(native.UnsupportedCapability).toBeFunction()
      expect(NativeCapabilities).toBeFunction()
      expect(NativeCapabilitiesLive).toBeDefined()
      expect(UnsupportedCapability).toBeFunction()
      expect("WindowCreateInput" in native).toBe(false)
      expect("ClipboardText" in native).toBe(false)
      expect("DialogOpenResult" in native).toBe(false)
      expect("AppEventRouter" in native).toBe(false)
      expect("AppHttpServer" in native).toBe(false)
      expect("UpdateWorkflow" in native).toBe(false)
      expect("makeUnsupportedWindowClient" in native).toBe(false)
      expect("makeUnsupportedClipboardClient" in native).toBe(false)
      expect("makeClipboardBridgeClientLayer" in native).toBe(false)
      expect("makeHostClipboardRpcRuntime" in native).toBe(false)
    })
  ))

test("native services expose canonical static layers", () => {
  expect(AppLive).toBe(App.layer)
  expect(ClipboardLive).toBe(Clipboard.layer)
  expect(ContextMenuLive).toBe(ContextMenu.layer)
  expect(CrashReporterLive).toBe(CrashReporter.layer)
  expect(DialogLive).toBe(Dialog.layer)
  expect(DockLive).toBe(Dock.layer)
  expect(ExecutionSandboxLive).toBe(ExecutionSandbox.layer)
  expect(GlobalShortcutLive).toBe(GlobalShortcut.layer)
  expect(MenuLive).toBe(Menu.layer)
  expect(NativeFileSystemLive).toBe(NativeFileSystem.layer)
  expect(NotificationLive).toBe(Notification.layer)
  expect(PathLive).toBe(Path.layer)
  expect(PowerMonitorLive).toBe(PowerMonitor.layer)
  expect(ProtocolLive).toBe(Protocol.layer)
  expect(SafeStorageLive).toBe(SafeStorage.layer)
  expect(ScreenLive).toBe(Screen.layer)
  expect(ShellLive).toBe(Shell.layer)
  expect(SystemAppearanceLive).toBe(SystemAppearance.layer)
  expect(TrayLive).toBe(Tray.layer)
  expect(UpdaterLive).toBe(Updater.layer)
  expect(WebViewLive).toBe(WebView.layer)
  expect(WindowLive).toBe(Window.layer)
  expect(AppEventRouterLive).toBe(AppEventRouter.layer)
})

test("Native.Permissions.all declares every public native capability", () => {
  const declared = nativePermissionTags(Native.Permissions.all)

  expect(declared).toContain("App.quit")
  expect(declared).toContain("App.requestSingleInstanceLock")
  expect(declared).toContain("Clipboard.readText")
  expect(declared).toContain("Window.create")
  expect(declared).not.toContain("Clipboard.isSupported")
})

test("native capability groups declare only their native surface", () => {
  const windowPermissions = nativePermissionTags(Native.Permissions.window.all)
  const dialogPermissions = nativePermissionTags(Native.Permissions.dialog.all)
  const clipboardPermissions = nativePermissionTags(Native.Permissions.clipboard.all)

  expect(windowPermissions).toContain("Window.create")
  expect(windowPermissions).toContain("Window.close")
  expect(windowPermissions).toContain(WINDOW_SUBSCRIBE_EVENTS_METHOD)
  expect(windowPermissions).not.toContain("Clipboard.readText")
  expect(dialogPermissions).toContain("Dialog.openFile")
  expect(dialogPermissions).not.toContain("Window.create")
  expect(clipboardPermissions).toContain("Clipboard.readText")
  expect(clipboardPermissions).not.toContain("Clipboard.isSupported")
})

test("native permission constants can declare a selected method", () => {
  const declared = nativePermissionTags(Desktop.permission(Native.Permissions.clipboard.readText))

  expect(declared).toContain("Clipboard.readText")
  expect(declared).not.toContain("Clipboard.writeText")
})

test("native capability selections come from their surfaces", () => {
  const declared = nativePermissionTags(Desktop.permission(ClipboardSurface.permissions.readText))

  expect(Native.Clipboard).toBe(ClipboardSurface.selection)
  expect(Native.Dialog).toBe(DialogSurface.selection)
  expect(Native.ExecutionSandbox).toBe(ExecutionSandboxSurface.selection)
  expect(Native.NativeFileSystem).toBe(NativeFileSystemSurface.selection)
  expect("isSupported" in Native.Permissions.nativeFileSystem).toBe(false)
  expect(Native.Permissions.clipboard.readText).toEqual(ClipboardSurface.permissions.readText)
  expect("isSupported" in Native.Clipboard).toBe(false)
  expect("getInfo" in Native.App).toBe(false)
  expect("setOpenAtLogin" in Native.App).toBe(false)
  expect(Native.Permissions.app.requestSingleInstanceLock).toEqual(
    AppSurface.permissions.requestSingleInstanceLock
  )
  expect(Native.Permissions.app.releaseSingleInstanceLock).toEqual(
    AppSurface.permissions.releaseSingleInstanceLock
  )
  expect(declared).toContain("Clipboard.readText")
})

test("native capability bundles dedupe repeated surfaces and permissions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const native = Desktop.native(Native.Clipboard)
      const declaredPermissions = Desktop.permissions(
        Desktop.permission(Native.Permissions.clipboard.readText),
        Desktop.permission(Native.Permissions.clipboard.writeText),
        Desktop.permission(Native.Permissions.clipboard.readText)
      )
      const graph = yield* Desktop.runtimeGraph({
        id: "native-deduped-capabilities",
        windows: Desktop.window("main", { title: "Native Dedupe" }),
        native,
        permissions: declaredPermissions
      })
      const declared = nativePermissionTagList(declaredPermissions)

      expect(graph.nodes.filter((node) => node.id === "native:Clipboard")).toHaveLength(1)
      expect(declared.filter((tag) => tag === "Clipboard.readText")).toHaveLength(1)
      expect(declared.filter((tag) => tag === "Clipboard.writeText")).toHaveLength(1)
    })
  ))

test("native availability selection does not grant authority", () => {
  const declared = nativePermissionTags(Native.available(Native.Clipboard))

  expect(declared.size).toBe(0)
})

test("native contracts subpath exposes schema-coded payload contracts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const contracts = yield* Effect.promise(() => import("@orika/native/contracts"))

      expect(contracts.WindowCreateInput).toBeFunction()
      expect(contracts.ClipboardText).toBeFunction()
      expect(contracts.DialogOpenResult).toBeFunction()
      expect("NativeParityMatrixResult" in contracts).toBe(false)
    })
  ))

test("Desktop.native registers selected native surfaces into app manifests", () => {
  const app = Desktop.make({
    id: "native-selected",
    windows: Desktop.window("main", { title: "Native Selected" }),
    native: Desktop.native(Native.Clipboard, Native.Dialog)
  })
  const tags = Desktop.manifest(app).rpcGroups.flatMap((group) =>
    Array.from(group.group.requests.keys())
  )

  expect(tags).toContain("Clipboard.readText")
  expect(tags).toContain("Dialog.openFile")
  expect(tags).not.toContain("Window.create")
})

test("Desktop.native availability does not require matching permissions during graph build", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const graph = yield* Desktop.runtimeGraph({
        id: "native-no-permissions",
        windows: Desktop.window("main", { title: "Native No Permissions" }),
        native: Native.available(Native.Clipboard)
      })

      expect(graph.nodes.some((node) => node.id === "native:Clipboard")).toBe(true)
      expect(graph.nodes.some((node) => node.id === "native:Window")).toBe(false)
    })
  ))

test("Desktop.native rejects duplicate native surfaces as typed config errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Desktop.runtimeGraph({
          id: "native-duplicate",
          windows: Desktop.window("main", { title: "Native Duplicate" }),
          native: Desktop.native(
            Native.available(Native.Clipboard),
            Native.available(Native.Clipboard)
          )
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toBeInstanceOf(DesktopSpineConfigError)
        expect(failure?.error).toMatchObject({
          _tag: "DesktopConfigError",
          reason: "invalid-config",
          contract: "Clipboard"
        })
      }
    })
  ))

test("Desktop.native rejects duplicate RPC methods across native and app RPC layers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Desktop.runtimeGraph({
          id: "native-rpc-duplicate",
          windows: Desktop.window("main", { title: "Native RPC Duplicate" }),
          native: Native.available(Native.Clipboard),
          rpcs: ClipboardSurface.serverLayer
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toBeInstanceOf(DesktopSpineConfigError)
        expect(failure?.error).toMatchObject({
          _tag: "DesktopConfigError",
          reason: "duplicate-rpc",
          method: "Clipboard.readText"
        })
      }
    })
  ))

test("Native.all registers every built-in native surface", () => {
  const app = Desktop.make({
    id: "native-all",
    windows: Desktop.window("main", { title: "Native All" }),
    native: Desktop.native(Native.all)
  })
  const tags = Desktop.manifest(app).rpcGroups.flatMap((group) =>
    Array.from(group.group.requests.keys())
  )

  expect(tags).toContain("App.quit")
  expect(tags).toContain("AppMetadata.getInfo")
  expect(tags).toContain("Clipboard.readText")
  expect(tags).toContain("Window.create")
})

test("native package exports reject implementation-only subpaths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const appHttpServerSpecifier = "@orika/native/" + "app-http-server"
      const updaterWorkflowSpecifier = "@orika/native/" + "updater-workflow"

      yield* expectImportRejected(appHttpServerSpecifier)
      yield* expectImportRejected(updaterWorkflowSpecifier)
    })
  ))

const expectImportRejected = (specifier: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(Effect.promise(() => import(specifier)))
    expect(Exit.isFailure(exit)).toBe(true)
  })

const nativePermissionTags = (
  nativeLayer: DesktopNativeLayer | DesktopPermissionsLayer
): ReadonlySet<string> => {
  const tags = nativePermissionTagList(nativeLayer)
  return new Set(tags)
}

const nativePermissionTagList = (
  nativeLayer: DesktopNativeLayer | DesktopPermissionsLayer
): readonly string[] => {
  const capabilities = nativeLayer.filter((item): item is NormalizedCapability => "kind" in item)
  return capabilities.flatMap((capability) =>
    capability.kind === "native.invoke"
      ? [`${capability.primitive}.${capability.methods.join(",")}`]
      : []
  )
}

const expectedWindowMethods: Array<(typeof WindowMethodNames)[number]> = [
  "create",
  "close",
  "destroy",
  "show",
  "hide",
  "focus",
  "getCurrent",
  "getById",
  "list",
  "getParent",
  "getChildren",
  "getBounds",
  "setBounds",
  "setBoundsOnDisplay",
  "center",
  "centerOnDisplay",
  "setTitle",
  "setResizable",
  "setDecorations",
  "setTrafficLights",
  "setVibrancy",
  "clearVibrancy",
  "setShadow",
  "setTitleBarStyle",
  "setTitleBarTransparent",
  "setTransparent",
  "setAlwaysOnTop",
  "setSkipTaskbar",
  "setProgress",
  "requestAttention",
  "cancelAttention",
  "minimize",
  "maximize",
  "restore",
  "setFullscreen",
  "setSimpleFullscreen",
  "getState"
]
const expectedWindowCapabilityMethods = [...expectedWindowMethods, "subscribeEvents"] as const

const expectedAppMethods: Array<(typeof AppMethodNames)[number]> = [
  "quit",
  "exit",
  "restart",
  "relaunch",
  "focus",
  "activate",
  "requestSingleInstanceLock",
  "releaseSingleInstanceLock"
]

const expectedAppMetadataMethods: Array<(typeof AppMetadataMethodNames)[number]> = [
  "getInfo",
  "getPaths",
  "getLaunchContext"
]

const expectedWebViewMethods: Array<(typeof WebViewMethodNames)[number]> = [
  "create",
  "loadRoute",
  "loadUrl",
  "reload",
  "stop",
  "goBack",
  "goForward",
  "getNavigationState",
  "print",
  "setZoom",
  "openDevTools",
  "closeDevTools",
  "setNavigationPolicy",
  "destroy"
]

const expectedWebViewCapabilityFactMethods = [
  "captureScreenshot",
  "printToPdf",
  "findInPage",
  "setUserAgent",
  "setAudioMuted",
  "respondToPermission",
  "listFrames",
  "postToFrame",
  "attachDebugger"
] as const

const webViewDebuggerUnsupportedSupport = {
  status: "unsupported",
  reason: "host-debugger-protocol-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-debugger-protocol-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-debugger-protocol-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-debugger-protocol-unavailable" }
  ]
} as const

const webViewDocumentUnsupportedSupport = {
  status: "unsupported",
  reason: "host-document-output-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-document-output-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-document-output-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-document-output-unavailable" }
  ]
} as const

const webViewFindInPageUnsupportedSupport = {
  status: "unsupported",
  reason: "host-find-in-page-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-find-in-page-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-find-in-page-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-find-in-page-unavailable" }
  ]
} as const

const webViewRuntimeUserAgentUnsupportedSupport = {
  status: "unsupported",
  reason: "host-user-agent-runtime-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-user-agent-runtime-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-user-agent-runtime-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-user-agent-runtime-unavailable" }
  ]
} as const

const webViewFrameRoutingUnsupportedSupport = {
  status: "unsupported",
  reason: "host-frame-routing-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-frame-routing-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-frame-routing-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-frame-routing-unavailable" }
  ]
} as const

const webViewRuntimeMediaControlUnsupportedSupport = {
  status: "unsupported",
  reason: "host-runtime-media-control-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-runtime-media-control-unavailable" },
    {
      platform: "windows",
      status: "unsupported",
      reason: "host-runtime-media-control-unavailable"
    },
    { platform: "linux", status: "unsupported", reason: "host-runtime-media-control-unavailable" }
  ]
} as const

const webViewRuntimePermissionUnsupportedSupport = {
  status: "unsupported",
  reason: "host-permission-request-routing-unavailable",
  platforms: [
    {
      platform: "macos",
      status: "unsupported",
      reason: "host-permission-request-routing-unavailable"
    },
    {
      platform: "windows",
      status: "unsupported",
      reason: "host-permission-request-routing-unavailable"
    },
    {
      platform: "linux",
      status: "unsupported",
      reason: "host-permission-request-routing-unavailable"
    }
  ]
} as const

const webViewNavigationTrackedSupport = {
  status: "partial",
  reason: "host-navigation-state-tracked",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-navigation-state-tracked" },
    { platform: "windows", status: "partial", reason: "host-navigation-state-tracked" },
    { platform: "linux", status: "partial", reason: "host-navigation-state-tracked" }
  ]
} as const

const webViewNavigationPolicySupport = {
  status: "partial",
  reason: "host-navigation-policy-open-external-unavailable",
  platforms: [
    {
      platform: "macos",
      status: "partial",
      reason: "host-navigation-policy-open-external-unavailable"
    },
    {
      platform: "windows",
      status: "partial",
      reason: "host-navigation-policy-open-external-unavailable"
    },
    {
      platform: "linux",
      status: "partial",
      reason: "host-navigation-policy-open-external-unavailable"
    }
  ]
} as const

const webViewOpenDevToolsSupport = {
  status: "partial",
  reason: "host-devtools-build-gated",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-devtools-build-gated" },
    { platform: "windows", status: "partial", reason: "host-devtools-build-gated" },
    { platform: "linux", status: "partial", reason: "host-devtools-build-gated" }
  ]
} as const

const webViewCloseDevToolsSupport = {
  status: "partial",
  reason: "host-devtools-build-gated",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-devtools-build-gated" },
    {
      platform: "windows",
      status: "unsupported",
      reason: "windows-devtools-close-unavailable"
    },
    { platform: "linux", status: "partial", reason: "host-devtools-build-gated" }
  ]
} as const

const expectedMenuMethods: Array<(typeof MenuMethodNames)[number]> = [
  "setApplicationMenu",
  "setWindowMenu",
  "clear",
  "capability"
]

const expectedMenuCapabilityFactMethods: string[] = []

const expectedContextMenuMethods: Array<(typeof ContextMenuMethodNames)[number]> = ["show"]

const expectedContextMenuCapabilityFactMethods: string[] = []

const expectedDialogMethods: Array<(typeof DialogMethodNames)[number]> = [
  "openFile",
  "openDirectory",
  "saveFile",
  "message",
  "confirm"
]

const expectedDockMethods: Array<(typeof DockMethodNames)[number]> = [
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "requestAttention",
  "isSupported"
]

const expectedDockCapabilityFactMethods = ["setMenu", "setJumpList"]

const expectedGlobalShortcutMethods: Array<(typeof GlobalShortcutMethodNames)[number]> = [
  "isRegistered",
  "isSupported"
]

const expectedGlobalShortcutCapabilityFactMethods = ["register", "unregister", "unregisterAll"]

const expectedClipboardMethods: Array<(typeof ClipboardMethodNames)[number]> = [
  "readText",
  "writeText",
  "readHtml",
  "writeHtml",
  "readImage",
  "writeImage",
  "clear",
  "isSupported"
]

const expectedNotificationMethods: Array<(typeof NotificationMethodNames)[number]> = [
  "show",
  "close",
  "isSupported",
  "requestPermission",
  "getPermissionStatus"
]

const expectedPathMethods: Array<(typeof PathMethodNames)[number]> = [
  "appData",
  "cache",
  "logs",
  "temp",
  "home",
  "downloads"
]

const expectedProtocolMethods: Array<(typeof ProtocolMethodNames)[number]> = [
  "registerAppProtocol",
  "serveAsset",
  "serveRoute",
  "deny"
]

const expectedAssociationMethods: Array<(typeof AssociationMethodNames)[number]> = [
  "isDefaultProtocolClient",
  "setDefaultProtocolClient",
  "getFileAssociations"
]

const expectedAutostartMethods: Array<(typeof AutostartMethodNames)[number]> = [
  "isEnabled",
  "enable",
  "disable"
]

const expectedRecentDocumentsMethods: Array<(typeof RecentDocumentsMethodNames)[number]> = [
  "add",
  "clear",
  "list"
]

const expectedNativeFileSystemMethods: Array<(typeof NativeFileSystemMethodNames)[number]> = [
  "open",
  "stat",
  "watch",
  "stopWatching",
  "isSupported"
]

const expectedSafeStorageMethods: Array<(typeof SafeStorageMethodNames)[number]> = [
  "set",
  "get",
  "delete",
  "list",
  "isAvailable"
]
const SafeStorageTestSecretBytes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
const SafeStorageTestSecretBase64 = "AAECAwQFBgcICQoLDA=="
const makeSafeStorageTestSecret = () => makeSecretBytes(Uint8Array.from(SafeStorageTestSecretBytes))

const expectedUpdaterMethods: Array<(typeof UpdaterMethodNames)[number]> = [
  "check",
  "download",
  "install",
  "installAndRestart",
  "getStatus",
  "readyForRestart"
]
const updaterCheckInput = (currentVersion = "1.0.0") => ({
  currentVersion,
  manifestJson: '{"schemaVersion":1}',
  trustAnchors: [{ keyVersion: 7, publicKey: "ed25519:public-key" }]
})

const expectedCrashReporterMethods: Array<(typeof CrashReporterMethodNames)[number]> = [
  "start",
  "recordBreadcrumb",
  "flush",
  "getReports"
]

const makeCrashReporterPermissions = (effect: "allow" | "deny" = "allow") =>
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    for (const method of expectedCrashReporterMethods) {
      yield* permissions.declare(
        P.nativeInvoke({ primitive: "CrashReporter", methods: [method] }),
        {
          effect,
          source: "test"
        }
      )
    }
    return permissions
  })

const expectedPowerMonitorMethods: Array<(typeof PowerMonitorMethodNames)[number]> = ["isSupported"]

const expectedScreenMethods: Array<(typeof ScreenMethodNames)[number]> = [
  "getDisplays",
  "getPrimaryDisplay",
  "getPointerPoint",
  "isSupported"
]

const expectedShellMethods: Array<(typeof ShellMethodNames)[number]> = [
  "openExternal",
  "showItemInFolder",
  "openPath",
  "trashItem"
]

const expectedSystemAppearanceMethods: Array<(typeof SystemAppearanceMethodNames)[number]> = [
  "getAppearance",
  "getAccentColor",
  "getReducedMotion",
  "getReducedTransparency",
  "isSupported"
]

const expectedTrayMethods: Array<(typeof TrayMethodNames)[number]> = [
  "create",
  "setIcon",
  "setTooltip",
  "setTitle",
  "setMenu",
  "destroy",
  "isSupported"
]

const resourceId = makeResourceId

const windowHandle: WindowHandle = {
  kind: "window",
  id: resourceId("window-1"),
  generation: 0,
  ownerScope: "scope-1",
  state: "open"
}

const globalShortcutCommandCapability: NormalizedCapability = {
  kind: "native.invoke",
  primitive: "Command",
  methods: ["openProject"],
  audit: "always"
}

const menuCommandCapability: NormalizedCapability = {
  kind: "native.invoke",
  primitive: "Command",
  methods: ["app.file.open"],
  audit: "always"
}

const webviewHandle: WebViewHandle = {
  kind: "webview",
  id: resourceId("webview-1"),
  generation: 0,
  ownerScope: "window:window-1",
  state: "open"
}

const webviewFrameHandle: WebViewFrameHandle = {
  kind: "webview-frame",
  id: resourceId("frame-1"),
  generation: 0,
  ownerScope: "webview:webview-1",
  state: "open"
}

const menuTemplate = new MenuTemplate({
  items: [
    { type: "item", id: "file.open", label: "Open", commandId: "app.file.open" },
    { type: "separator" },
    {
      type: "submenu",
      id: "view",
      label: "View",
      items: [{ type: "item", id: "view.reload", label: "Reload", commandId: "app.view.reload" }]
    }
  ]
})

const applicationMenuTemplate = new MenuTemplate({
  items: [
    {
      type: "submenu",
      id: "file",
      label: "File",
      items: [{ type: "item", id: "file.open", label: "Open", commandId: "app.file.open" }]
    }
  ]
})

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 1])
const jpegBytesJson = "/9j/AQ=="

const notificationHandle: NotificationHandle = {
  kind: "notification",
  id: resourceId("notification-1"),
  generation: 0,
  ownerScope: "window:window-1",
  state: "open"
}

const trayHandle: TrayHandle = {
  kind: "tray",
  id: resourceId("tray-1"),
  generation: 0,
  ownerScope: "app",
  state: "open"
}

const screenBounds = new ScreenBounds({ x: 0, y: 0, width: 1920, height: 1080 })
const primaryDisplay = new ScreenDisplay({
  id: "display-1",
  bounds: screenBounds,
  workArea: new ScreenBounds({ x: 0, y: 24, width: 1920, height: 1056 }),
  scaleFactor: 2,
  primary: true
})
const accentColor = new SystemAppearanceColor({ r: 0.1, g: 0.2, b: 0.3, a: 1 })
const appMetadataInfo = new AppMetadataInfo({
  id: "dev.effect-desktop.test",
  name: "ORIKA Test",
  version: "0.0.0"
})
const appMetadataPaths = new AppMetadataPaths({
  executable: new CanonicalPath({ path: "/Applications/Test.app/Contents/MacOS/test" }),
  resources: new CanonicalPath({ path: "/Applications/Test.app/Contents/Resources" }),
  cwd: new CanonicalPath({ path: "/repo" })
})
const appMetadataLaunchContext = new AppMetadataLaunchContext({
  argv: ["test", "--safe-mode"],
  cwd: new CanonicalPath({ path: "/repo" }),
  reason: "launch",
  environment: new AppMetadataEnvironmentShape({ variableNames: ["PATH", "HOME"] })
})

test("AppRpcs declares the Phase 7 App method and event surface", () => {
  expect([...AppMethodNames]).toEqual(expectedAppMethods)
  expect(rpcMethodNames("App", AppRpcs)).toEqual(expectedAppMethods)
  expect(Object.keys(AppRpcEvents)).toEqual([
    "onSecondInstance",
    "onOpenFile",
    "onOpenUrl",
    "onBeforeQuit"
  ])
})

test("App service delegates through a substitutable AppClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const app = yield* App
            yield* app.focus()
            yield* app.activate()
            yield* app.quit()
            yield* app.exit({ exitCode: 7 })
            yield* app.restart({ args: ["--restarted"] })
            yield* app.relaunch({ args: ["--relaunched"] })
            yield* app.releaseSingleInstanceLock()
            const protocolEvents = yield* app.onOpenUrl().pipe(Stream.take(1), Stream.runCollect)

            return { protocolEvents }
          }),
          makeAppServiceLayer(appClient(calls))
        )
      )

      expect(Array.from(result.protocolEvents)).toEqual([
        new AppOpenUrlEvent({ url: "effect-desktop://open" })
      ])
      expect(calls).toEqual([
        "focus",
        "activate",
        "quit:-1",
        "exit:7",
        "restart:--restarted",
        "relaunch:--relaunched",
        "releaseSingleInstanceLock"
      ])
    })
  ))

test("App bridge client sends typed host envelopes and decodes event streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = appExchange(requests, (request) => ({
        kind: "success",
        payload: request.method === "App.requestSingleInstanceLock" ? { acquired: true } : undefined
      }))

      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const app = yield* App
            yield* app.quit({ exitCode: 0 })
            yield* app.exit({ exitCode: 7 })
            yield* app.restart({ args: ["--restarted"] })
            yield* app.relaunch({ args: ["--relaunched"] })
            yield* app.focus()
            yield* app.activate()
            yield* app.requestSingleInstanceLock()
            yield* app.releaseSingleInstanceLock()
            const openFiles = yield* app.onOpenFile().pipe(Stream.take(1), Stream.runCollect)

            return { openFiles }
          }),
          Layer.provide(AppLive, makeAppBridgeClientLayer(exchange))
        )
      )

      expect(Array.from(result.openFiles)).toEqual([
        new AppOpenFileEvent({ path: "/tmp/README.md" })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["App.quit", { exitCode: 0 }],
        ["App.exit", { exitCode: 7 }],
        ["App.restart", { args: ["--restarted"] }],
        ["App.relaunch", { args: ["--relaunched"] }],
        ["App.focus", null],
        ["App.activate", null],
        ["App.requestSingleInstanceLock", null],
        ["App.releaseSingleInstanceLock", null]
      ])
    })
  ))

test("native host RPC runtime gates single-instance release before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostAppRpcRuntime(
        {
          "App.quit": () => Effect.void,
          "App.exit": () => Effect.void,
          "App.restart": () => Effect.void,
          "App.relaunch": () => Effect.void,
          "App.focus": () => Effect.void,
          "App.activate": () => Effect.void,
          "App.requestSingleInstanceLock": () =>
            Effect.succeed(new AppSingleInstanceResult({ acquired: true })),
          "App.releaseSingleInstanceLock": () =>
            Effect.sync(() => {
              calls.push("releaseSingleInstanceLock")
            })
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const denied = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "app-release-single-instance-denied",
            method: "App.releaseSingleInstanceLock",
            timestamp: 1710000000000,
            traceId: "trace-app-release-single-instance-denied"
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )
      expect(denied.kind).toBe("failure")
      if (denied.kind === "failure") {
        expect(hasErrorTag(denied.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])

      const permissions = yield* makePermissionRegistry()
      yield* permissions.declare(Native.Permissions.app.releaseSingleInstanceLock, {
        source: "app-single-instance-test",
        effect: "allow"
      })
      const allowed = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "app-release-single-instance-allowed",
            method: "App.releaseSingleInstanceLock",
            timestamp: 1710000000001,
            traceId: "trace-app-release-single-instance-allowed"
          })
        ),
        Layer.succeed(PermissionRegistry)(permissions)
      )

      expect(allowed.kind).toBe("success")
      expect(calls).toEqual(["releaseSingleInstanceLock"])
    })
  ))

test("App single-instance service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported App.requestSingleInstanceLock",
        operation: "App.requestSingleInstanceLock",
        recoverable: false
      })
      const unsupportedClient: AppClientApi = {
        ...appClient([]),
        requestSingleInstanceLock: () => Effect.fail(unsupported)
      }
      const hostFailureClient: AppClientApi = {
        ...appClient([]),
        releaseSingleInstanceLock: () =>
          Effect.fail(makeHostProtocolHostUnavailableError("App.releaseSingleInstanceLock"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const app = yield* App
          return yield* Effect.exit(app.requestSingleInstanceLock())
        }),
        makeAppServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const app = yield* App
          return yield* Effect.exit(app.releaseSingleInstanceLock())
        }),
        makeAppServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("App bridge client decodes event streams without host requests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({ kind: "success" as const, payload: undefined })
        },
        subscribe: (method) =>
          method === "App.onOpenFile"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000400,
                  traceId: "event-trace",
                  method,
                  payload: { path: "/tmp/README.md" }
                })
              )
            : Stream.empty
      }

      const app = yield* runScoped(
        App.asEffect(),
        Layer.provide(AppLive, makeAppBridgeClientLayer(exchange))
      )

      const eventResult = yield* app.onOpenFile().pipe(Stream.take(1), Stream.runCollect)

      expect(Array.from(eventResult)).toEqual([new AppOpenFileEvent({ path: "/tmp/README.md" })])
      expect(requests).toEqual([])
    })
  ))

test("App bridge client rejects lifecycle events with excess fields as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [
        {
          method: "App.onOpenFile",
          payload: { path: "/tmp/README.md", ignoredByRenderer: true }
        },
        {
          method: "App.onOpenUrl",
          payload: { url: "effect-desktop://open", ignoredByRenderer: true }
        },
        {
          method: "App.onBeforeQuit",
          payload: { traceId: "trace-before-quit", ignoredByRenderer: true }
        },
        {
          method: "App.onSecondInstance",
          payload: {
            activationReason: "launch",
            argv: ["app"],
            cwd: "/repo",
            traceId: "trace-second",
            ignoredByRenderer: true
          }
        }
      ] as const

      for (const { method, payload } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (eventMethod) =>
            eventMethod === method
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000401,
                    traceId: "event-trace",
                    method: eventMethod,
                    payload
                  })
                )
              : Stream.empty
        }

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const app = yield* App
            if (method === "App.onOpenFile") {
              return yield* Effect.exit(app.onOpenFile().pipe(Stream.take(1), Stream.runCollect))
            }
            if (method === "App.onOpenUrl") {
              return yield* Effect.exit(app.onOpenUrl().pipe(Stream.take(1), Stream.runCollect))
            }
            if (method === "App.onBeforeQuit") {
              return yield* Effect.exit(app.onBeforeQuit().pipe(Stream.take(1), Stream.runCollect))
            }
            return yield* Effect.exit(
              app.onSecondInstance().pipe(Stream.take(1), Stream.runCollect)
            )
          }),
          Layer.provide(AppLive, makeAppBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("App bridge client rejects event envelopes for the wrong method", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
        subscribe: () =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000401,
              traceId: "event-trace",
              method: "App.onOpenUrl",
              payload: { path: "/tmp/README.md" }
            })
          )
      }

      const exit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const app = yield* App
            return yield* app.onOpenFile().pipe(Stream.take(1), Stream.runCollect)
          }),
          Layer.provide(AppLive, makeAppBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("App bridge client decodes second-instance activation reasons", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
        subscribe: (method) =>
          method === "App.onSecondInstance"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000400,
                  traceId: "event-trace",
                  method,
                  payload: {
                    activationReason: "open-file",
                    argv: ["app", "/tmp/README.md"],
                    cwd: "/repo",
                    traceId: "trace-second"
                  }
                })
              )
            : Stream.empty
      }

      const events = yield* runScoped(
        Effect.gen(function* () {
          const app = yield* App
          return yield* app.onSecondInstance().pipe(Stream.take(1), Stream.runCollect)
        }),
        Layer.provide(AppLive, makeAppBridgeClientLayer(exchange))
      )

      expect(Array.from(events)).toEqual([
        new AppSecondInstanceEvent({
          activationReason: "open-file",
          argv: ["app", "/tmp/README.md"],
          cwd: "/repo",
          traceId: "trace-second"
        })
      ])
    })
  ))

test("App single-instance lock rejects invalid primary pid results", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<unknown> = [
        { acquired: true, primaryPid: 1234 },
        { acquired: false, primaryPid: 0 }
      ]

      for (const payload of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const client = yield* App
            return yield* Effect.exit(client.requestSingleInstanceLock())
          }),
          Layer.provide(
            AppLive,
            makeAppBridgeClientLayer(
              appExchange(requests, (request) =>
                request.method === "App.requestSingleInstanceLock"
                  ? { kind: "success", payload }
                  : { kind: "success", payload: undefined }
              )
            )
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(requests.map((request) => [request.method, request.payload])).toEqual([
          ["App.requestSingleInstanceLock", null]
        ])
      }
    })
  ))

test("App bridge client rejects malformed App lifecycle event payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidUrlExchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: undefined }),
        subscribe: (method) =>
          method === "App.onOpenUrl"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000400,
                  traceId: "event-trace",
                  method,
                  payload: { url: "not a url^@" }
                })
              )
            : Stream.empty
      }

      const invalidSecondInstanceExchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: undefined }),
        subscribe: (method) =>
          method === "App.onSecondInstance"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000400,
                  traceId: "event-trace",
                  method,
                  payload: {
                    activationReason: "bad-reason",
                    argv: ["app", "bad\u0000arg"],
                    cwd: "",
                    traceId: ""
                  }
                })
              )
            : Stream.empty
      }

      const invalidBeforeQuitExchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: undefined }),
        subscribe: (method) =>
          method === "App.onBeforeQuit"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000400,
                  traceId: "event-trace",
                  method,
                  payload: { traceId: "" }
                })
              )
            : Stream.empty
      }

      const openUrlExit = yield* runScoped(
        Effect.gen(function* () {
          const app = yield* App
          return yield* Effect.exit(app.onOpenUrl().pipe(Stream.take(1), Stream.runCollect))
        }),
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(invalidUrlExchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )

      const secondInstanceExit = yield* runScoped(
        Effect.gen(function* () {
          const app = yield* App
          return yield* Effect.exit(app.onSecondInstance().pipe(Stream.take(1), Stream.runCollect))
        }),
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(invalidSecondInstanceExchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )

      const beforeQuitExit = yield* runScoped(
        Effect.gen(function* () {
          const app = yield* App
          return yield* Effect.exit(app.onBeforeQuit().pipe(Stream.take(1), Stream.runCollect))
        }),
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(invalidBeforeQuitExchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )

      expectExitFailure(openUrlExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(secondInstanceExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(beforeQuitExit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("App bridge client accepts safe absolute onOpenFile paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [
        "/tmp/README.md",
        "/tmp/a\\..\\b",
        "C:\\tmp\\README.md",
        "\\\\server\\share\\README.md"
      ] as const

      for (const path of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "App.onOpenFile"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000400,
                    traceId: "event-trace",
                    method,
                    payload: { path }
                  })
                )
              : Stream.empty
        }

        const result = yield* runScoped(
          Effect.gen(function* () {
            const app = yield* App
            return yield* app.onOpenFile().pipe(Stream.take(1), Stream.runCollect)
          }),
          Layer.provide(
            AppLive,
            makeAppBridgeClientLayer(exchange, {
              nextRequestId: nextId(["unused"]),
              nextTraceId: nextId(["unused"]),
              now: nextNumber([1710000000000])
            })
          )
        )

        expect(Array.from(result)).toEqual([new AppOpenFileEvent({ path })])
      }
    })
  ))

test("App bridge client rejects unsafe onOpenFile paths as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const NUL = String.fromCharCode(0)
      const cases: ReadonlyArray<{ readonly payload: unknown }> = [
        { payload: { path: "" } },
        { payload: { path: `/tmp/a${NUL}b` } },
        { payload: { path: "relative.txt" } },
        { payload: { path: "/tmp/../secret.txt" } },
        { payload: { path: "C:relative.txt" } },
        { payload: { path: "C:\\tmp\\..\\secret.txt" } },
        { payload: { path: "\\\\" } },
        { payload: { path: "\\\\server" } },
        { payload: { path: "\\\\server\\share\\.." } }
      ]

      for (const { payload } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "App.onOpenFile"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000400,
                    traceId: "event-trace",
                    method,
                    payload
                  })
                )
              : Stream.empty
        }

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const app = yield* App
            return yield* Effect.exit(app.onOpenFile().pipe(Stream.take(1), Stream.runCollect))
          }),
          Layer.provide(
            AppLive,
            makeAppBridgeClientLayer(exchange, {
              nextRequestId: nextId(["unused"]),
              nextTraceId: nextId(["unused"]),
              now: nextNumber([1710000000000])
            })
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("App bridge client rejects dangerous onOpenUrl schemes as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<unknown> = [
        { url: "javascript:alert(1)" },
        { url: "data:text/html,unsafe" },
        { url: "file:///etc/passwd" },
        { url: "blob:https://example.com/id" },
        { url: "about:blank" },
        { url: "vbscript:msgbox(1)" },
        { url: "view-source:https://example.com" }
      ]

      for (const payload of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "App.onOpenUrl"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000400,
                    traceId: "event-trace",
                    method,
                    payload
                  })
                )
              : Stream.empty
        }

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const app = yield* App
            return yield* Effect.exit(app.onOpenUrl().pipe(Stream.take(1), Stream.runCollect))
          }),
          Layer.provide(AppLive, makeAppBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("App bridge client rejects empty or NUL-bearing lifecycle args as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        App.asEffect(),
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(
            appExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exits = yield* Effect.all(
        [
          Effect.exit(client.restart({ args: [""] })),
          Effect.exit(client.restart({ args: ["--flag", "value\u0000broken"] })),
          Effect.exit(client.relaunch({ args: [""] })),
          Effect.exit(client.relaunch({ args: ["--flag", "value\u0000broken"] }))
        ],
        { concurrency: "unbounded" }
      )

      for (const exit of exits) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("App bridge client rejects non-portable quit exit codes as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        App.asEffect(),
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(
            appExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exit256 = yield* Effect.exit(client.quit({ exitCode: 256 }))
      const aliasExit256 = yield* Effect.exit(client.exit({ exitCode: 256 }))
      expectExitFailure(exit256, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(aliasExit256, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("AppMetadataRpcs declares the Phase 8 AppMetadata method and event surface", () => {
  expect([...AppMetadataMethodNames]).toEqual(expectedAppMetadataMethods)
  expect(Array.from(AppMetadataRpcs.requests.keys())).toEqual([
    "AppMetadata.getInfo",
    "AppMetadata.getPaths",
    "AppMetadata.getLaunchContext"
  ])
  expect(rpcMethodNames("AppMetadata", AppMetadataRpcs)).toEqual(expectedAppMetadataMethods)
  expect(Object.keys(AppMetadataRpcEvents)).toEqual(["Event"])
})

test("AppMetadata contracts reject inconsistent event phase payloads", () => {
  for (const payload of [
    { phase: "info-read", reason: "host failed" },
    { phase: "paths-read", reason: "host failed" },
    { phase: "launch-context-read", reason: "host failed" },
    { phase: "failed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(AppMetadataEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    { phase: "info-read" },
    { phase: "paths-read" },
    { phase: "launch-context-read" },
    { phase: "failed", reason: "host failed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(AppMetadataEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("AppMetadata service delegates through a substitutable AppMetadataClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const metadata = yield* AppMetadata
            const info = yield* metadata.getInfo()
            const paths = yield* metadata.getPaths()
            const launchContext = yield* metadata.getLaunchContext()
            const events = yield* metadata.events().pipe(Stream.take(1), Stream.runCollect)

            return { events, info, launchContext, paths }
          }),
          makeAppMetadataServiceLayer(appMetadataClient(calls))
        )
      )

      expect(result.info).toEqual(appMetadataInfo)
      expect(result.paths).toEqual(appMetadataPaths)
      expect(result.launchContext).toEqual(appMetadataLaunchContext)
      expect(Array.from(result.events)).toEqual([
        new AppMetadataEvent({ phase: "failed", reason: "host-adapter-unimplemented" })
      ])
      expect(calls).toEqual(["getInfo", "getPaths", "getLaunchContext", "events"])
    })
  ))

test("AppMetadata bridge client sends typed host envelopes and decodes events and results", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = appMetadataExchange(requests, (request) => {
        if (request.method === "AppMetadata.getInfo") {
          return {
            kind: "success",
            payload: {
              id: "dev.effect-desktop.test",
              name: "ORIKA Test",
              version: "0.0.0"
            }
          }
        }
        if (request.method === "AppMetadata.getPaths") {
          return {
            kind: "success",
            payload: {
              executable: { path: "/Applications/Test.app/Contents/MacOS/test" },
              resources: { path: "/Applications/Test.app/Contents/Resources" },
              cwd: { path: "/repo" }
            }
          }
        }
        if (request.method === "AppMetadata.getLaunchContext") {
          return {
            kind: "success",
            payload: {
              argv: ["test", "--safe-mode"],
              cwd: { path: "/repo" },
              reason: "launch",
              environment: { variableNames: ["PATH", "HOME"] }
            }
          }
        }
        return { kind: "success", payload: undefined }
      })

      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const metadata = yield* AppMetadata
            const info = yield* metadata.getInfo()
            const paths = yield* metadata.getPaths()
            const launchContext = yield* metadata.getLaunchContext()
            const events = yield* metadata.events().pipe(Stream.take(1), Stream.runCollect)

            return { events, info, launchContext, paths }
          }),
          Layer.provide(AppMetadataLive, makeAppMetadataBridgeClientLayer(exchange))
        )
      )

      expect(result.info).toEqual(appMetadataInfo)
      expect(result.paths).toEqual(appMetadataPaths)
      expect(result.launchContext).toEqual(appMetadataLaunchContext)
      expect(Array.from(result.events)).toEqual([
        new AppMetadataEvent({ phase: "failed", reason: "host-adapter-unimplemented" })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["AppMetadata.getInfo", null],
        ["AppMetadata.getPaths", null],
        ["AppMetadata.getLaunchContext", null]
      ])
    })
  ))

test("AppMetadata bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: undefined }),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1_710_000_000_100,
              traceId: "app-metadata-event-trace",
              method,
              payload: { phase: "failed" }
            })
          )
      }
      const exit = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const metadata = yield* AppMetadata
            return yield* Effect.exit(metadata.events().pipe(Stream.take(1), Stream.runHead))
          }),
          Layer.provide(AppMetadataLive, makeAppMetadataBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("AppMetadata bridge client rejects malformed host output as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const metadata = yield* AppMetadata
          const infoExit = yield* Effect.exit(metadata.getInfo())
          const pathsExit = yield* Effect.exit(metadata.getPaths())
          const launchContextExit = yield* Effect.exit(metadata.getLaunchContext())
          return { infoExit, launchContextExit, pathsExit }
        }),
        Layer.provide(
          AppMetadataLive,
          makeAppMetadataBridgeClientLayer(
            appMetadataExchange(requests, (request) => {
              if (request.method === "AppMetadata.getInfo") {
                return {
                  kind: "success",
                  payload: { id: "", name: "ORIKA Test", version: "not-semver" }
                }
              }
              if (request.method === "AppMetadata.getPaths") {
                return {
                  kind: "success",
                  payload: {
                    executable: { path: "relative" },
                    resources: { path: "/resources" },
                    cwd: { path: "/repo" }
                  }
                }
              }
              return {
                kind: "success",
                payload: {
                  argv: ["test", "bad\u0000arg"],
                  cwd: { path: "/repo" },
                  reason: "scheduled",
                  environment: { variableNames: ["PATH"] }
                }
              }
            })
          )
        )
      )

      expectExitFailure(result.infoExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(result.pathsExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(result.launchContextExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["AppMetadata.getInfo", null],
        ["AppMetadata.getPaths", null],
        ["AppMetadata.getLaunchContext", null]
      ])
    })
  ))

test("native host RPC runtime denies protected AppMetadata calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostAppMetadataRpcRuntime(
        {
          "AppMetadata.getInfo": () =>
            Effect.sync(() => {
              calls.push("getInfo")
              return appMetadataInfo
            }),
          "AppMetadata.getPaths": () => Effect.succeed(appMetadataPaths),
          "AppMetadata.getLaunchContext": () => Effect.succeed(appMetadataLaunchContext)
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "app-metadata-denied",
            method: "AppMetadata.getInfo",
            timestamp: 1710000000000,
            traceId: "trace-app-metadata-denied"
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("native host RPC runtime allows declared AppMetadata permissions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostAppMetadataRpcRuntime(
        {
          "AppMetadata.getInfo": () =>
            Effect.sync(() => {
              calls.push("getInfo")
              return appMetadataInfo
            }),
          "AppMetadata.getPaths": () => Effect.succeed(appMetadataPaths),
          "AppMetadata.getLaunchContext": () => Effect.succeed(appMetadataLaunchContext)
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )
      const permissions = yield* makePermissionRegistry()
      yield* permissions.declare(Native.Permissions.appMetadata.getInfo, {
        source: "app-metadata-test",
        effect: "allow"
      })

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "app-metadata-allowed",
            method: "AppMetadata.getInfo",
            timestamp: 1710000000000,
            traceId: "trace-app-metadata-allowed"
          })
        ),
        Layer.succeed(PermissionRegistry)(permissions)
      )

      expect(response.kind).toBe("success")
      if (response.kind === "success") {
        expect(response.payload).toEqual({
          id: "dev.effect-desktop.test",
          name: "ORIKA Test",
          version: "0.0.0"
        })
      }
      expect(calls).toEqual(["getInfo"])
    })
  ))

test("AppMetadata service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported AppMetadata.getInfo",
        operation: "AppMetadata.getInfo",
        recoverable: false
      })
      const unsupportedClient: AppMetadataClientApi = {
        ...appMetadataClient([]),
        getInfo: () => Effect.fail(unsupported)
      }
      const hostFailureClient: AppMetadataClientApi = {
        ...appMetadataClient([]),
        getInfo: () => Effect.fail(makeHostProtocolHostUnavailableError("AppMetadata.getInfo"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const metadata = yield* AppMetadata
          return yield* Effect.exit(metadata.getInfo())
        }),
        makeAppMetadataServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const metadata = yield* AppMetadata
          return yield* Effect.exit(metadata.getInfo())
        }),
        makeAppMetadataServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("WebViewRpcs declares the Phase 7 WebView method and event surface", () => {
  expect([...WebViewMethodNames]).toEqual(expectedWebViewMethods)
  expect(rpcMethodNames("WebView", WebViewRpcs)).toEqual(expectedWebViewMethods)
  expect(Object.keys(WebViewRpcEvents)).toEqual([
    "NavigationBlocked",
    "ApiCall",
    "Runtime",
    "Frame"
  ])
})

test("WebView support metadata reflects resource lifecycle, print, and devtools platform gates", () => {
  const byTag = new Map(WebViewSurface.schemaDocs.map((doc) => [doc.tag, doc] as const))
  expect(byTag.get("WebView.create")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.destroy")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.loadRoute")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.loadUrl")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.reload")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.stop")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.print")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.setZoom")?.support).toEqual({ status: "supported" })
  expect(byTag.get("WebView.goBack")?.support).toEqual(webViewNavigationTrackedSupport)
  expect(byTag.get("WebView.goForward")?.support).toEqual(webViewNavigationTrackedSupport)
  expect(byTag.get("WebView.getNavigationState")?.support).toEqual(webViewNavigationTrackedSupport)
  expect(byTag.get("WebView.setNavigationPolicy")?.support).toEqual(webViewNavigationPolicySupport)
  expect(byTag.get("WebView.openDevTools")?.support).toEqual(webViewOpenDevToolsSupport)
  expect(byTag.get("WebView.closeDevTools")?.support).toEqual(webViewCloseDevToolsSupport)
})

test("WebView declares unsupported methods as non-callable capability facts", () => {
  const factTags = WebViewCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    expectedWebViewCapabilityFactMethods.map((method) => `WebView.${method}`).toSorted()
  )
  const byTag = new Map(WebViewCapabilityFacts.map((fact) => [fact.tag, fact] as const))
  expect(byTag.get("WebView.attachDebugger")?.support).toEqual(webViewDebuggerUnsupportedSupport)
  expect(byTag.get("WebView.captureScreenshot")?.support).toEqual(webViewDocumentUnsupportedSupport)
  expect(byTag.get("WebView.printToPdf")?.support).toEqual(webViewDocumentUnsupportedSupport)
  expect(byTag.get("WebView.findInPage")?.support).toEqual(webViewFindInPageUnsupportedSupport)
  expect(byTag.get("WebView.setUserAgent")?.support).toEqual(
    webViewRuntimeUserAgentUnsupportedSupport
  )
  expect(byTag.get("WebView.setAudioMuted")?.support).toEqual(
    webViewRuntimeMediaControlUnsupportedSupport
  )
  expect(byTag.get("WebView.respondToPermission")?.support).toEqual(
    webViewRuntimePermissionUnsupportedSupport
  )
  expect(byTag.get("WebView.listFrames")?.support).toEqual(webViewFrameRoutingUnsupportedSupport)
  expect(byTag.get("WebView.postToFrame")?.support).toEqual(webViewFrameRoutingUnsupportedSupport)
  expect(byTag.has("WebView.capability")).toBe(false)
  for (const fact of WebViewCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }
  const callableTags = Array.from(WebViewRpcs.requests.keys())
  for (const method of expectedWebViewCapabilityFactMethods) {
    expect(callableTags).not.toContain(`WebView.${method}`)
  }
})

test("WebView capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: WebViewSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))
      for (const method of expectedWebViewCapabilityFactMethods) {
        const fact = byTag.get(`WebView.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }
      expect(byTag.get("WebView.attachDebugger")?.support).toEqual(
        webViewDebuggerUnsupportedSupport
      )
      expect(byTag.get("WebView.captureScreenshot")?.support).toEqual(
        webViewDocumentUnsupportedSupport
      )
      expect(byTag.get("WebView.printToPdf")?.support).toEqual(webViewDocumentUnsupportedSupport)
      expect(byTag.get("WebView.findInPage")?.support).toEqual(webViewFindInPageUnsupportedSupport)
      expect(byTag.get("WebView.setUserAgent")?.support).toEqual(
        webViewRuntimeUserAgentUnsupportedSupport
      )
      expect(byTag.get("WebView.setAudioMuted")?.support).toEqual(
        webViewRuntimeMediaControlUnsupportedSupport
      )
      expect(byTag.get("WebView.respondToPermission")?.support).toEqual(
        webViewRuntimePermissionUnsupportedSupport
      )
      expect(byTag.get("WebView.listFrames")?.support).toEqual(
        webViewFrameRoutingUnsupportedSupport
      )
      expect(byTag.get("WebView.postToFrame")?.support).toEqual(
        webViewFrameRoutingUnsupportedSupport
      )
      expect(byTag.has("WebView.capability")).toBe(false)
      const nonCallableTags = WebViewSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        expectedWebViewCapabilityFactMethods.map((method) => `WebView.${method}`).toSorted()
      )
    })
  ))

test("WebView service delegates through a substitutable WebViewClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          const created = yield* webview.create(windowHandle)
          yield* webview.loadRoute(created, "/settings")
          yield* webview.loadUrl(created, "https://example.com")
          yield* webview.reload(created)
          yield* webview.stop(created)
          yield* webview.goBack(created)
          yield* webview.goForward(created)
          const navigationState = yield* webview.getNavigationState(created)
          yield* webview.print(created)
          yield* webview.setZoom(created, 1.25)
          yield* webview.openDevTools(created)
          yield* webview.closeDevTools(created)
          yield* webview.setNavigationPolicy(created, {
            allowedOrigins: ["app://localhost"],
            onDisallowed: "block"
          })
          const blocked = yield* webview
            .onNavigationBlocked()
            .pipe(Stream.take(1), Stream.runCollect)
          const apiCalls = yield* webview.onApiCall().pipe(Stream.take(1), Stream.runCollect)
          const runtimeEvents = yield* webview
            .onRuntimeEvent(created)
            .pipe(Stream.take(1), Stream.runCollect)
          const frameEvents = yield* webview
            .onFrameEvent(created)
            .pipe(Stream.take(1), Stream.runCollect)
          yield* webview.destroy(created)

          return {
            apiCalls,
            blocked,
            created,
            frameEvents,
            navigationState,
            runtimeEvents
          }
        }),
        makeWebViewServiceLayer(webViewClient(calls))
      )

      expect(result.created).toMatchObject(webviewHandle)
      expect(result.navigationState).toEqual({
        canGoBack: true,
        canGoForward: false,
        loading: false
      })
      expect(Array.from(result.blocked)).toEqual([
        new WebViewNavigationBlockedEvent({
          webview: webviewHandle,
          url: "https://blocked.example",
          reason: "origin not allowed"
        })
      ])
      expect(Array.from(result.apiCalls)).toEqual([
        new WebViewApiCallEvent({
          webview: webviewHandle,
          api: "desktop",
          method: "ping",
          payload: '{"ok":true}'
        })
      ])
      expect(Array.from(result.runtimeEvents)).toEqual([
        new WebViewRuntimeEvent({
          webview: webviewHandle,
          phase: "drag-drop",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 }
        })
      ])
      expect(Array.from(result.frameEvents)).toEqual([
        new WebViewFrameEvent({
          webview: webviewHandle,
          frame: webviewFrameHandle,
          phase: "created",
          url: "https://example.com/frame"
        })
      ])
      expect(calls).toEqual([
        "create:app://localhost/",
        "loadRoute:/settings",
        "loadUrl:https://example.com",
        "reload",
        "stop",
        "goBack",
        "goForward",
        "getNavigationState",
        "print",
        "setZoom:1.25",
        "openDevTools",
        "closeDevTools",
        "setNavigationPolicy:app://localhost:block",
        "destroy"
      ])
    })
  ))

test("WebView service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported WebView.create",
        operation: "WebView.create",
        recoverable: false
      })
      const unsupportedClient: WebViewClientApi = {
        ...webViewClient([]),
        create: () => Effect.fail(unsupported)
      }
      const hostFailureClient: WebViewClientApi = {
        ...webViewClient([]),
        create: () => Effect.fail(makeHostProtocolHostUnavailableError("WebView.create"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* Effect.exit(webview.create(windowHandle))
        }),
        makeWebViewServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* Effect.exit(webview.create(windowHandle))
        }),
        makeWebViewServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("WebView document controls propagate success, unsupported, and host failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const success = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          yield* webview.print(webviewHandle)
          yield* webview.setZoom(webviewHandle, 1.25)
        }),
        makeWebViewServiceLayer(webViewClient(calls))
      )

      expect(success).toBeUndefined()
      expect(calls).toEqual(["print", "setZoom:1.25"])

      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-print-zoom-provider-backed",
        message: "unsupported WebView.print",
        operation: WEBVIEW_PRINT_METHOD,
        recoverable: false
      })
      const unsupportedClient: WebViewClientApi = {
        ...webViewClient([]),
        print: () => Effect.fail(unsupported)
      }
      const hostFailureClient: WebViewClientApi = {
        ...webViewClient([]),
        print: () => Effect.fail(makeHostProtocolHostUnavailableError(WEBVIEW_PRINT_METHOD))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* Effect.exit(webview.print(webviewHandle))
        }),
        makeWebViewServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* Effect.exit(webview.print(webviewHandle))
        }),
        makeWebViewServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("WebView devtools controls propagate success, unsupported, and host failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const successResult = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          yield* webview.openDevTools(webviewHandle)
          yield* webview.closeDevTools(webviewHandle)
        }),
        makeWebViewServiceLayer(webViewClient(calls))
      )
      expect(successResult).toBeUndefined()
      expect(calls).toEqual(["openDevTools", "closeDevTools"])

      const devtoolsUnsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-devtools-build-gated",
        message: "unsupported WebView.openDevTools",
        operation: WEBVIEW_OPEN_DEVTOOLS_METHOD,
        recoverable: false
      })
      const unsupportedClient: WebViewClientApi = {
        ...webViewClient([]),
        openDevTools: () => Effect.fail(devtoolsUnsupported)
      }
      const hostFailureClient: WebViewClientApi = {
        ...webViewClient([]),
        closeDevTools: () =>
          Effect.fail(makeHostProtocolHostUnavailableError(WEBVIEW_CLOSE_DEVTOOLS_METHOD))
      }

      const devtoolsExit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* Effect.exit(webview.openDevTools(webviewHandle))
        }),
        makeWebViewServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* Effect.exit(webview.closeDevTools(webviewHandle))
        }),
        makeWebViewServiceLayer(hostFailureClient)
      )

      expectExitFailure(devtoolsExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("native host RPC runtime denies protected WebView document and devtools calls", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const deniedRows: AuditEvent[] = []
      const runtime = makeNativeHostRpcRuntime(WebViewRpcs, WebViewHandlersLive, {
        originAuth: RendererOriginAuth.unsafeDisabledForTests
      })
      const calls = [
        {
          method: WEBVIEW_PRINT_METHOD,
          capability: P.nativeInvoke({ primitive: "WebView", methods: ["print"] })
        },
        {
          method: WEBVIEW_SET_ZOOM_METHOD,
          capability: P.nativeInvoke({ primitive: "WebView", methods: ["setZoom"] })
        },
        {
          method: WEBVIEW_OPEN_DEVTOOLS_METHOD,
          capability: P.nativeInvoke({ primitive: "WebView", methods: ["openDevTools"] })
        },
        {
          method: WEBVIEW_CLOSE_DEVTOOLS_METHOD,
          capability: P.nativeInvoke({ primitive: "WebView", methods: ["closeDevTools"] })
        }
      ] as const
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(deniedRows),
        traceId: () => "trace-webview-denied"
      })

      for (const [index, call] of calls.entries()) {
        const response = yield* runtime
          .dispatch(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: `webview-devtools-denied-${index}`,
              method: call.method,
              payload: webviewDeniedPayload(call.method),
              timestamp: 1_710_000_002_600 + index,
              traceId: `trace-webview-devtools-denied-${index}`
            })
          )
          .pipe(Effect.provideService(PermissionRegistry, permissions))

        expect(response.kind).toBe("failure")
        if (response.kind === "failure") {
          expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
        }
      }

      expect(deniedRows.map((row) => row.kind)).toEqual(calls.map(() => "permission-denied"))
      expect(deniedRows.map((row) => row.normalizedCapability)).toEqual(
        calls.map((call) => call.capability)
      )
    })
  ))

const webviewDeniedPayload = (method: string): unknown => {
  if (method === WEBVIEW_SET_ZOOM_METHOD) {
    return { webview: webviewHandle, zoom: 1.25 }
  }
  return { webview: webviewHandle }
}

test("WebView bridge client sends typed host envelopes and decodes event streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = webViewExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "WebView.create"
            ? webviewHandle
            : request.method === "WebView.getNavigationState"
              ? { canGoBack: true, canGoForward: false, loading: false }
              : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          const created = yield* webview.create(windowHandle, {
            url: "app://localhost/settings",
            originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" },
            isolation: { exposedApis: [{ name: "desktop", methods: ["ping"] }] }
          })
          yield* webview.loadRoute(created, "/settings")
          yield* webview.stop(created)
          const navigationState = yield* webview.getNavigationState(created)
          yield* webview.setNavigationPolicy(created, {
            allowedOrigins: ["app://localhost", "https://example.com"],
            onDisallowed: "openExternal"
          })
          yield* webview.print(created)
          yield* webview.setZoom(created, 1.25)
          yield* webview.openDevTools(created)
          yield* webview.closeDevTools(created)
          const blocked = yield* webview
            .onNavigationBlocked()
            .pipe(Stream.take(1), Stream.runCollect)
          const apiCalls = yield* webview.onApiCall().pipe(Stream.take(1), Stream.runCollect)
          const runtimeEvents = yield* webview
            .onRuntimeEvent(created)
            .pipe(Stream.take(1), Stream.runCollect)
          const frameEvents = yield* webview
            .onFrameEvent(created)
            .pipe(Stream.take(1), Stream.runCollect)

          return {
            apiCalls,
            blocked,
            created,
            frameEvents,
            navigationState,
            runtimeEvents
          }
        }),
        Layer.provide(WebViewLive, makeWebViewBridgeClientLayer(exchange))
      )

      expect(result.created).toMatchObject(webviewHandle)
      expect(result.navigationState).toEqual({
        canGoBack: true,
        canGoForward: false,
        loading: false
      })
      expect(Array.from(result.blocked)).toEqual([
        new WebViewNavigationBlockedEvent({
          webview: webviewHandle,
          url: "https://blocked.example",
          reason: "origin not allowed"
        })
      ])
      expect(Array.from(result.apiCalls)).toEqual([
        new WebViewApiCallEvent({
          webview: webviewHandle,
          api: "desktop",
          method: "ping",
          payload: '{"ok":true}'
        })
      ])
      expect(Array.from(result.runtimeEvents)).toEqual([
        new WebViewRuntimeEvent({
          webview: webviewHandle,
          phase: "drag-drop",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 }
        })
      ])
      expect(Array.from(result.frameEvents)).toEqual([
        new WebViewFrameEvent({
          webview: webviewHandle,
          frame: webviewFrameHandle,
          phase: "created",
          url: "https://example.com/frame"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [
          "WebView.create",
          {
            window: windowHandle,
            url: "app://localhost/settings",
            originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" },
            isolation: { exposedApis: [{ name: "desktop", methods: ["ping"] }] }
          }
        ],
        ["WebView.loadRoute", { webview: webviewHandle, route: "/settings" }],
        ["WebView.stop", { webview: webviewHandle }],
        ["WebView.getNavigationState", { webview: webviewHandle }],
        [
          "WebView.setNavigationPolicy",
          {
            webview: webviewHandle,
            policy: {
              allowedOrigins: ["app://localhost", "https://example.com"],
              onDisallowed: "openExternal"
            }
          }
        ],
        ["WebView.print", { webview: webviewHandle }],
        ["WebView.setZoom", { webview: webviewHandle, zoom: 1.25 }],
        ["WebView.openDevTools", { webview: webviewHandle }],
        ["WebView.closeDevTools", { webview: webviewHandle }]
      ])
    })
  ))

test("WebView getNavigationState rejects malformed host output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WebView
          const created = yield* client.create(windowHandle)
          return yield* Effect.exit(client.getNavigationState(created))
        }),
        Layer.provide(
          WebViewLive,
          makeWebViewBridgeClientLayer(
            webViewExchange(requests, (request) => ({
              kind: "success",
              payload:
                request.method === "WebView.create"
                  ? webviewHandle
                  : request.method === "WebView.getNavigationState"
                    ? { canGoBack: true, loading: false }
                    : undefined
            }))
          )
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [
          "WebView.create",
          {
            window: windowHandle,
            url: "app://localhost/",
            originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" }
          }
        ],
        ["WebView.getNavigationState", { webview: webviewHandle }]
      ])
    })
  ))

test("WebView bridge client rejects control-byte navigation-blocked reasons", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: (request) =>
          Effect.succeed(
            request.method === "WebView.create"
              ? { kind: "success", payload: webviewHandle }
              : { kind: "success", payload: undefined }
          ),
        subscribe: (method) =>
          method === "WebView.NavigationBlocked"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000200,
                  traceId: "event-trace",
                  method,
                  payload: {
                    webview: webviewHandle,
                    url: "https://blocked.example",
                    reason: `origin not allowed ${String.fromCharCode(0)}`
                  }
                })
              )
            : Stream.empty
      }
      const exit = yield* Effect.exit(
        Effect.scoped(
          runScoped(
            Effect.gen(function* () {
              const webview = yield* WebView
              yield* webview.create(windowHandle)
              return yield* webview.onNavigationBlocked().pipe(Stream.take(1), Stream.runCollect)
            }),
            Layer.provide(
              WebViewLive,
              makeWebViewBridgeClientLayer(exchange, { nextTraceId: () => "trace" })
            )
          )
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  ))

test("WebView bridge client rejects invalid navigation-blocked event URLs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: (request) =>
          Effect.succeed(
            request.method === "WebView.create"
              ? { kind: "success", payload: webviewHandle }
              : { kind: "success", payload: undefined }
          ),
        subscribe: (method) =>
          method === "WebView.NavigationBlocked"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000201,
                  traceId: "event-trace",
                  method,
                  payload: {
                    webview: webviewHandle,
                    url: "not a url",
                    reason: "origin not allowed"
                  }
                })
              )
            : Stream.empty
      }
      const exit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const webview = yield* WebView
            yield* webview.create(windowHandle)
            return yield* webview.onNavigationBlocked().pipe(Stream.take(1), Stream.runCollect)
          }),
          Layer.provide(
            WebViewLive,
            makeWebViewBridgeClientLayer(exchange, { nextTraceId: () => "trace" })
          )
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("WebView bridge client rejects undeclared API-call event names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: (request) =>
          Effect.succeed(
            request.method === "WebView.create"
              ? { kind: "success", payload: webviewHandle }
              : { kind: "success", payload: undefined }
          ),
        subscribe: (method) =>
          method === "WebView.ApiCall"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000202,
                  traceId: "event-trace",
                  method,
                  payload: {
                    webview: webviewHandle,
                    api: "desktop-api",
                    method: "ping",
                    payload: "{}"
                  }
                })
              )
            : Stream.empty
      }
      const exit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const webview = yield* WebView
            yield* webview.create(windowHandle)
            return yield* webview.onApiCall().pipe(Stream.take(1), Stream.runCollect)
          }),
          Layer.provide(
            WebViewLive,
            makeWebViewBridgeClientLayer(exchange, { nextTraceId: () => "trace" })
          )
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("WebView bridge client rejects control-byte runtime event paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = webViewExchange([], (request) => ({
        kind: "success",
        payload: request.method === "WebView.create" ? webviewHandle : undefined
      }))
      const unsafeExchange: BridgeClientExchange = {
        ...exchange,
        subscribe: (method) =>
          method === WEBVIEW_RUNTIME_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000203,
                  traceId: "event-trace-runtime-unsafe",
                  method,
                  payload: {
                    webview: webviewHandle,
                    phase: "drag-drop",
                    paths: [`/tmp/${String.fromCharCode(0)}secret`],
                    position: { x: 12, y: 24 }
                  }
                })
              )
            : Stream.empty
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const webview = yield* WebView
          return yield* webview
            .onRuntimeEvent()
            .pipe(Stream.take(1), Stream.runCollect, Effect.exit)
        }),
        Layer.provide(
          WebViewLive,
          makeWebViewBridgeClientLayer(unsafeExchange, { nextTraceId: () => "trace" })
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("WebView bridge client rejects unsafe navigation inputs before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = webViewExchange(requests, () => ({
        kind: "success",
        payload: webviewHandle
      }))
      const client = yield* runScoped(
        WebView.asEffect(),
        Layer.provide(WebViewLive, makeWebViewBridgeClientLayer(exchange))
      )

      const javascriptCreateExit = yield* Effect.exit(
        client.create(windowHandle, {
          url: "javascript:alert(1)",
          originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" }
        })
      )
      const fileUrlExit = yield* Effect.exit(client.loadUrl(webviewHandle, "file:///etc/passwd"))
      const traversalExit = yield* Effect.exit(client.loadRoute(webviewHandle, "../secret"))
      const emptyOriginExit = yield* Effect.exit(
        client.create(windowHandle, {
          url: "app://localhost/",
          originPolicy: { allowedOrigins: [""], onDisallowed: "block" }
        })
      )
      const javascriptOriginExit = yield* Effect.exit(
        client.create(windowHandle, {
          url: "app://localhost/",
          originPolicy: { allowedOrigins: ["javascript:"], onDisallowed: "block" }
        })
      )
      const policyExit = yield* Effect.exit(
        client.setNavigationPolicy(webviewHandle, {
          allowedOrigins: ["file://"],
          onDisallowed: "block"
        })
      )
      const isolationExit = yield* Effect.exit(
        client.create(windowHandle, {
          url: "app://localhost/",
          originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" },
          isolation: {
            exposedApis: [{ name: "desktop-api", methods: ["ping"] }]
          }
        })
      )

      expectExitFailure(javascriptCreateExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(fileUrlExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(traversalExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(emptyOriginExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(javascriptOriginExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(policyExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(isolationExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("WebView capability matrix reports spec-partial features as unsupported", () => {
  expect(webViewCapability("print", "linux")).toBe(true)
  expect(webViewCapability("popup blocking", "linux")).toBe(false)
  expect(webViewCapability("getUserMedia", "linux")).toBe(false)
  expect(webViewCapability("service workers in app:", "linux")).toBe(false)
  expect(webViewCapability("service workers in app:", "macos")).toBe(false)
  expect(webViewCapability("print", "windows")).toBe(true)
  expect(webViewCapability("PDF embedded viewer", "linux")).toBe(false)
})

test("MenuRpcs declares the Phase 7 Menu method and event surface", () => {
  expect([...MenuMethodNames]).toEqual(expectedMenuMethods)
  expect(rpcMethodNames("Menu", MenuRpcs)).toEqual(expectedMenuMethods)
  expect(Object.keys(MenuRpcEvents)).toEqual(["Activated"])
})

test("Menu declares only callable native RPCs and no TypeScript helper capability facts", () => {
  const factTags = MenuCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    expectedMenuCapabilityFactMethods.map((method) => `Menu.${method}`).toSorted()
  )
  for (const fact of MenuCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
    expect(fact.capability.kind).toBe("native.invoke")
  }

  const callableTags = Array.from(MenuRpcs.requests.keys())
  for (const method of expectedMenuCapabilityFactMethods) {
    expect(callableTags).not.toContain(`Menu.${method}`)
  }

  const nonCallableTags = MenuSurface.schemaDocs
    .filter((doc) => !doc.callable)
    .map((doc) => doc.tag)
    .toSorted()
  expect(nonCallableTags).toEqual(
    expectedMenuCapabilityFactMethods.map((method) => `Menu.${method}`).toSorted()
  )
})

test("Menu service delegates through a substitutable MenuClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const commandLayer = yield* makeCommandBindingLayer(commandCalls)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const menu = yield* Menu
          yield* menu.setApplicationMenu(applicationMenuTemplate)
          yield* menu.setWindowMenu(windowHandle, menuTemplate)
          yield* menu.bindCommand("file.open", "app.file.open")
          const linuxAppMenu = yield* menu.capability("application menu", { platform: "linux" })
          const activated = yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
          yield* menu.clear({ window: windowHandle })
          yield* menu.clear()

          return { activated, linuxAppMenu }
        }),
        Layer.mergeAll(makeMenuServiceLayer(menuClient(calls)), commandLayer)
      )
      yield* Effect.sleep("10 millis")

      expect(result.linuxAppMenu).toBe(false)
      expect(commandCalls).toEqual([{ itemId: "file.open", windowId: "window-1" }])
      expect(Array.from(result.activated)).toEqual([
        new MenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      ])
      expect(calls).toEqual([
        "setApplicationMenu:1",
        "setWindowMenu:window-1:3",
        "bindCommand:file.open:app.file.open",
        "clear:window-1",
        "clear:application"
      ])
    })
  ))

test("Menu bindCommand does not duplicate listeners for identical bindings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const commandLayer = yield* makeCommandBindingLayer(commandCalls)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const menu = yield* Menu
          const first = yield* menu.bindCommand("file.open", "app.file.open")
          const second = yield* menu.bindCommand("file.open", "app.file.open")
          return { first, second }
        }),
        Layer.mergeAll(makeMenuServiceLayer(menuClient(calls)), commandLayer)
      )
      yield* Effect.sleep("10 millis")

      expect(result.second).toEqual({
        kind: result.first.kind,
        id: result.first.id,
        generation: result.first.generation,
        ownerScope: result.first.ownerScope,
        state: result.first.state
      })
      expect(commandCalls).toEqual([{ itemId: "file.open", windowId: "window-1" }])
      expect(calls).toEqual(["bindCommand:file.open:app.file.open"])
    })
  ))

test("Menu bindCommand closes the command listener with its resource scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const activated = yield* Queue.unbounded<MenuActivatedEvent>()
      const invoked = yield* Deferred.make<void>()
      const resources = yield* makeResourceRegistry()
      const permissions = yield* makePermissionRegistry()
      const commands = yield* makeCommandRegistry(resources, permissions)
      yield* permissions.declare(menuCommandCapability, { source: "test" })
      yield* registerTestCommand(commands, {
        id: "app.file.open",
        payload: Schema.Struct({
          itemId: Schema.String,
          windowId: Schema.optionalKey(Schema.String)
        }),
        capability: menuCommandCapability,
        ownerScope: "app",
        handler: (input) =>
          Effect.sync(() => {
            commandCalls.push(input)
          }).pipe(Effect.tap(() => Deferred.succeed(invoked, undefined)))
      })

      yield* runScoped(
        Effect.gen(function* () {
          const menu = yield* Menu
          return yield* menu.bindCommand("file.open", "app.file.open")
        }),
        Layer.mergeAll(
          makeMenuServiceLayer({
            ...menuClient(calls),
            onActivated: () => Stream.fromQueue(activated)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )

      yield* Queue.offer(
        activated,
        new MenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      )
      yield* Deferred.await(invoked)
      yield* resources.closeScope("app")
      yield* Queue.offer(
        activated,
        new MenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      )
      yield* Effect.sleep("10 millis")

      expect(commandCalls).toEqual([{ itemId: "file.open", windowId: "window-1" }])
      expect(calls).toEqual(["bindCommand:file.open:app.file.open"])
    })
  ))

test("Menu bindCommand keeps listening after a command invocation failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const activated = yield* Queue.unbounded<MenuActivatedEvent>()
      const recovered = yield* Deferred.make<void>()
      const resources = yield* makeResourceRegistry()
      const permissions = yield* makePermissionRegistry()
      const commands = yield* makeCommandRegistry(resources, permissions)
      let attempts = 0
      yield* permissions.declare(menuCommandCapability, { source: "test" })
      yield* registerTestCommand(commands, {
        id: "app.file.open",
        payload: Schema.Struct({
          itemId: Schema.String,
          windowId: Schema.optionalKey(Schema.String)
        }),
        capability: menuCommandCapability,
        ownerScope: "app",
        handler: (input) =>
          Effect.gen(function* () {
            attempts += 1
            commandCalls.push(input)
            if (attempts === 1) {
              return yield* new TestCommandHandlerError({ message: "command failed" })
            }
            yield* Deferred.succeed(recovered, undefined)
          })
      })

      yield* runScoped(
        Effect.gen(function* () {
          const menu = yield* Menu
          return yield* menu.bindCommand("file.open", "app.file.open")
        }),
        Layer.mergeAll(
          makeMenuServiceLayer({
            ...menuClient(calls),
            onActivated: () => Stream.fromQueue(activated)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )

      const event = new MenuActivatedEvent({
        itemId: "file.open",
        commandId: "app.file.open",
        windowId: "window-1"
      })
      yield* Queue.offer(activated, event)
      yield* Queue.offer(activated, event)
      yield* Deferred.await(recovered)

      expect(commandCalls).toEqual([
        { itemId: "file.open", windowId: "window-1" },
        { itemId: "file.open", windowId: "window-1" }
      ])
      expect(calls).toEqual(["bindCommand:file.open:app.file.open"])
    })
  ))

test("Menu bridge client validates templates, sends host envelopes, and decodes activation events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = menuExchange(requests, () => ({ kind: "success", payload: undefined }))
      const commandLayer = yield* makeCommandBindingLayer()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const menu = yield* Menu
          yield* menu.setApplicationMenu(applicationMenuTemplate)
          yield* menu.setWindowMenu(windowHandle, menuTemplate)
          const bindExit = yield* Effect.exit(menu.bindCommand("file.open", "app.file.open"))
          const activated = yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
          yield* menu.clear({ window: windowHandle })

          return { activated, bindExit }
        }),
        Layer.mergeAll(Layer.provide(MenuLive, makeMenuBridgeClientLayer(exchange)), commandLayer)
      )

      expect(Exit.isSuccess(result.bindExit)).toBe(true)
      expect(Array.from(result.activated)).toEqual([
        new MenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Menu.setApplicationMenu", { template: applicationMenuTemplate }],
        ["Menu.setWindowMenu", { window: windowHandle, template: menuTemplate }],
        ["Menu.clear", { window: windowHandle }]
      ])
    })
  ))

test("Menu bridge client rejects empty activation event identifiers as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly name: string
        readonly payload: { itemId: string; commandId: string; windowId?: string }
      }> = [
        {
          name: "empty itemId",
          payload: { itemId: "", commandId: "app.file.open", windowId: "window-1" }
        },
        {
          name: "empty commandId",
          payload: { itemId: "file.open", commandId: "", windowId: "window-1" }
        },
        {
          name: "empty windowId when present",
          payload: { itemId: "file.open", commandId: "app.file.open", windowId: "" }
        }
      ]

      for (const { payload } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "Menu.Activated"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000300,
                    traceId: "event-trace",
                    method,
                    payload
                  })
                )
              : Stream.empty
        }
        const commandLayer = yield* makeCommandBindingLayer()

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const menu = yield* Menu
            return yield* Effect.exit(menu.onActivated().pipe(Stream.take(1), Stream.runCollect))
          }),
          Layer.mergeAll(
            Layer.provide(
              MenuLive,
              makeMenuBridgeClientLayer(exchange, {
                nextRequestId: nextId(["unused"]),
                nextTraceId: nextId(["unused"]),
                now: nextNumber([1710000000000])
              })
            ),
            commandLayer
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("Menu bridge client decodes activation events with no windowId field", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
        subscribe: (method) =>
          method === "Menu.Activated"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000300,
                  traceId: "event-trace",
                  method,
                  payload: { itemId: "file.open", commandId: "app.file.open" }
                })
              )
            : Stream.empty
      }
      const commandLayer = yield* makeCommandBindingLayer()

      const events = yield* runScoped(
        Effect.gen(function* () {
          const menu = yield* Menu
          return yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
        }),
        Layer.mergeAll(
          Layer.provide(
            MenuLive,
            makeMenuBridgeClientLayer(exchange, {
              nextRequestId: nextId(["unused"]),
              nextTraceId: nextId(["unused"]),
              now: nextNumber([1710000000000])
            })
          ),
          commandLayer
        )
      )

      expect(Array.from(events)).toEqual([
        new MenuActivatedEvent({ itemId: "file.open", commandId: "app.file.open" })
      ])
    })
  ))

test("Menu bridge client returns invalid templates as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Menu.asEffect(),
        Layer.provide(
          MenuLive,
          makeMenuBridgeClientLayer(
            menuExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exit = yield* Effect.exit(
        client.setApplicationMenu({
          // @ts-expect-error intentionally malformed template item omits label.
          items: [{ type: "item", id: "file.open", commandId: "app.file.open" }]
        })
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("ContextMenu identifier schemas reject control bytes in bind input and activation events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const bindExit = yield* Effect.exit(
        Schema.decodeUnknownEffect(ContextMenuBindCommandInput)({
          itemId: "open\u0000x",
          commandId: "cmd\u0000x"
        })
      )
      const eventExit = yield* Effect.exit(
        Schema.decodeUnknownEffect(ContextMenuActivatedEvent)({
          itemId: "open\u0000x",
          commandId: "cmd\u0000x",
          windowId: "win\u0000x"
        })
      )

      expect(Exit.isFailure(bindExit)).toBe(true)
      expect(Exit.isFailure(eventExit)).toBe(true)
    })
  ))

test("Menu and ContextMenu schemas reject newline-bearing labels and ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
        {
          label: "menu item label",
          value: { items: [{ type: "item", id: "ok", label: "Open\n", commandId: "cmd" }] }
        },
        {
          label: "menu item id",
          value: { items: [{ type: "item", id: "ok\n", label: "Open", commandId: "cmd" }] }
        },
        {
          label: "menu item commandId",
          value: { items: [{ type: "item", id: "ok", label: "Open", commandId: "cmd\n" }] }
        },
        {
          label: "menu separator id",
          value: { items: [{ type: "separator", id: "sep\n" }] }
        },
        {
          label: "submenu id",
          value: {
            items: [{ type: "submenu", id: "view\n", label: "View", items: [] }]
          }
        },
        {
          label: "submenu label",
          value: {
            items: [{ type: "submenu", id: "view", label: "View\n", items: [] }]
          }
        }
      ]

      for (const { label, value } of cases) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(MenuTemplate)(value))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(label).toBeDefined()
      }

      const bindExit = yield* Effect.exit(
        Schema.decodeUnknownEffect(ContextMenuBindCommandInput)({
          itemId: "open\n",
          commandId: "cmd"
        })
      )
      const eventExit = yield* Effect.exit(
        Schema.decodeUnknownEffect(ContextMenuActivatedEvent)({
          itemId: "open",
          commandId: "cmd\n",
          windowId: "win-1"
        })
      )
      expect(Exit.isFailure(bindExit)).toBe(true)
      expect(Exit.isFailure(eventExit)).toBe(true)
    })
  ))

test("Menu bridge client rejects NUL-bearing accelerators before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Menu.asEffect(),
        Layer.provide(
          MenuLive,
          makeMenuBridgeClientLayer(
            menuExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const applicationExit = yield* Effect.exit(
        client.setApplicationMenu({
          items: [
            {
              type: "submenu",
              id: "file",
              label: "File",
              items: [
                {
                  type: "item",
                  id: "file.open",
                  label: "Open",
                  commandId: "app.file.open",
                  accelerator: "Cmd\u0000O"
                }
              ]
            }
          ]
        })
      )
      const windowExit = yield* Effect.exit(
        client.setWindowMenu(windowHandle, {
          items: [
            {
              type: "item",
              id: "file.open",
              label: "Open",
              commandId: "app.file.open",
              accelerator: ""
            }
          ]
        })
      )

      expectExitFailure(applicationExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(windowExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Menu bridge client rejects application menu root items before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Menu.asEffect(),
        Layer.provide(
          MenuLive,
          makeMenuBridgeClientLayer(
            menuExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exit = yield* Effect.exit(
        client.setApplicationMenu({
          items: [{ type: "item", id: "file.open", label: "Open", commandId: "app.file.open" }]
        })
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("ContextMenuRpcs declares the Phase 8 ContextMenu method and event surface", () => {
  expect([...ContextMenuMethodNames]).toEqual(expectedContextMenuMethods)
  expect(rpcMethodNames("ContextMenu", ContextMenuRpcs)).toEqual(expectedContextMenuMethods)
  expect(Object.keys(ContextMenuRpcEvents)).toEqual(["Activated"])
})

test("ContextMenu declares only host-backed operations as non-callable capability facts", () => {
  const factTags = ContextMenuCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    expectedContextMenuCapabilityFactMethods.map((method) => `ContextMenu.${method}`).toSorted()
  )
  for (const fact of ContextMenuCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
    expect(fact.capability.kind).toBe("native.invoke")
  }

  const callableTags = Array.from(ContextMenuRpcs.requests.keys())
  for (const method of expectedContextMenuCapabilityFactMethods) {
    expect(callableTags).not.toContain(`ContextMenu.${method}`)
  }

  const nonCallableTags = ContextMenuSurface.schemaDocs
    .filter((doc) => !doc.callable)
    .map((doc) => doc.tag)
    .toSorted()
  expect(nonCallableTags).toEqual(
    expectedContextMenuCapabilityFactMethods.map((method) => `ContextMenu.${method}`).toSorted()
  )
})

test("ContextMenu service delegates through a substitutable ContextMenuClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const commandLayer = yield* makeCommandBindingLayer(commandCalls)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const contextMenu = yield* ContextMenu
          yield* contextMenu.buildFromTemplate({ template: menuTemplate })
          yield* contextMenu.show({
            window: windowHandle,
            template: menuTemplate,
            position: { x: 12.5, y: 34.25 }
          })
          yield* contextMenu.bindCommand("file.open", "app.file.open")
          const activated = yield* contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect)

          return { activated }
        }),
        Layer.mergeAll(makeContextMenuServiceLayer(contextMenuClient(calls)), commandLayer)
      )
      yield* Effect.sleep("10 millis")

      expect(commandCalls).toEqual([{ itemId: "file.open", windowId: "window-1" }])
      expect(Array.from(result.activated)).toEqual([
        new ContextMenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      ])
      expect(calls).toEqual([
        "buildFromTemplate:3",
        "show:window-1:12.5:34.25:3",
        "bindCommand:file.open:app.file.open"
      ])
    })
  ))

test("ContextMenu bindCommand does not duplicate listeners for identical bindings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const commandLayer = yield* makeCommandBindingLayer(commandCalls)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const contextMenu = yield* ContextMenu
          const first = yield* contextMenu.bindCommand("file.open", "app.file.open")
          const second = yield* contextMenu.bindCommand("file.open", "app.file.open")
          return { first, second }
        }),
        Layer.mergeAll(makeContextMenuServiceLayer(contextMenuClient(calls)), commandLayer)
      )
      yield* Effect.sleep("10 millis")

      expect(result.second).toEqual({
        kind: result.first.kind,
        id: result.first.id,
        generation: result.first.generation,
        ownerScope: result.first.ownerScope,
        state: result.first.state
      })
      expect(commandCalls).toEqual([{ itemId: "file.open", windowId: "window-1" }])
      expect(calls).toEqual(["bindCommand:file.open:app.file.open"])
    })
  ))

test("ContextMenu bindCommand closes the command listener with its resource scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const commandCalls: unknown[] = []
      const activated = yield* Queue.unbounded<ContextMenuActivatedEvent>()
      const invoked = yield* Deferred.make<void>()
      const resources = yield* makeResourceRegistry()
      const permissions = yield* makePermissionRegistry()
      const commands = yield* makeCommandRegistry(resources, permissions)
      yield* permissions.declare(menuCommandCapability, { source: "test" })
      yield* registerTestCommand(commands, {
        id: "app.file.open",
        payload: Schema.Struct({
          itemId: Schema.String,
          windowId: Schema.String
        }),
        capability: menuCommandCapability,
        ownerScope: "app",
        handler: (input) =>
          Effect.sync(() => {
            commandCalls.push(input)
          }).pipe(Effect.tap(() => Deferred.succeed(invoked, undefined)))
      })

      yield* runScoped(
        Effect.gen(function* () {
          const contextMenu = yield* ContextMenu
          return yield* contextMenu.bindCommand("file.open", "app.file.open")
        }),
        Layer.mergeAll(
          makeContextMenuServiceLayer({
            ...contextMenuClient(calls),
            onActivated: () => Stream.fromQueue(activated)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )

      yield* Queue.offer(
        activated,
        new ContextMenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      )
      yield* Deferred.await(invoked)
      yield* resources.closeScope("app")
      yield* Queue.offer(
        activated,
        new ContextMenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      )
      yield* Effect.sleep("10 millis")

      expect(commandCalls).toEqual([{ itemId: "file.open", windowId: "window-1" }])
      expect(calls).toEqual(["bindCommand:file.open:app.file.open"])
    })
  ))

test("ContextMenu bridge client routes show and keeps local helpers off transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = contextMenuExchange(requests, () => ({
        kind: "success",
        payload: undefined
      }))
      const commandLayer = yield* makeCommandBindingLayer()

      const result = yield* runScoped(
        Effect.gen(function* () {
          const contextMenu = yield* ContextMenu
          yield* contextMenu.show({
            window: windowHandle,
            template: menuTemplate,
            position: { x: 12.5, y: 34.25 }
          })
          const buildExit = yield* Effect.exit(
            contextMenu.buildFromTemplate({ template: menuTemplate })
          )
          const bindExit = yield* Effect.exit(contextMenu.bindCommand("file.open", "app.file.open"))
          const activated = yield* contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect)

          return { activated, bindExit, buildExit }
        }),
        Layer.mergeAll(
          Layer.provide(
            ContextMenuLive,
            makeContextMenuBridgeClientLayer(exchange, {
              nextRequestId: nextId(["context-menu-show"]),
              nextTraceId: nextId(["trace-context-menu-show"]),
              now: nextNumber([1710000000000, 1710000000001])
            })
          ),
          commandLayer
        )
      )

      expect(Exit.isSuccess(result.buildExit)).toBe(true)
      expect(Exit.isSuccess(result.bindExit)).toBe(true)
      expect(Array.from(result.activated)).toEqual([
        new ContextMenuActivatedEvent({
          itemId: "file.open",
          commandId: "app.file.open",
          windowId: "window-1"
        })
      ])
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        kind: "request",
        id: "context-menu-show",
        timestamp: 1710000000000,
        method: "ContextMenu.show",
        payload: {
          window: windowHandle,
          template: { items: menuTemplate.items },
          position: { x: 12.5, y: 34.25 }
        }
      })
    })
  ))

test("ContextMenu bridge client rejects invalid popup positions before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly position: { readonly x: number; readonly y: number }
      }> = [
        { position: { x: Number.NaN, y: 10 } },
        { position: { x: Number.POSITIVE_INFINITY, y: 10 } },
        { position: { x: Number.NEGATIVE_INFINITY, y: 10 } },
        { position: { x: -1, y: 10 } },
        { position: { x: 10, y: -1 } }
      ]

      for (const { position } of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const exchange = contextMenuExchange(requests, () => ({
          kind: "success",
          payload: undefined
        }))
        const commandLayer = yield* makeCommandBindingLayer()

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const contextMenu = yield* ContextMenu
            return yield* Effect.exit(
              contextMenu.show({ window: windowHandle, template: menuTemplate, position })
            )
          }),
          Layer.mergeAll(
            Layer.provide(
              ContextMenuLive,
              makeContextMenuBridgeClientLayer(exchange, {
                nextRequestId: nextId(["unused"]),
                nextTraceId: nextId(["unused"]),
                now: nextNumber([1710000000000])
              })
            ),
            commandLayer
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(requests).toEqual([])
      }
    })
  ))

test("ContextMenu bridge client rejects empty activation event identifiers as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly payload: { itemId: string; commandId: string; windowId: string }
      }> = [
        { payload: { itemId: "", commandId: "app.file.open", windowId: "window-1" } },
        { payload: { itemId: "file.open", commandId: "", windowId: "window-1" } },
        { payload: { itemId: "file.open", commandId: "app.file.open", windowId: "" } }
      ]

      for (const { payload } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "ContextMenu.Activated"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000350,
                    traceId: "event-trace",
                    method,
                    payload
                  })
                )
              : Stream.empty
        }
        const commandLayer = yield* makeCommandBindingLayer()

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const contextMenu = yield* ContextMenu
            return yield* Effect.exit(
              contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect)
            )
          }),
          Layer.mergeAll(
            Layer.provide(
              ContextMenuLive,
              makeContextMenuBridgeClientLayer(exchange, {
                nextRequestId: nextId(["unused"]),
                nextTraceId: nextId(["unused"]),
                now: nextNumber([1710000000000])
              })
            ),
            commandLayer
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("TrayRpcs declares the Phase 8 Tray method and event surface", () => {
  expect([...TrayMethodNames]).toEqual(expectedTrayMethods)
  expect(rpcMethodNames("Tray", TrayRpcs)).toEqual(expectedTrayMethods)
  expect(Object.keys(TrayRpcEvents)).toEqual(["Activated"])
})

test("Tray lifecycle support metadata keeps Linux unavailable until tray dependencies ship", () => {
  for (const method of ["Tray.create", "Tray.destroy", "Tray.setIcon", "Tray.setMenu"] as const) {
    expect(TrayRpcs.requests.get(method)!.pipe(rpcSupport)).toEqual({
      status: "partial",
      reason: "linux-tray-unavailable",
      platforms: [
        { platform: "macos", status: "supported" },
        { platform: "windows", status: "supported" },
        { platform: "linux", status: "unsupported", reason: "host-tray-unavailable" }
      ]
    })
  }
})

test("Tray.setTitle support metadata keeps Windows and Linux unavailable", () => {
  expect(TrayRpcs.requests.get("Tray.setTitle")!.pipe(rpcSupport)).toEqual({
    status: "partial",
    reason: "windows-tray-title-unavailable",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "windows-tray-title-unavailable" },
      { platform: "linux", status: "unsupported", reason: "host-tray-unavailable" }
    ]
  })
})

test("Tray.setTooltip support metadata keeps Linux tooltip unavailable", () => {
  expect(TrayRpcs.requests.get("Tray.setTooltip")!.pipe(rpcSupport)).toEqual({
    status: "partial",
    reason: "linux-tray-tooltip-unavailable",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "unsupported", reason: "linux-tray-tooltip-unavailable" }
    ]
  })
})

test("Tray service delegates through a substitutable TrayClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          const created = yield* tray.create({
            icon: "solid:#3366ccff",
            tooltip: "ORIKA",
            title: "ED",
            menu: menuTemplate
          })
          yield* tray.setIcon(created, "solid:#22aa66ff")
          yield* tray.setTooltip(created, "Running")
          yield* tray.setTitle(created, "OK")
          yield* tray.setMenu(created, menuTemplate)
          const activated = yield* tray.onActivated().pipe(Stream.take(1), Stream.runCollect)
          yield* tray.destroy(created)

          return { activated, created }
        }),
        makeTrayServiceLayer(trayClient(calls))
      )

      expect(result.created).toEqual(trayHandle)
      expect(Array.from(result.activated)).toEqual([
        new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" })
      ])
      expect(calls).toEqual([
        "create:solid:#3366ccff:ORIKA:ED:3",
        "setIcon:tray-1:solid:#22aa66ff",
        "setTooltip:tray-1:Running",
        "setTitle:tray-1:OK",
        "setMenu:tray-1:3",
        "destroy:tray-1"
      ])
    })
  ))

test("Tray bridge client sends typed host envelopes and decodes activation events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = trayExchange(requests, (request) => ({
        kind: "success",
        payload: request.method === "Tray.create" ? trayHandle : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          const created = yield* tray.create({
            icon: "solid:#3366ccff",
            tooltip: "ORIKA",
            title: "ED",
            menu: menuTemplate
          })
          yield* tray.setIcon(created, "solid:#22aa66ff")
          yield* tray.setTooltip(created, "Running")
          yield* tray.setTitle(created, "OK")
          yield* tray.setMenu(created, menuTemplate)
          const activated = yield* tray.onActivated().pipe(Stream.take(1), Stream.runCollect)
          yield* tray.destroy(created)

          return { activated, created }
        }),
        Layer.provide(TrayLive, makeTrayBridgeClientLayer(exchange))
      )

      expect(result.created).toMatchObject(trayHandle)
      expect(Array.from(result.activated)).toEqual([
        new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" })
      ])
      const expectedMenu = { items: menuTemplate.items }
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [
          "Tray.create",
          { icon: "solid:#3366ccff", tooltip: "ORIKA", title: "ED", menu: expectedMenu }
        ],
        ["Tray.setIcon", { tray: trayHandle, icon: "solid:#22aa66ff" }],
        ["Tray.setTooltip", { tray: trayHandle, tooltip: "Running" }],
        ["Tray.setTitle", { tray: trayHandle, title: "OK" }],
        ["Tray.setMenu", { tray: trayHandle, menu: expectedMenu }],
        ["Tray.destroy", { tray: trayHandle }]
      ])
    })
  ))

test("Tray bridge client rejects empty activation event identifiers as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly payload: unknown }> = [
        { payload: { tray: { ...trayHandle, id: "" }, ownerWindowId: "window-1" } },
        { payload: { tray: { ...trayHandle, kind: "" }, ownerWindowId: "window-1" } },
        { payload: { tray: { ...trayHandle, ownerScope: "" }, ownerWindowId: "window-1" } },
        { payload: { tray: trayHandle, ownerWindowId: "" } }
      ]

      for (const { payload } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "Tray.Activated"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000360,
                    traceId: "event-trace",
                    method,
                    payload
                  })
                )
              : Stream.empty
        }

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const tray = yield* Tray
            return yield* Effect.exit(tray.onActivated().pipe(Stream.take(1), Stream.runCollect))
          }),
          Layer.provide(TrayLive, makeTrayBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("Tray bridge client decodes activation events with no ownerWindowId field", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
        subscribe: (method) =>
          method === "Tray.Activated"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000360,
                  traceId: "event-trace",
                  method,
                  payload: { tray: trayHandle }
                })
              )
            : Stream.empty
      }

      const events = yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          return yield* tray.onActivated().pipe(Stream.take(1), Stream.runCollect)
        }),
        Layer.provide(TrayLive, makeTrayBridgeClientLayer(exchange))
      )

      expect(Array.from(events)).toEqual([new TrayActivatedEvent({ tray: trayHandle })])
    })
  ))

test("Tray bridge client rejects invalid icon and tooltip metadata before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Tray.asEffect(),
        Layer.provide(
          TrayLive,
          makeTrayBridgeClientLayer(
            trayExchange(requests, () => ({ kind: "success", payload: trayHandle }))
          )
        )
      )

      const emptyIconExit = yield* Effect.exit(client.create({ icon: "" }))
      const fileIconExit = yield* Effect.exit(client.setIcon(trayHandle, "file:///etc/passwd"))
      const emptyTooltipExit = yield* Effect.exit(client.setTooltip(trayHandle, ""))
      const emptyTitleExit = yield* Effect.exit(client.setTitle(trayHandle, ""))
      const nulTooltipExit = yield* Effect.exit(
        client.create({ icon: "solid:#3366ccff", tooltip: "tip\u0000text" })
      )

      expectExitFailure(emptyIconExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(fileIconExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(emptyTooltipExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(emptyTitleExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(nulTooltipExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Tray bridge client rejects stale destroy handles before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Tray.asEffect(),
        Layer.provide(
          TrayLive,
          makeTrayBridgeClientLayer(
            trayExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      // @ts-expect-error intentionally stale handle state exercises runtime decoding.
      const exit = yield* Effect.exit(client.destroy({ ...trayHandle, state: "closed" }))

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Tray calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostTrayRpcRuntime(
        {
          "Tray.create": () =>
            Effect.sync(() => {
              calls.push("create")
              return trayHandle
            }),
          "Tray.setIcon": () => Effect.void,
          "Tray.setTooltip": () => Effect.void,
          "Tray.setTitle": () => Effect.void,
          "Tray.setMenu": () => Effect.void,
          "Tray.destroy": () => Effect.void,
          "Tray.isSupported": () => Effect.succeed(new TraySupportedResult({ supported: true }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "tray-denied",
            method: "Tray.create",
            payload: { icon: "solid:#3366ccff" },
            timestamp: 1710000000000,
            traceId: "trace-tray-denied"
          })
        ),
        Layer.mergeAll(
          Layer.effect(PermissionRegistry, makePermissionRegistry()),
          Layer.effect(ResourceRegistry, makeResourceRegistry())
        )
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Tray service cleans up scoped resources through ResourceRegistry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const resources = yield* makeResourceRegistry()

      yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          const created = yield* tray.create({ icon: "solid:#3366ccff" })
          yield* resources.closeScope(created.ownerScope)
        }),
        makeTrayServiceLayer(trayClient(calls), { resources })
      )

      const snapshot = yield* resources.list()
      expect(snapshot.entries).toHaveLength(0)
      expect(calls).toContain("destroy:tray-1")
    })
  ))

test("Tray service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-tray-unavailable",
        message: "unsupported Tray.create",
        operation: "Tray.create",
        recoverable: false
      })
      const resources = yield* makeResourceRegistry()
      const failClient: TrayClientApi = {
        ...trayClient([]),
        create: () => Effect.fail(unsupported)
      }
      const hostFailureClient: TrayClientApi = {
        ...trayClient([]),
        create: () => Effect.fail(makeHostProtocolHostUnavailableError("Tray.create"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          return yield* Effect.exit(tray.create({ icon: "solid:#3366ccff" }))
        }),
        makeTrayServiceLayer(failClient, { resources })
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const tray = yield* Tray
          return yield* Effect.exit(tray.create({ icon: "solid:#3366ccff" }))
        }),
        makeTrayServiceLayer(hostFailureClient, { resources })
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("DialogRpcs declares the Phase 7 Dialog method surface", () => {
  expect([...DialogMethodNames]).toEqual(expectedDialogMethods)
  expect(rpcMethodNames("Dialog", DialogRpcs)).toEqual(expectedDialogMethods)
  expect(Object.keys(DialogRpcEvents)).toEqual([])
  expect(DialogOpenFile.pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "linux-zenity-multi-selection-unavailable"
  })
  expect(DialogOpenDirectory.pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "linux-zenity-multi-selection-unavailable"
  })
})

test("Dialog service delegates through a substitutable DialogClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const dialog = yield* Dialog
          const files = yield* dialog.openFile({
            title: "Open",
            filters: [{ name: "Text", extensions: ["txt"] }],
            multiple: true
          })
          const directories = yield* dialog.openDirectory({ title: "Directory" })
          const savePath = yield* dialog.saveFile({ defaultPath: "/tmp/report.txt" })
          yield* dialog.message({ level: "info", message: "Done" })
          const confirmed = yield* dialog.confirm({ message: "Continue?" })

          return { confirmed, directories, files, savePath }
        }),
        makeDialogServiceLayer(dialogClient(calls))
      )

      expect(result.files).toEqual(["/canonical/file-a.txt", "/canonical/file-b.txt"])
      expect(result.directories).toEqual(["/canonical/project"])
      expect(result.savePath).toBe("/canonical/report.txt")
      expect(result.confirmed).toBe(true)
      expect(calls).toEqual([
        "openFile:Open:Text:true",
        "openDirectory:Directory",
        "saveFile:/tmp/report.txt",
        "message:info:Done",
        "confirm:Continue?"
      ])
    })
  ))

test("Dialog bridge client sends typed host envelopes and decodes outputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = dialogExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "Dialog.openFile"
            ? { paths: ["/canonical/file.txt"] }
            : request.method === "Dialog.openDirectory"
              ? { paths: ["/canonical/project"] }
              : request.method === "Dialog.saveFile"
                ? { path: "/canonical/report.txt" }
                : request.method === "Dialog.confirm"
                  ? { confirmed: false }
                  : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const dialog = yield* Dialog
          const files = yield* dialog.openFile({ defaultPath: "/tmp/input.txt" })
          const directories = yield* dialog.openDirectory()
          const savePath = yield* dialog.saveFile({
            filters: [{ name: "Markdown", extensions: ["md"] }]
          })
          yield* dialog.message({ level: "warning", message: "Check input", detail: "details" })
          const confirmed = yield* dialog.confirm({ message: "Proceed?", confirmLabel: "Yes" })

          return { confirmed, directories, files, savePath }
        }),
        Layer.provide(DialogLive, makeDialogBridgeClientLayer(exchange))
      )

      expect(result.files).toEqual(["/canonical/file.txt"])
      expect(result.directories).toEqual(["/canonical/project"])
      expect(result.savePath).toBe("/canonical/report.txt")
      expect(result.confirmed).toBe(false)
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Dialog.openFile", { defaultPath: "/tmp/input.txt" }],
        ["Dialog.openDirectory", {}],
        ["Dialog.saveFile", { filters: [{ name: "Markdown", extensions: ["md"] }] }],
        ["Dialog.message", { level: "warning", message: "Check input", detail: "details" }],
        ["Dialog.confirm", { message: "Proceed?", confirmLabel: "Yes" }]
      ])
    })
  ))

test("Dialog bridge client represents save cancellation as data", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = dialogExchange(requests, () => ({ kind: "success", payload: {} }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const dialog = yield* Dialog
          return yield* dialog.saveFile({ defaultPath: "/tmp/cancel.txt" })
        }),
        Layer.provide(DialogLive, makeDialogBridgeClientLayer(exchange))
      )

      expect(result).toBeUndefined()
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Dialog.saveFile", { defaultPath: "/tmp/cancel.txt" }]
      ])
    })
  ))

test("Dialog bridge client preserves host failure errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = dialogExchange(requests, () => ({
        kind: "failure",
        error: makeHostProtocolHostUnavailableError("Dialog.openFile")
      }))

      const exit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const dialog = yield* Dialog
            return yield* dialog.openFile({ defaultPath: "/tmp/input.txt" })
          }),
          Layer.provide(DialogLive, makeDialogBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "HostUnavailable"))
      expect(requests.map((request) => request.method)).toEqual(["Dialog.openFile"])
    })
  ))

test("Dialog bridge client returns invalid input as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Dialog.asEffect(),
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      // @ts-expect-error intentionally malformed dialog level exercises runtime decoding.
      const exit = yield* Effect.exit(client.message({ level: "fatal", message: "bad" }))

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Dialog calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostDialogRpcRuntime(
        {
          "Dialog.openFile": () =>
            Effect.sync(() => {
              calls.push("openFile")
              return new DialogOpenResult({ paths: ["/tmp/secret.txt"] })
            }),
          "Dialog.openDirectory": () => Effect.succeed(new DialogOpenResult({ paths: [] })),
          "Dialog.saveFile": () =>
            Effect.succeed(new DialogSaveResult({ path: "/tmp/report.txt" })),
          "Dialog.message": () => Effect.void,
          "Dialog.confirm": () => Effect.succeed(new DialogConfirmResult({ confirmed: true }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "dialog-denied",
            method: "Dialog.openFile",
            payload: {},
            timestamp: 1710000000000,
            traceId: "trace-dialog-denied"
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("ClipboardRpcs declares the Phase 7 Clipboard method surface", () => {
  expect([...ClipboardMethodNames]).toEqual(expectedClipboardMethods)
  expect(rpcMethodNames("Clipboard", ClipboardRpcs)).toEqual(expectedClipboardMethods)
  expect(Object.keys(ClipboardRpcEvents)).toEqual([])
})

test("Clipboard service delegates through a substitutable ClipboardClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          yield* clipboard.writeText("hello")
          const text = yield* clipboard.readText()
          yield* clipboard.writeHtml("<p>hello</p>")
          const html = yield* clipboard.readHtml()
          yield* clipboard.writeImage({ mime: "image/png", bytes: pngBytes })
          const image = yield* clipboard.readImage()
          yield* clipboard.clear()
          const supported = yield* clipboard.isSupported("selection")

          return { html, image, supported, text }
        }),
        makeClipboardServiceLayer(clipboardClient(calls))
      )

      expect(result.text).toBe("hello")
      expect(result.html).toBe("<p>hello</p>")
      expect(result.image).toEqual(new ClipboardImage({ mime: "image/png", bytes: pngBytes }))
      expect(result.supported).toEqual(new ClipboardSupportedResult({ supported: true }))
      expect(calls).toEqual([
        "writeText:hello",
        "readText",
        "writeHtml:<p>hello</p>",
        "readHtml",
        "writeImage:image/png:9",
        "readImage",
        "clear",
        "isSupported:selection"
      ])
    })
  ))

test("Clipboard bridge client sends typed host envelopes and decodes outputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = clipboardExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "Clipboard.readText"
            ? { text: "from host" }
            : request.method === "Clipboard.readHtml"
              ? { html: "<strong>from host</strong>" }
              : request.method === "Clipboard.readImage"
                ? { mime: "image/jpeg", bytes: jpegBytesJson }
                : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          yield* clipboard.writeText("to host")
          const text = yield* clipboard.readText()
          yield* clipboard.writeHtml("<strong>to host</strong>")
          const html = yield* clipboard.readHtml()
          yield* clipboard.writeImage({ mime: "image/jpeg", bytes: jpegBytes })
          const image = yield* clipboard.readImage()
          yield* clipboard.clear()

          return { html, image, text }
        }),
        Layer.provide(ClipboardLive, makeClipboardBridgeClientLayer(exchange))
      )

      expect(result.text).toBe("from host")
      expect(result.html).toBe("<strong>from host</strong>")
      expect(result.image).toEqual(new ClipboardImage({ mime: "image/jpeg", bytes: jpegBytes }))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Clipboard.writeText", { text: "to host" }],
        ["Clipboard.readText", null],
        ["Clipboard.writeHtml", { html: "<strong>to host</strong>" }],
        ["Clipboard.readHtml", null],
        ["Clipboard.writeImage", { mime: "image/jpeg", bytes: jpegBytesJson }],
        ["Clipboard.readImage", null],
        ["Clipboard.clear", null]
      ])
    })
  ))

test("Clipboard bridge client preserves unsupported support reasons from host", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ClipboardClient
          return yield* client.isSupported("selection")
        }),
        makeClipboardBridgeClientLayer(
          clipboardExchange(requests, () => ({
            kind: "success",
            payload: { supported: false, reason: "host-adapter-unimplemented" }
          }))
        )
      )

      expect(result).toEqual(
        new ClipboardSupportedResult({
          supported: false,
          reason: "host-adapter-unimplemented"
        })
      )
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Clipboard.isSupported", { capability: "selection" }]
      ])
    })
  ))

test("Clipboard handlers preserve unsupported support reasons from the service boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const supportReason = "host-clipboard-unavailable"
      const testLayer = Layer.provide(
        ClipboardSurface.testClientLayer,
        makeClipboardServiceLayer({
          ...clipboardClient(calls),
          isSupported: (capability) =>
            Effect.sync(() => {
              calls.push(`isSupported:${capability}`)
              return new ClipboardSupportedResult({ supported: false, reason: supportReason })
            })
        })
      )

      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ClipboardClient
          return yield* client.isSupported("selection")
        }),
        testLayer
      )

      expect(result).toEqual(
        new ClipboardSupportedResult({ supported: false, reason: supportReason })
      )
      expect(calls).toEqual(["isSupported:selection"])
    })
  ))

test("Clipboard support results reject inconsistent reasons", () => {
  for (const payload of [
    { supported: true, reason: "unexpected" },
    { supported: false }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ClipboardSupportedResult)(payload))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    { supported: true },
    { supported: false, reason: "host-adapter-unimplemented" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(ClipboardSupportedResult)(payload))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("Clipboard bridge client rejects inconsistent isSupported output as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const payload of [
        { supported: true, reason: "unexpected" },
        { supported: false }
      ] as const) {
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const client = yield* ClipboardClient
            return yield* Effect.exit(client.isSupported("selection"))
          }),
          makeClipboardBridgeClientLayer(
            clipboardExchange([], () => ({
              kind: "success",
              payload
            }))
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("Clipboard bridge client rejects mismatched image mime before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Clipboard.asEffect(),
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(
            clipboardExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exit = yield* Effect.exit(client.writeImage({ mime: "image/png", bytes: jpegBytes }))

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Clipboard bridge client rejects malformed image headers from host as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidOutputs: Array<{ readonly mime: string; readonly bytes: Uint8Array }> = [
        { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
        { mime: "image/jpeg", bytes: pngBytes }
      ]

      for (const payload of invalidOutputs) {
        const requests: HostProtocolRequestEnvelope[] = []
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const clipboard = yield* Clipboard
            return yield* Effect.exit(clipboard.readImage())
          }),
          Layer.provide(
            ClipboardLive,
            makeClipboardBridgeClientLayer(
              clipboardExchange(requests, (request) => ({
                kind: "success",
                payload: request.method === "Clipboard.readImage" ? payload : undefined
              }))
            )
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(requests).toEqual([expect.objectContaining({ method: "Clipboard.readImage" })])
      }
    })
  ))

test("Clipboard bridge client rejects NUL bytes in writeText as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          return yield* Effect.exit(clipboard.writeText("hello\u0000world"))
        }),
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(
            clipboardExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])

      yield* runScoped(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          yield* clipboard.writeText("valid text")
        }),
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(
            clipboardExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
      expect(requests.length).toBe(1)
    })
  ))

test("Clipboard bridge client runs generated methods inside the layer scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const text = yield* runScoped(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          return yield* clipboard.readText()
        }),
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(
            clipboardExchange(requests, (request) => ({
              kind: "success",
              payload: request.method === "Clipboard.readText" ? { text: "after scope" } : undefined
            }))
          )
        )
      )

      expect(text).toBe("after scope")
      expect(requests).toEqual([expect.objectContaining({ method: "Clipboard.readText" })])
    })
  ))

test("native host RPC runtime denies protected Clipboard calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostClipboardRpcRuntime(
        {
          "Clipboard.readText": () =>
            Effect.sync(() => {
              calls.push("readText")
              return new ClipboardText({ text: "secret" })
            }),
          "Clipboard.writeText": () =>
            Effect.sync(() => {
              calls.push("writeText")
            }),
          "Clipboard.readHtml": () => Effect.succeed(new ClipboardHtml({ html: "" })),
          "Clipboard.writeHtml": () => Effect.void,
          "Clipboard.readImage": () =>
            Effect.succeed(new ClipboardImage({ mime: "image/png", bytes: pngBytes })),
          "Clipboard.writeImage": () => Effect.void,
          "Clipboard.clear": () => Effect.void,
          "Clipboard.isSupported": () =>
            Effect.succeed(
              new ClipboardSupportedResult({
                supported: false,
                reason: "host-adapter-unimplemented"
              })
            )
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const responses = yield* runScoped(
        Effect.all([
          runtime.dispatch(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "clipboard-read-denied",
              method: "Clipboard.readText",
              timestamp: 1710000000000,
              traceId: "trace-clipboard-read-denied"
            })
          ),
          runtime.dispatch(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "clipboard-write-denied",
              method: "Clipboard.writeText",
              payload: { text: "secret" },
              timestamp: 1710000000001,
              traceId: "trace-clipboard-write-denied"
            })
          )
        ]),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      for (const response of responses) {
        expect(response.kind).toBe("failure")
        if (response.kind === "failure") {
          expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
        }
      }
      expect(calls).toEqual([])
    })
  ))

test("NotificationRpcs declares the Phase 7 Notification method and event surface", () => {
  expect([...NotificationMethodNames]).toEqual(expectedNotificationMethods)
  expect(rpcMethodNames("Notification", NotificationRpcs)).toEqual(expectedNotificationMethods)
  expect(Object.keys(NotificationRpcEvents)).toEqual(["Click", "Action"])
})

test("Notification service delegates through a substitutable NotificationClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const notification = yield* Notification
          const supported = yield* notification.isSupported()
          const permission = yield* notification.getPermissionStatus()
          const requested = yield* notification.requestPermission()
          const shown = yield* notification.show({
            title: "Build finished",
            body: "Open results",
            actions: [{ id: "open", label: "Open" }],
            ownerWindow: windowHandle
          })
          const clicks = yield* notification.onClick().pipe(Stream.take(1), Stream.runCollect)
          const actions = yield* notification.onAction().pipe(Stream.take(1), Stream.runCollect)
          yield* notification.close(shown)

          return { actions, clicks, permission, requested, shown, supported }
        }),
        makeNotificationServiceLayer(notificationClient(calls))
      )

      expect(result.supported).toBe(true)
      expect(result.permission).toBe("default")
      expect(result.requested).toBe("granted")
      expect(result.shown).toEqual(notificationHandle)
      expect(Array.from(result.clicks)).toEqual([
        new NotificationClickEvent({ notification: notificationHandle, ownerWindowId: "window-1" })
      ])
      expect(Array.from(result.actions)).toEqual([
        new NotificationActionEvent({
          notification: notificationHandle,
          actionId: "open",
          ownerWindowId: "window-1"
        })
      ])
      expect(calls).toEqual([
        "isSupported",
        "getPermissionStatus",
        "requestPermission",
        "show:Build finished:open:window-1",
        "close:notification-1"
      ])
    })
  ))

test("Notification bridge client sends typed host envelopes and decodes events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = notificationExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "Notification.show"
            ? notificationHandle
            : request.method === "Notification.isSupported"
              ? { supported: true }
              : request.method === "Notification.requestPermission"
                ? { state: "granted" }
                : request.method === "Notification.getPermissionStatus"
                  ? { state: "default" }
                  : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const notification = yield* Notification
          const supported = yield* notification.isSupported()
          const status = yield* notification.getPermissionStatus()
          const requested = yield* notification.requestPermission()
          const shown = yield* notification.show({
            title: "Build finished",
            body: "Open results",
            actions: [{ id: "open", label: "Open" }],
            ownerWindow: windowHandle
          })
          const action = yield* notification.onAction().pipe(Stream.take(1), Stream.runCollect)
          yield* notification.close(shown)

          return { action, requested, shown, status, supported }
        }),
        Layer.provide(NotificationLive, makeNotificationBridgeClientLayer(exchange))
      )

      expect(result.supported).toBe(true)
      expect(result.status).toBe("default")
      expect(result.requested).toBe("granted")
      expect(result.shown).toMatchObject(notificationHandle)
      expect(Array.from(result.action)).toEqual([
        new NotificationActionEvent({
          notification: notificationHandle,
          actionId: "open",
          ownerWindowId: "window-1"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Notification.isSupported", null],
        ["Notification.getPermissionStatus", null],
        ["Notification.requestPermission", null],
        [
          "Notification.show",
          {
            title: "Build finished",
            body: "Open results",
            actions: [{ id: "open", label: "Open" }],
            ownerWindow: windowHandle
          }
        ],
        ["Notification.close", { notification: notificationHandle }]
      ])
    })
  ))

test("Notification bridge client returns invalid input as typed Effect failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string
        readonly input: Record<string, string>
      }> = [
        { label: "empty title", input: { title: "", body: "Open results" } },
        { label: "empty body", input: { title: "Build finished", body: "" } },
        { label: "missing body", input: { title: "Missing body" } },
        {
          label: "control char in title",
          input: { title: "Build\nfinished", body: "Open results" }
        },
        {
          label: "control char in body",
          input: { title: "Build finished", body: "Open\nresults" }
        },
        { label: "DEL in title", input: { title: "Build finished\u007f", body: "Open results" } }
      ]

      for (const { label, input } of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const client = yield* runScoped(
          Notification.asEffect(),
          Layer.provide(
            NotificationLive,
            makeNotificationBridgeClientLayer(
              notificationExchange(requests, () => ({ kind: "success", payload: undefined }))
            )
          )
        )

        // @ts-expect-error intentionally malformed notification text exercises runtime decoding.
        const exit = yield* Effect.exit(client.show(input))

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(label).toBeDefined()
        expect(requests).toEqual([])
      }
    })
  ))

test("Notification bridge client rejects invalid action ids and labels before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string
        readonly action: { readonly id: string; readonly label: string }
      }> = [
        { label: "empty id", action: { id: "", label: "Open" } },
        { label: "empty label", action: { id: "open", label: "" } },
        { label: "control id", action: { id: "open\nx", label: "Open" } },
        { label: "control label", action: { id: "open", label: "Open" } }
      ]

      for (const { label, action } of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const client = yield* runScoped(
          Notification.asEffect(),
          Layer.provide(
            NotificationLive,
            makeNotificationBridgeClientLayer(
              notificationExchange(requests, () => ({ kind: "success", payload: undefined }))
            )
          )
        )

        const exit = yield* Effect.exit(
          client.show({ title: "Heads up", body: "Click", actions: [action] })
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(label).toBeDefined()
        expect(requests).toEqual([])
      }
    })
  ))

test("Notification action stream rejects malformed actionId payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly label: string; readonly actionId: unknown }> = [
        { label: "empty", actionId: "" },
        { label: "control", actionId: "open\nx" }
      ]

      for (const { label, actionId } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "Notification.Action"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000420,
                    traceId: "event-trace",
                    method,
                    payload: {
                      notification: notificationHandle,
                      actionId,
                      ownerWindowId: "window-1"
                    }
                  })
                )
              : Stream.empty
        }

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const notification = yield* Notification
            return yield* Effect.exit(
              notification.onAction().pipe(Stream.take(1), Stream.runCollect)
            )
          }),
          Layer.provide(NotificationLive, makeNotificationBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(label).toBeDefined()
      }
    })
  ))

test("native host RPC runtime denies protected Notification calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostNotificationRpcRuntime(
        {
          "Notification.show": () =>
            Effect.sync(() => {
              calls.push("show")
              return notificationHandle
            }),
          "Notification.close": () => Effect.void,
          "Notification.isSupported": () =>
            Effect.succeed(new NotificationSupportedResult({ supported: true })),
          "Notification.requestPermission": () =>
            Effect.succeed(new NotificationPermissionResult({ state: "granted" })),
          "Notification.getPermissionStatus": () =>
            Effect.succeed(new NotificationPermissionResult({ state: "default" }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "notification-denied",
            method: "Notification.show",
            payload: { title: "Build finished", body: "Open results" },
            timestamp: 1710000000000,
            traceId: "trace-notification-denied"
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Notification service cleans up scoped resources through ResourceRegistry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const resources = yield* makeResourceRegistry()

      yield* runScoped(
        Effect.gen(function* () {
          const notification = yield* Notification
          const shown = yield* notification.show({ title: "Build finished", body: "Open results" })
          yield* resources.closeScope(shown.ownerScope)
        }),
        makeNotificationServiceLayer(notificationClient(calls), { resources })
      )

      const snapshot = yield* resources.list()
      expect(snapshot.entries).toHaveLength(0)
      expect(calls).toContain("close:notification-1")
    })
  ))

test("Notification service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-notification-unavailable",
        message: "unsupported Notification.show",
        operation: "Notification.show",
        recoverable: false
      })
      const resources = yield* makeResourceRegistry()
      const unsupportedClient: NotificationClientApi = {
        ...notificationClient([]),
        show: () => Effect.fail(unsupported)
      }
      const hostFailureClient: NotificationClientApi = {
        ...notificationClient([]),
        show: () => Effect.fail(makeHostProtocolHostUnavailableError("Notification.show"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const notification = yield* Notification
          return yield* Effect.exit(
            notification.show({ title: "Build finished", body: "Open results" })
          )
        }),
        makeNotificationServiceLayer(unsupportedClient, { resources })
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const notification = yield* Notification
          return yield* Effect.exit(
            notification.show({ title: "Build finished", body: "Open results" })
          )
        }),
        makeNotificationServiceLayer(hostFailureClient, { resources })
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("PathRpcs declares the Phase 7 Path method surface", () => {
  expect([...PathMethodNames]).toEqual(expectedPathMethods)
  expect(Array.from(PathRpcs.requests.keys())).toEqual([
    "Path.appData",
    "Path.cache",
    "Path.logs",
    "Path.temp",
    "Path.home",
    "Path.downloads"
  ])
  expect(rpcMethodNames("Path", PathRpcs)).toEqual(expectedPathMethods)
})

test("Path service delegates through a substitutable PathClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const path = yield* Path
          return {
            appData: yield* path.appData(),
            cache: yield* path.cache(),
            logs: yield* path.logs(),
            temp: yield* path.temp(),
            home: yield* path.home(),
            downloads: yield* path.downloads()
          }
        }),
        makePathServiceLayer(pathClient(calls))
      )

      expect(result).toEqual({
        appData: "/tmp/effect-desktop/app-data",
        cache: "/tmp/effect-desktop/cache",
        logs: "/tmp/effect-desktop/logs",
        temp: "/tmp/effect-desktop/temp",
        home: "/Users/test",
        downloads: "/Users/test/Downloads"
      })
      expect(calls).toEqual(["appData", "cache", "logs", "temp", "home", "downloads"])
    })
  ))

test("Path bridge client sends typed host envelopes and decodes canonical paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = pathExchange(requests, (request) => ({
        kind: "success",
        payload: { path: `/host/${request.method.replace("Path.", "")}` }
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const path = yield* Path
          return {
            appData: yield* path.appData(),
            cache: yield* path.cache(),
            logs: yield* path.logs(),
            temp: yield* path.temp(),
            home: yield* path.home(),
            downloads: yield* path.downloads()
          }
        }),
        Layer.provide(PathLive, makePathBridgeClientLayer(exchange))
      )

      expect(result).toEqual({
        appData: "/host/appData",
        cache: "/host/cache",
        logs: "/host/logs",
        temp: "/host/temp",
        home: "/host/home",
        downloads: "/host/downloads"
      })
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Path.appData", null],
        ["Path.cache", null],
        ["Path.logs", null],
        ["Path.temp", null],
        ["Path.home", null],
        ["Path.downloads", null]
      ])
    })
  ))

test("native host RPC runtime denies protected Path calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostPathRpcRuntime(
        {
          "Path.appData": () =>
            Effect.sync(() => {
              calls.push("appData")
              return new CanonicalPath({ path: "/host/appData" })
            }),
          "Path.cache": () => Effect.succeed(new CanonicalPath({ path: "/host/cache" })),
          "Path.logs": () => Effect.succeed(new CanonicalPath({ path: "/host/logs" })),
          "Path.temp": () => Effect.succeed(new CanonicalPath({ path: "/host/temp" })),
          "Path.home": () => Effect.succeed(new CanonicalPath({ path: "/host/home" })),
          "Path.downloads": () => Effect.succeed(new CanonicalPath({ path: "/host/downloads" }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "path-denied",
            method: "Path.appData",
            timestamp: 1710000000000,
            traceId: "trace-path-denied"
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Path service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-path-unavailable",
        message: "unsupported Path.home",
        operation: "Path.home",
        recoverable: false
      })
      const unsupportedClient: PathClientApi = {
        ...pathClient([]),
        home: () => Effect.fail(unsupported)
      }
      const hostFailureClient: PathClientApi = {
        ...pathClient([]),
        home: () => Effect.fail(makeHostProtocolHostUnavailableError("Path.home"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const path = yield* Path
          return yield* Effect.exit(path.home())
        }),
        makePathServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const path = yield* Path
          return yield* Effect.exit(path.home())
        }),
        makePathServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("Path bridge client rejects NUL-bearing host output as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const NUL = String.fromCharCode(0)
      const methods: ReadonlyArray<{
        readonly name: keyof PathClientApi
        readonly operation: string
      }> = [
        { name: "appData", operation: "Path.appData" },
        { name: "cache", operation: "Path.cache" },
        { name: "logs", operation: "Path.logs" },
        { name: "temp", operation: "Path.temp" },
        { name: "home", operation: "Path.home" },
        { name: "downloads", operation: "Path.downloads" }
      ]

      for (const { name, operation } of methods) {
        const requests: HostProtocolRequestEnvelope[] = []
        const exchange = pathExchange(requests, () => ({
          kind: "success",
          payload: { path: `/tmp/a${NUL}b` }
        }))

        const exit = yield* runScoped(
          Effect.gen(function* () {
            const path = yield* Path
            return yield* Effect.exit(path[name]())
          }),
          Layer.provide(
            PathLive,
            makePathBridgeClientLayer(exchange, {
              nextRequestId: nextId([`${name}-request`]),
              nextTraceId: nextId([`${name}-trace`]),
              now: nextNumber([1710000000000])
            })
          )
        )

        expectExitFailure(
          exit,
          (error) =>
            hasErrorTag(error, "InvalidOutput") &&
            typeof error === "object" &&
            error !== null &&
            "operation" in error &&
            error.operation === operation
        )
      }
    })
  ))

test("Path bridge client rejects relative canonical paths from host as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const path = yield* Path
          return yield* Effect.exit(path.home())
        }),
        Layer.provide(
          PathLive,
          makePathBridgeClientLayer(
            pathExchange([], () => ({ kind: "success", payload: { path: "relative/path" } }))
          )
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("ProtocolRpcs declares the Phase 8 Protocol method surface", () => {
  expect([...ProtocolMethodNames]).toEqual(expectedProtocolMethods)
  expect(Array.from(ProtocolRpcs.requests.keys())).toEqual([
    "Protocol.registerAppProtocol",
    "Protocol.serveAsset",
    "Protocol.serveRoute",
    "Protocol.deny"
  ])
  expect(rpcMethodNames("Protocol", ProtocolRpcs)).toEqual(expectedProtocolMethods)
})

test("Protocol service delegates through a substitutable ProtocolClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      yield* runScoped(
        Effect.gen(function* () {
          const protocol = yield* Protocol
          yield* protocol.registerAppProtocol({ scheme: "myapp" })
          yield* protocol.serveAsset({ scheme: "assets", root: "/app/assets" })
          yield* protocol.serveRoute({ scheme: "myapp", route: "/settings" })
          yield* protocol.deny({ scheme: "assets", path: "/private" })
        }),
        makeProtocolServiceLayer(protocolClient(calls))
      )

      expect(calls).toEqual([
        "registerAppProtocol:myapp",
        "serveAsset:assets:/app/assets",
        "serveRoute:myapp:/settings",
        "deny:assets:/private"
      ])
    })
  ))

test("Protocol bridge client validates custom schemes and path boundaries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Protocol
          yield* client.registerAppProtocol({ scheme: "myapp" })
          yield* client.serveAsset({ scheme: "assets", root: "/app/assets" })
          yield* client.serveRoute({ scheme: "myapp", route: "/settings" })
          yield* client.deny({ scheme: "assets", path: "/private" })
          const reservedSchemeExit = yield* Effect.exit(
            client.registerAppProtocol({ scheme: "app" })
          )
          const dangerousSchemeExit = yield* Effect.exit(
            client.registerAppProtocol({ scheme: "vbscript" })
          )
          const uppercaseSchemeExit = yield* Effect.exit(
            client.registerAppProtocol({ scheme: "MyApp" })
          )
          const traversalExit = yield* Effect.exit(
            client.serveRoute({ scheme: "myapp", route: "/../secret" })
          )
          const encodedTraversalExit = yield* Effect.exit(
            client.serveRoute({ scheme: "myapp", route: "/%2e%2e/secret" })
          )
          const encodedBackslashTraversalExit = yield* Effect.exit(
            client.serveRoute({ scheme: "myapp", route: "/%5c..%5csecret" })
          )
          const broadRootExit = yield* Effect.exit(
            client.serveAsset({ scheme: "assets", root: "/" })
          )
          const relativeDenyExit = yield* Effect.exit(
            client.deny({ scheme: "assets", path: "private" })
          )
          return {
            broadRootExit,
            dangerousSchemeExit,
            encodedBackslashTraversalExit,
            encodedTraversalExit,
            relativeDenyExit,
            reservedSchemeExit,
            traversalExit,
            uppercaseSchemeExit
          }
        }),
        Layer.provide(
          ProtocolLive,
          makeProtocolBridgeClientLayer(
            protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      expectExitFailure(result.reservedSchemeExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(result.dangerousSchemeExit, (error) =>
        hasErrorTag(error, "InvalidArgument")
      )
      expectExitFailure(result.uppercaseSchemeExit, (error) =>
        hasErrorTag(error, "InvalidArgument")
      )
      expectExitFailure(result.traversalExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(result.encodedTraversalExit, (error) =>
        hasErrorTag(error, "InvalidArgument")
      )
      expectExitFailure(result.encodedBackslashTraversalExit, (error) =>
        hasErrorTag(error, "InvalidArgument")
      )
      expectExitFailure(result.broadRootExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(result.relativeDenyExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Protocol.registerAppProtocol", { scheme: "myapp" }],
        ["Protocol.serveAsset", { scheme: "assets", root: "/app/assets" }],
        ["Protocol.serveRoute", { scheme: "myapp", route: "/settings" }],
        ["Protocol.deny", { scheme: "assets", path: "/private" }]
      ])
    })
  ))

test("Protocol bridge client rejects control characters in paths as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Protocol.asEffect(),
        Layer.provide(
          ProtocolLive,
          makeProtocolBridgeClientLayer(
            protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const newlineExit = yield* Effect.exit(
        client.serveRoute({ scheme: "myapp", route: "/settings\nadmin" })
      )
      const denyExit = yield* Effect.exit(
        client.deny({ scheme: "assets", path: "/private\ntoken" })
      )

      expectExitFailure(newlineExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(denyExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Protocol calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostProtocolRpcRuntime(
        {
          "Protocol.registerAppProtocol": (input) =>
            Effect.sync(() => {
              calls.push(`register:${input.scheme}`)
            }),
          "Protocol.serveAsset": () => Effect.void,
          "Protocol.serveRoute": () => Effect.void,
          "Protocol.deny": () => Effect.void
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "protocol-denied",
            method: "Protocol.registerAppProtocol",
            timestamp: 1710000000000,
            traceId: "trace-protocol-denied",
            payload: { scheme: "myapp" }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Protocol service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-protocol-unavailable",
        message: "unsupported Protocol.registerAppProtocol",
        operation: "Protocol.registerAppProtocol",
        recoverable: false
      })
      const unsupportedClient: ProtocolClientApi = {
        ...protocolClient([]),
        registerAppProtocol: () => Effect.fail(unsupported)
      }
      const hostFailureClient: ProtocolClientApi = {
        ...protocolClient([]),
        registerAppProtocol: () =>
          Effect.fail(makeHostProtocolHostUnavailableError("Protocol.registerAppProtocol"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const protocol = yield* Protocol
          return yield* Effect.exit(protocol.registerAppProtocol({ scheme: "myapp" }))
        }),
        makeProtocolServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const protocol = yield* Protocol
          return yield* Effect.exit(protocol.registerAppProtocol({ scheme: "myapp" }))
        }),
        makeProtocolServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("AssociationRpcs declares the Phase 8 Association method and event surface", () => {
  expect([...AssociationMethodNames]).toEqual(expectedAssociationMethods)
  expect(Array.from(AssociationRpcs.requests.keys())).toEqual([
    "Association.isDefaultProtocolClient",
    "Association.setDefaultProtocolClient",
    "Association.getFileAssociations"
  ])
  expect(rpcMethodNames("Association", AssociationRpcs)).toEqual(expectedAssociationMethods)
  expect(Object.keys(AssociationRpcEvents)).toEqual(["Event"])
})

test("Association contracts reject inconsistent event phase payloads", () => {
  for (const payload of [
    { phase: "protocol-checked", reason: "host failed" },
    { phase: "protocol-updated", reason: "host failed" },
    { phase: "file-associations-checked", reason: "host failed" },
    { phase: "failed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(AssociationEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    { phase: "protocol-checked" },
    { phase: "protocol-updated" },
    { phase: "file-associations-checked" },
    { phase: "failed", reason: "host failed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(AssociationEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("Association service delegates through a substitutable AssociationClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const association = yield* Association
            const protocolStatus = yield* association.isDefaultProtocolClient({ scheme: "example" })
            yield* association.setDefaultProtocolClient({ scheme: "example" })
            const fileAssociations = yield* association.getFileAssociations({
              extensions: [".txt"]
            })
            const events = yield* association.events().pipe(Stream.take(1), Stream.runCollect)

            return { events, fileAssociations, protocolStatus }
          }),
          makeAssociationServiceLayer(associationClient(calls))
        )
      )

      expect(result.protocolStatus).toEqual(
        new AssociationProtocolStatus({ scheme: "example", isDefault: false })
      )
      expect(result.fileAssociations).toEqual(
        new AssociationFileAssociationsResult({
          associations: [new AssociationFileAssociation({ extension: ".txt", isDefault: false })]
        })
      )
      expect(Array.from(result.events)).toEqual([
        new AssociationEvent({ phase: "failed", reason: "host-adapter-unimplemented" })
      ])
      expect(calls).toEqual([
        "isDefaultProtocolClient:example",
        "setDefaultProtocolClient:example",
        "getFileAssociations:.txt",
        "events"
      ])
    })
  ))

test("Association bridge client sends typed host envelopes and decodes events and results", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = associationExchange(requests, (request) => {
        if (request.method === "Association.isDefaultProtocolClient") {
          return { kind: "success", payload: { scheme: "example", isDefault: false } }
        }
        if (request.method === "Association.getFileAssociations") {
          return {
            kind: "success",
            payload: { associations: [{ extension: ".txt", isDefault: false }] }
          }
        }
        return { kind: "success", payload: undefined }
      })

      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const association = yield* Association
            const protocolStatus = yield* association.isDefaultProtocolClient({ scheme: "example" })
            yield* association.setDefaultProtocolClient({ scheme: "example" })
            const fileAssociations = yield* association.getFileAssociations({
              extensions: [".txt"]
            })

            return { fileAssociations, protocolStatus }
          }),
          Layer.provide(AssociationLive, makeAssociationBridgeClientLayer(exchange))
        )
      )

      expect(result.protocolStatus).toEqual(
        new AssociationProtocolStatus({ scheme: "example", isDefault: false })
      )
      expect(result.fileAssociations).toEqual(
        new AssociationFileAssociationsResult({
          associations: [new AssociationFileAssociation({ extension: ".txt", isDefault: false })]
        })
      )
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Association.isDefaultProtocolClient", { scheme: "example" }],
        ["Association.setDefaultProtocolClient", { scheme: "example" }],
        ["Association.getFileAssociations", { extensions: [".txt"] }]
      ])
    })
  ))

test("Association bridge client subscribes to native association events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({ kind: "success", payload: undefined })
        },
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000100,
              traceId: "event-trace",
              method,
              payload: { phase: "protocol-updated" }
            })
          )
        }
      }
      const events = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const association = yield* Association
            return yield* association.events().pipe(Stream.take(1), Stream.runCollect)
          }),
          Layer.provide(AssociationLive, makeAssociationBridgeClientLayer(exchange))
        )
      )

      expect(Array.from(events)).toEqual([new AssociationEvent({ phase: "protocol-updated" })])
      expect(requests).toEqual([])
      expect(subscriptions).toEqual(["Association.Event"])
    })
  ))

test("Association bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: undefined }),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1_710_000_000_100,
              traceId: "association-event-trace",
              method,
              payload: { phase: "failed" }
            })
          )
      }
      const exit = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const association = yield* Association
            return yield* Effect.exit(association.events().pipe(Stream.take(1), Stream.runHead))
          }),
          Layer.provide(AssociationLive, makeAssociationBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("Association bridge client rejects invalid schemes and file extensions before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Association.asEffect(),
        Layer.provide(
          AssociationLive,
          makeAssociationBridgeClientLayer(
            associationExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exits = yield* Effect.all([
        Effect.exit(client.isDefaultProtocolClient({ scheme: "http" })),
        Effect.exit(client.isDefaultProtocolClient({ scheme: "vbscript" })),
        Effect.exit(client.setDefaultProtocolClient({ scheme: "bad scheme" })),
        Effect.exit(client.isDefaultProtocolClient({ scheme: "App" })),
        Effect.exit(client.getFileAssociations({ extensions: ["txt"] })),
        Effect.exit(client.getFileAssociations({ extensions: ["..txt"] })),
        Effect.exit(client.getFileAssociations({ extensions: [".bad/path"] }))
      ])

      for (const exit of exits) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Association calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostAssociationRpcRuntime(
        {
          "Association.isDefaultProtocolClient": (input) =>
            Effect.sync(() => {
              calls.push(`isDefaultProtocolClient:${input.scheme}`)
              return new AssociationProtocolStatus({ scheme: input.scheme, isDefault: false })
            }),
          "Association.setDefaultProtocolClient": () => Effect.void,
          "Association.getFileAssociations": () =>
            Effect.succeed(new AssociationFileAssociationsResult({ associations: [] }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "association-denied",
            method: "Association.setDefaultProtocolClient",
            timestamp: 1710000000000,
            traceId: "trace-association-denied",
            payload: { scheme: "example" }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Association service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported Association.isDefaultProtocolClient",
        operation: "Association.isDefaultProtocolClient",
        recoverable: false
      })
      const unsupportedClient: AssociationClientApi = {
        ...associationClient([]),
        isDefaultProtocolClient: () => Effect.fail(unsupported)
      }
      const hostFailureClient: AssociationClientApi = {
        ...associationClient([]),
        isDefaultProtocolClient: () =>
          Effect.fail(makeHostProtocolHostUnavailableError("Association.isDefaultProtocolClient"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const association = yield* Association
          return yield* Effect.exit(association.isDefaultProtocolClient({ scheme: "example" }))
        }),
        makeAssociationServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const association = yield* Association
          return yield* Effect.exit(association.isDefaultProtocolClient({ scheme: "example" }))
        }),
        makeAssociationServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("AutostartRpcs declares the Phase 8 Autostart method and event surface", () => {
  expect([...AutostartMethodNames]).toEqual(expectedAutostartMethods)
  expect(Array.from(AutostartRpcs.requests.keys())).toEqual([
    "Autostart.isEnabled",
    "Autostart.enable",
    "Autostart.disable"
  ])
  expect(rpcMethodNames("Autostart", AutostartRpcs)).toEqual(expectedAutostartMethods)
  expect(Object.keys(AutostartRpcEvents)).toEqual(["Event"])
})

test("Autostart service delegates through a substitutable AutostartClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const autostart = yield* Autostart
            const initial = yield* autostart.isEnabled()
            const enabled = yield* autostart.enable({ args: ["--hidden"] })
            const disabled = yield* autostart.disable()
            const events = yield* autostart.events().pipe(Stream.take(1), Stream.runCollect)

            return { disabled, enabled, events, initial }
          }),
          makeAutostartServiceLayer(autostartClient(calls))
        )
      )

      expect(result.initial).toEqual(
        new AutostartStatus({ enabled: false, mechanism: "linux-xdg-autostart" })
      )
      expect(result.enabled).toEqual(
        new AutostartStatus({ enabled: true, mechanism: "linux-xdg-autostart" })
      )
      expect(result.disabled).toEqual(
        new AutostartStatus({ enabled: false, mechanism: "linux-xdg-autostart" })
      )
      expect(Array.from(result.events)).toEqual([
        new AutostartEvent({ phase: "enabled", mechanism: "linux-xdg-autostart" })
      ])
      expect(calls).toEqual(["isEnabled", "enable:--hidden", "disable", "events"])
    })
  ))

test("Autostart bridge client sends typed host envelopes and decodes events and results", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = autostartExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "Autostart.isEnabled" || request.method === "Autostart.disable"
            ? { enabled: false, mechanism: "linux-xdg-autostart" }
            : { enabled: true, mechanism: "linux-xdg-autostart" }
      }))

      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const autostart = yield* Autostart
            const initial = yield* autostart.isEnabled()
            const enabled = yield* autostart.enable({ args: ["--hidden"] })
            const disabled = yield* autostart.disable()

            return { disabled, enabled, initial }
          }),
          Layer.provide(AutostartLive, makeAutostartBridgeClientLayer(exchange))
        )
      )

      expect(result.initial.enabled).toBe(false)
      expect(result.enabled.enabled).toBe(true)
      expect(result.disabled.enabled).toBe(false)
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Autostart.isEnabled", null],
        ["Autostart.enable", { args: ["--hidden"] }],
        ["Autostart.disable", null]
      ])
    })
  ))

test("Autostart bridge client subscribes to native autostart events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed({
            kind: "success",
            payload: { enabled: false, mechanism: "unsupported" }
          })
        },
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000100,
              traceId: "event-trace",
              method,
              payload: { phase: "enabled", mechanism: "linux-xdg-autostart" }
            })
          )
        }
      }
      const events = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const autostart = yield* Autostart
            return yield* autostart.events().pipe(Stream.take(1), Stream.runCollect)
          }),
          Layer.provide(AutostartLive, makeAutostartBridgeClientLayer(exchange))
        )
      )

      expect(Array.from(events)).toEqual([
        new AutostartEvent({ phase: "enabled", mechanism: "linux-xdg-autostart" })
      ])
      expect(requests).toEqual([])
      expect(subscriptions).toEqual(["Autostart.Event"])
    })
  ))

test("Autostart bridge client rejects invalid launch args before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Autostart.asEffect(),
        Layer.provide(
          AutostartLive,
          makeAutostartBridgeClientLayer(
            autostartExchange(requests, () => ({
              kind: "success",
              payload: { enabled: true, mechanism: "linux-xdg-autostart" }
            }))
          )
        )
      )

      const exits = yield* Effect.all([
        Effect.exit(client.enable({ args: [""] })),
        Effect.exit(client.enable({ args: ["bad\u0000arg"] })),
        Effect.exit(client.enable({ args: ["bad\narg"] })),
        Effect.exit(client.enable({ args: ["bad\u0085arg"] }))
      ])

      for (const exit of exits) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Autostart calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostAutostartRpcRuntime(
        {
          "Autostart.isEnabled": () =>
            Effect.succeed(
              new AutostartStatus({ enabled: false, mechanism: "linux-xdg-autostart" })
            ),
          "Autostart.enable": (input) =>
            Effect.sync(() => {
              calls.push(`enable:${input.args?.join(" ") ?? ""}`)
              return new AutostartStatus({ enabled: true, mechanism: "linux-xdg-autostart" })
            }),
          "Autostart.disable": () =>
            Effect.succeed(
              new AutostartStatus({ enabled: false, mechanism: "linux-xdg-autostart" })
            )
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "autostart-denied",
            method: "Autostart.enable",
            timestamp: 1710000000000,
            traceId: "trace-autostart-denied",
            payload: { args: ["--hidden"] }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Autostart service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported Autostart.enable",
        operation: "Autostart.enable",
        recoverable: false
      })
      const unsupportedClient: AutostartClientApi = {
        ...autostartClient([]),
        enable: () => Effect.fail(unsupported)
      }
      const hostFailureClient: AutostartClientApi = {
        ...autostartClient([]),
        enable: () => Effect.fail(makeHostProtocolHostUnavailableError("Autostart.enable"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const autostart = yield* Autostart
          return yield* Effect.exit(autostart.enable({ args: ["--hidden"] }))
        }),
        makeAutostartServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const autostart = yield* Autostart
          return yield* Effect.exit(autostart.enable({ args: ["--hidden"] }))
        }),
        makeAutostartServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("RecentDocumentsRpcs declares the Phase 8 RecentDocuments method and event surface", () => {
  expect([...RecentDocumentsMethodNames]).toEqual(expectedRecentDocumentsMethods)
  expect(Array.from(RecentDocumentsRpcs.requests.keys())).toEqual([
    "RecentDocuments.add",
    "RecentDocuments.clear",
    "RecentDocuments.list"
  ])
  expect(rpcMethodNames("RecentDocuments", RecentDocumentsRpcs)).toEqual(
    expectedRecentDocumentsMethods
  )
  expect(Object.keys(RecentDocumentsRpcEvents)).toEqual(["Event"])
})

test("RecentDocuments service delegates through a substitutable RecentDocumentsClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const recentDocuments = yield* RecentDocuments
            yield* recentDocuments.add({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })
            yield* recentDocuments.clear()
            const documents = yield* recentDocuments.list()
            const events = yield* recentDocuments.events().pipe(Stream.take(1), Stream.runCollect)

            return { documents, events }
          }),
          makeRecentDocumentsServiceLayer(recentDocumentsClient(calls))
        )
      )

      expect(result.documents).toEqual(
        new RecentDocumentsListResult({
          documents: [new RecentDocument({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })]
        })
      )
      expect(Array.from(result.events)).toEqual([
        new RecentDocumentsEvent({
          phase: "document-added",
          path: new CanonicalPath({ path: "/tmp/report.txt" })
        })
      ])
      expect(calls).toEqual(["add:/tmp/report.txt", "clear", "list", "events"])
    })
  ))

test("RecentDocuments bridge client sends typed host envelopes and decodes events and results", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = recentDocumentsExchange(requests, (request) =>
        request.method === "RecentDocuments.list"
          ? {
              kind: "success",
              payload: { documents: [{ path: { path: "/tmp/report.txt" } }] }
            }
          : { kind: "success", payload: undefined }
      )

      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const recentDocuments = yield* RecentDocuments
            yield* recentDocuments.add({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })
            yield* recentDocuments.clear()
            const documents = yield* recentDocuments.list()
            const events = yield* recentDocuments.events().pipe(Stream.take(1), Stream.runCollect)

            return { documents, events }
          }),
          Layer.provide(RecentDocumentsLive, makeRecentDocumentsBridgeClientLayer(exchange))
        )
      )

      expect(result.documents).toEqual(
        new RecentDocumentsListResult({
          documents: [new RecentDocument({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })]
        })
      )
      expect(Array.from(result.events)).toEqual([
        new RecentDocumentsEvent({
          phase: "document-added",
          path: new CanonicalPath({ path: "/tmp/report.txt" })
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["RecentDocuments.add", { path: { path: "/tmp/report.txt" } }],
        ["RecentDocuments.clear", null],
        ["RecentDocuments.list", null]
      ])
    })
  ))

test("RecentDocuments bridge client accepts safe absolute document paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [
        "/tmp/report.txt",
        "/tmp/a\\..\\b.txt",
        "C:\\tmp\\report.txt",
        "\\\\server\\share\\report.txt",
        "\\\\server/share/report.txt"
      ] as const

      for (const path of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const result = yield* Effect.scoped(
          runScoped(
            Effect.gen(function* () {
              const recentDocuments = yield* RecentDocuments
              yield* recentDocuments.add({ path: { path } })
              const documents = yield* recentDocuments.list()
              const events = yield* recentDocuments.events().pipe(Stream.take(1), Stream.runCollect)
              return { documents, events }
            }),
            Layer.provide(
              RecentDocumentsLive,
              makeRecentDocumentsBridgeClientLayer(
                recentDocumentsExchange(
                  requests,
                  (request) =>
                    request.method === "RecentDocuments.list"
                      ? { kind: "success", payload: { documents: [{ path: { path } }] } }
                      : { kind: "success", payload: undefined },
                  path
                )
              )
            )
          )
        )

        expect(result.documents).toEqual(
          new RecentDocumentsListResult({
            documents: [new RecentDocument({ path: new CanonicalPath({ path }) })]
          })
        )
        expect(Array.from(result.events)).toEqual([
          new RecentDocumentsEvent({ phase: "document-added", path: new CanonicalPath({ path }) })
        ])
        expect(requests.map((request) => [request.method, request.payload])).toEqual([
          ["RecentDocuments.add", { path: { path } }],
          ["RecentDocuments.list", null]
        ])
      }
    })
  ))

test("RecentDocuments bridge client rejects invalid paths before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        RecentDocuments.asEffect(),
        Layer.provide(
          RecentDocumentsLive,
          makeRecentDocumentsBridgeClientLayer(
            recentDocumentsExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exits = yield* Effect.all([
        Effect.exit(client.add({ path: { path: "" } })),
        Effect.exit(client.add({ path: { path: "relative.txt" } })),
        Effect.exit(client.add({ path: { path: "/tmp/bad\u0000path" } })),
        Effect.exit(client.add({ path: { path: "/tmp/bad\npath" } })),
        Effect.exit(client.add({ path: { path: "/tmp/bad\u0085path" } })),
        Effect.exit(client.add({ path: { path: "/tmp/../secret.txt" } })),
        Effect.exit(client.add({ path: { path: "C:relative.txt" } })),
        Effect.exit(client.add({ path: { path: "C:\\tmp\\..\\secret.txt" } })),
        Effect.exit(client.add({ path: { path: "\\\\" } })),
        Effect.exit(client.add({ path: { path: "\\\\server" } })),
        Effect.exit(client.add({ path: { path: "\\\\/server/share" } }))
      ])

      for (const exit of exits) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("RecentDocuments bridge client rejects unsafe list and event paths as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidListExchange = recentDocumentsExchange([], (request) =>
        request.method === "RecentDocuments.list"
          ? { kind: "success", payload: { documents: [{ path: { path: "/tmp/../secret.txt" } }] } }
          : { kind: "success", payload: undefined }
      )
      const invalidEventExchange = recentDocumentsExchange(
        [],
        () => ({ kind: "success", payload: undefined }),
        "/tmp/bad\u0085path"
      )

      const listExit = yield* runScoped(
        Effect.gen(function* () {
          const recentDocuments = yield* RecentDocuments
          return yield* Effect.exit(recentDocuments.list())
        }),
        Layer.provide(
          RecentDocumentsLive,
          makeRecentDocumentsBridgeClientLayer(invalidListExchange)
        )
      )
      const eventExit = yield* runScoped(
        Effect.gen(function* () {
          const recentDocuments = yield* RecentDocuments
          return yield* Effect.exit(
            recentDocuments.events().pipe(Stream.take(1), Stream.runCollect)
          )
        }),
        Layer.provide(
          RecentDocumentsLive,
          makeRecentDocumentsBridgeClientLayer(invalidEventExchange)
        )
      )

      expectExitFailure(listExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(eventExit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("RecentDocuments rejects inconsistent event phase payloads before exposing native events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidPayloads = [
        { phase: "document-added" },
        { phase: "document-added", reason: "host failed" },
        { phase: "cleared", path: { path: "/tmp/report.txt" } },
        { phase: "cleared", reason: "host failed" },
        { phase: "failed" },
        { phase: "failed", path: { path: "/tmp/report.txt" }, reason: "host failed" }
      ] as const

      for (const payload of invalidPayloads) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(RecentDocumentsEvent)(payload))
        expect(Exit.isFailure(exit)).toBe(true)
      }

      for (const payload of [
        { phase: "document-added", path: { path: "/tmp/report.txt" } },
        { phase: "cleared" },
        { phase: "failed", reason: "host failed" }
      ] as const) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(RecentDocumentsEvent)(payload))
        expect(exit._tag).toBe("Success")
      }

      const exchange: BridgeClientExchange = {
        request: () => Effect.die("RecentDocuments event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1_710_000_000_000,
              traceId: "recent-documents-event-trace",
              method,
              payload: invalidPayloads[0]
            })
          )
      }
      const bridgeExit = yield* runScoped(
        Effect.gen(function* () {
          const recentDocuments = yield* RecentDocuments
          return yield* Effect.exit(
            recentDocuments.events().pipe(Stream.take(1), Stream.runCollect)
          )
        }),
        Layer.provide(RecentDocumentsLive, makeRecentDocumentsBridgeClientLayer(exchange))
      )

      expectExitFailure(bridgeExit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("native host RPC runtime denies protected RecentDocuments calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostRecentDocumentsRpcRuntime(
        {
          "RecentDocuments.add": (input) =>
            Effect.sync(() => {
              calls.push(`add:${input.path.path}`)
            }),
          "RecentDocuments.clear": () => Effect.void,
          "RecentDocuments.list": () =>
            Effect.succeed(new RecentDocumentsListResult({ documents: [] }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "recent-documents-denied",
            method: "RecentDocuments.add",
            timestamp: 1710000000000,
            traceId: "trace-recent-documents-denied",
            payload: { path: { path: "/tmp/report.txt" } }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("RecentDocuments service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported RecentDocuments.add",
        operation: "RecentDocuments.add",
        recoverable: false
      })
      const unsupportedClient: RecentDocumentsClientApi = {
        ...recentDocumentsClient([]),
        add: () => Effect.fail(unsupported)
      }
      const hostFailureClient: RecentDocumentsClientApi = {
        ...recentDocumentsClient([]),
        add: () => Effect.fail(makeHostProtocolHostUnavailableError("RecentDocuments.add"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const recentDocuments = yield* RecentDocuments
          return yield* Effect.exit(
            recentDocuments.add({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })
          )
        }),
        makeRecentDocumentsServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const recentDocuments = yield* RecentDocuments
          return yield* Effect.exit(
            recentDocuments.add({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })
          )
        }),
        makeRecentDocumentsServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("NativeFileSystemRpcs declares the native filesystem method and event surface", () => {
  expect([...NativeFileSystemMethodNames]).toEqual(expectedNativeFileSystemMethods)
  expect(Array.from(NativeFileSystemRpcs.requests.keys())).toEqual([
    "NativeFileSystem.open",
    "NativeFileSystem.stat",
    "NativeFileSystem.watch",
    "NativeFileSystem.stopWatching",
    "NativeFileSystem.isSupported"
  ])
  expect(rpcMethodNames("NativeFileSystem", NativeFileSystemRpcs)).toEqual(
    expectedNativeFileSystemMethods
  )
  expect(Object.keys(NativeFileSystemRpcEvents)).toEqual(["Event"])
})

test("NativeFileSystem service delegates through a substitutable NativeFileSystemClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const filesystem = yield* NativeFileSystem
            const opened = yield* filesystem.open({
              path: new CanonicalPath({ path: "/tmp/report.txt" }),
              mode: "read"
            })
            const metadata = yield* filesystem.stat({
              path: new CanonicalPath({ path: "/tmp/report.txt" })
            })
            const watch = yield* filesystem.watch({
              path: new CanonicalPath({ path: "/tmp" }),
              recursive: true,
              watchId: "watch-1",
              ownerScope: "workspace:workspace-1"
            })
            const stopped = yield* filesystem.stopWatching({ watchId: "watch-1" })
            const support = yield* filesystem.isSupported()
            const events = yield* filesystem.events().pipe(Stream.take(1), Stream.runCollect)

            return { events, metadata, opened, stopped, support, watch }
          }),
          makeNativeFileSystemServiceLayer(nativeFileSystemClient(calls))
        )
      )

      expect(result.opened).toEqual(nativeFileSystemOpenResult("handle-1"))
      expect(result.metadata).toEqual(nativeFileSystemMetadata("/tmp/report.txt"))
      expect(result.watch).toEqual(nativeFileSystemWatchResult("watch-1"))
      expect(result.stopped).toEqual(
        new NativeFileSystemStopWatchingResult({ watchId: "watch-1", stopped: true })
      )
      expect(result.support).toEqual(
        new NativeFileSystemSupportedResult({
          supported: false,
          reason: "host-adapter-unimplemented"
        })
      )
      expect(Array.from(result.events)).toEqual([
        new NativeFileSystemEvent({
          type: "native-file-system-event",
          timestamp: 1710000000100,
          watchId: "watch-1",
          path: new CanonicalPath({ path: "/tmp/report.txt" }),
          phase: "changed"
        })
      ])
      expect(calls).toEqual([
        "open:/tmp/report.txt:read",
        "stat:/tmp/report.txt",
        "watch:/tmp:true",
        "stopWatching:watch-1",
        "isSupported",
        "events"
      ])
    })
  ))

test("NativeFileSystem bridge client sends typed host envelopes and decodes events and results", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = nativeFileSystemExchange(requests, (request) => {
        if (request.method === "NativeFileSystem.open") {
          return {
            kind: "success",
            payload: {
              handle: nativeFileSystemHandlePayload("handle-1"),
              metadata: { path: { path: "/tmp/report.txt" }, kind: "file" }
            }
          }
        }
        if (request.method === "NativeFileSystem.stat") {
          return { kind: "success", payload: { path: { path: "/tmp/report.txt" }, kind: "file" } }
        }
        if (request.method === "NativeFileSystem.watch") {
          return {
            kind: "success",
            payload: {
              watch: nativeFileSystemWatchPayload("watch-1"),
              path: { path: "/tmp" },
              recursive: true
            }
          }
        }
        if (request.method === "NativeFileSystem.stopWatching") {
          return { kind: "success", payload: { watchId: "watch-1", stopped: true } }
        }
        return {
          kind: "success",
          payload: { supported: false, reason: "host-adapter-unimplemented" }
        }
      })

      const result = yield* Effect.scoped(
        runScoped(
          Effect.gen(function* () {
            const filesystem = yield* NativeFileSystem
            const opened = yield* filesystem.open({
              path: new CanonicalPath({ path: "/tmp/report.txt" }),
              mode: "read"
            })
            const metadata = yield* filesystem.stat({
              path: new CanonicalPath({ path: "/tmp/report.txt" })
            })
            const watch = yield* filesystem.watch({
              path: new CanonicalPath({ path: "/tmp" }),
              recursive: true,
              watchId: "watch-1"
            })
            const stopped = yield* filesystem.stopWatching({ watchId: "watch-1" })
            const support = yield* filesystem.isSupported()
            const events = yield* filesystem.events().pipe(Stream.take(1), Stream.runCollect)

            return { events, metadata, opened, stopped, support, watch }
          }),
          Layer.provide(NativeFileSystemLive, makeNativeFileSystemBridgeClientLayer(exchange))
        )
      )

      expect(result.opened).toEqual(nativeFileSystemOpenResult("handle-1"))
      expect(result.metadata).toEqual(nativeFileSystemMetadata("/tmp/report.txt"))
      expect(result.watch).toEqual(nativeFileSystemWatchResult("watch-1"))
      expect(result.stopped).toEqual(
        new NativeFileSystemStopWatchingResult({ watchId: "watch-1", stopped: true })
      )
      expect(result.support).toEqual(
        new NativeFileSystemSupportedResult({
          supported: false,
          reason: "host-adapter-unimplemented"
        })
      )
      expect(Array.from(result.events)).toEqual([
        new NativeFileSystemEvent({
          type: "native-file-system-event",
          timestamp: 1710000000100,
          watchId: "watch-1",
          path: new CanonicalPath({ path: "/tmp/report.txt" }),
          phase: "changed"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["NativeFileSystem.open", { path: { path: "/tmp/report.txt" }, mode: "read" }],
        ["NativeFileSystem.stat", { path: { path: "/tmp/report.txt" } }],
        ["NativeFileSystem.watch", { path: { path: "/tmp" }, recursive: true, watchId: "watch-1" }],
        ["NativeFileSystem.stopWatching", { watchId: "watch-1" }],
        ["NativeFileSystem.isSupported", null]
      ])
    })
  ))

test("NativeFileSystem contracts reject inconsistent event phase payloads", () => {
  const invalidPayloads = [
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "watch-started",
      watchId: "watch-1"
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "changed"
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "removed",
      watchId: "watch-1",
      path: { path: "/tmp/report.txt" },
      reason: "not a failure"
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "failed",
      watchId: "watch-1"
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "watch-stopped",
      watchId: "watch-1",
      path: { path: "/tmp/report.txt" },
      reason: "not a failure"
    }
  ] as const

  for (const payload of invalidPayloads) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(NativeFileSystemEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "watch-started",
      watchId: "watch-1",
      path: { path: "/tmp" }
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "changed",
      watchId: "watch-1",
      path: { path: "/tmp/report.txt" }
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "removed",
      watchId: "watch-1",
      path: { path: "/tmp/report.txt" }
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "failed",
      watchId: "watch-1",
      reason: "filesystem watcher failed"
    },
    {
      type: "native-file-system-event",
      timestamp: 1_710_000_000_100,
      phase: "watch-stopped",
      watchId: "watch-1"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(NativeFileSystemEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("NativeFileSystem bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("NativeFileSystem event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1_710_000_000_100,
              traceId: "native-file-system-event-trace",
              method,
              payload: {
                type: "native-file-system-event",
                timestamp: 1_710_000_000_100,
                phase: "changed"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const filesystem = yield* NativeFileSystem
          return yield* Effect.exit(
            filesystem.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        Layer.provide(NativeFileSystemLive, makeNativeFileSystemBridgeClientLayer(exchange))
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("NativeFileSystem bridge client rejects invalid inputs before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        NativeFileSystem.asEffect(),
        Layer.provide(
          NativeFileSystemLive,
          makeNativeFileSystemBridgeClientLayer(
            nativeFileSystemExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const exits = yield* Effect.all([
        Effect.exit(client.open({ path: { path: "" } })),
        Effect.exit(client.stat({ path: { path: "relative.txt" } })),
        Effect.exit(client.watch({ path: { path: "/tmp/bad\u0000path" } })),
        Effect.exit(client.watch({ path: { path: "/tmp/../secret" } })),
        Effect.exit(client.stopWatching({ watchId: "" }))
      ])

      for (const exit of exits) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected NativeFileSystem calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostNativeFileSystemRpcRuntime(
        {
          "NativeFileSystem.open": (input) =>
            Effect.sync(() => {
              calls.push(`open:${input.path.path}`)
              return nativeFileSystemOpenResult("handle-1")
            }),
          "NativeFileSystem.stat": () =>
            Effect.succeed(nativeFileSystemMetadata("/tmp/report.txt")),
          "NativeFileSystem.watch": () => Effect.succeed(nativeFileSystemWatchResult("watch-1")),
          "NativeFileSystem.stopWatching": () =>
            Effect.succeed(
              new NativeFileSystemStopWatchingResult({ watchId: "watch-1", stopped: true })
            ),
          "NativeFileSystem.isSupported": () =>
            Effect.succeed(
              new NativeFileSystemSupportedResult({
                supported: false,
                reason: "host-adapter-unimplemented"
              })
            )
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "native-file-system-denied",
            method: "NativeFileSystem.open",
            timestamp: 1710000000000,
            traceId: "trace-native-file-system-denied",
            payload: { path: { path: "/tmp/report.txt" }, mode: "read" }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("native host RPC runtime lets permission-free NativeFileSystem support calls pass through", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = makeHostNativeFileSystemRpcRuntime(
        {
          "NativeFileSystem.open": () => Effect.succeed(nativeFileSystemOpenResult("handle-1")),
          "NativeFileSystem.stat": () =>
            Effect.succeed(nativeFileSystemMetadata("/tmp/report.txt")),
          "NativeFileSystem.watch": () => Effect.succeed(nativeFileSystemWatchResult("watch-1")),
          "NativeFileSystem.stopWatching": () =>
            Effect.succeed(
              new NativeFileSystemStopWatchingResult({ watchId: "watch-1", stopped: true })
            ),
          "NativeFileSystem.isSupported": () =>
            Effect.succeed(
              new NativeFileSystemSupportedResult({
                supported: false,
                reason: "host-adapter-unimplemented"
              })
            )
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "native-file-system-supported",
            method: "NativeFileSystem.isSupported",
            timestamp: 1710000000000,
            traceId: "trace-native-file-system-supported",
            payload: null
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("success")
      if (response.kind === "success") {
        expect(response.payload).toEqual({
          supported: false,
          reason: "host-adapter-unimplemented"
        })
      }
    })
  ))

test("NativeFileSystem service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported NativeFileSystem.open",
        operation: "NativeFileSystem.open",
        recoverable: false
      })
      const unsupportedClient: NativeFileSystemClientApi = {
        ...nativeFileSystemClient([]),
        open: () => Effect.fail(unsupported)
      }
      const hostFailureClient: NativeFileSystemClientApi = {
        ...nativeFileSystemClient([]),
        open: () => Effect.fail(makeHostProtocolHostUnavailableError("NativeFileSystem.open"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const filesystem = yield* NativeFileSystem
          return yield* Effect.exit(
            filesystem.open({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })
          )
        }),
        makeNativeFileSystemServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const filesystem = yield* NativeFileSystem
          return yield* Effect.exit(
            filesystem.open({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })
          )
        }),
        makeNativeFileSystemServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("SafeStorageRpcs declares the Phase 8 SafeStorage method surface", () => {
  expect([...SafeStorageMethodNames]).toEqual(expectedSafeStorageMethods)
  expect(rpcMethodNames("SafeStorage", SafeStorageRpcs)).toEqual(expectedSafeStorageMethods)
  expect(Object.keys(SafeStorageRpcEvents)).toEqual([])
})

test("SecretBytes redacts JSON formatting while exposing explicit byte copies", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secret = makeSafeStorageTestSecret()
      const bytes = unsafeSecretBytes(secret)
      bytes.fill(0)

      expect(encodeUnknownJson({ token: secret })).toBe('{"token":"<redacted:SecretBytes>"}')
      expect(Array.from(unsafeSecretBytes(secret))).toEqual([...SafeStorageTestSecretBytes])
      yield* wipeSecretBytes(secret)
      expect(() => unsafeSecretBytes(secret)).toThrow("Unable to get redacted value")
    })
  ))

test("SafeStorage service delegates through a substitutable SafeStorageClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const storage = yield* SafeStorage
          yield* storage.set("token", makeSafeStorageTestSecret())
          const secret = yield* storage.get("token")
          const keys = yield* storage.list()
          const available = yield* storage.isAvailable()
          yield* storage.delete("token")
          return { available, keys, secret }
        }),
        makeSafeStorageServiceLayer(safeStorageClient(calls))
      )

      expect(result.available).toBe(true)
      expect(result.keys).toEqual(["token"])
      expect(result.secret.pipe(encodeUnknownJson)).toBe('"<redacted:SecretBytes>"')
      expect(Array.from(unsafeSecretBytes(result.secret))).toEqual([...SafeStorageTestSecretBytes])
      expect(calls).toEqual(["set:token:13", "get:token", "list", "isAvailable", "delete:token"])
    })
  ))

test("SafeStorage bridge client validates keys and redacts decoded values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = safeStorageExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "SafeStorage.get"
            ? { value: SafeStorageTestSecretBase64 }
            : request.method === "SafeStorage.list"
              ? { keys: ["token"] }
              : request.method === "SafeStorage.isAvailable"
                ? { available: true }
                : undefined
      }))
      const result = yield* runScoped(
        Effect.gen(function* () {
          const storage = yield* SafeStorage
          yield* storage.set("token", makeSafeStorageTestSecret())
          const secret = yield* storage.get("token")
          const keys = yield* storage.list()
          const available = yield* storage.isAvailable()
          yield* storage.delete("token")
          const emptyKeyExit = yield* Effect.exit(storage.set("", makeSafeStorageTestSecret()))
          return { available, emptyKeyExit, keys, secret }
        }),
        Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange))
      )

      expect(result.secret.pipe(encodeUnknownJson)).toBe('"<redacted:SecretBytes>"')
      expect(encodeUnknownJson({ token: result.secret })).not.toContain(SafeStorageTestSecretBase64)
      expect(Array.from(unsafeSecretBytes(result.secret))).toEqual([...SafeStorageTestSecretBytes])
      expect(result.keys).toEqual(["token"])
      expect(result.available).toBe(true)
      expectExitFailure(result.emptyKeyExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["SafeStorage.set", { key: "token", value: SafeStorageTestSecretBase64 }],
        ["SafeStorage.get", { key: "token" }],
        ["SafeStorage.list", null],
        ["SafeStorage.isAvailable", null],
        ["SafeStorage.delete", { key: "token" }]
      ])
    })
  ))

test("SafeStorage bridge client rejects control-byte keys as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string
        readonly key: string
      }> = [
        { label: "empty key", key: "" },
        { label: "newline key", key: "\n" },
        { label: "DEL key", key: "\u007f" }
      ]

      for (const { label, key } of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const exchange = safeStorageExchange(requests, () => ({
          kind: "success",
          payload: undefined
        }))
        const client = yield* runScoped(
          SafeStorage.asEffect(),
          Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange))
        )

        const setExit = yield* Effect.exit(client.set(key, makeSafeStorageTestSecret()))
        const getExit = yield* Effect.exit(client.get(key))
        const deleteExit = yield* Effect.exit(client.delete(key))

        expect(label).toBeDefined()
        expectExitFailure(setExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(getExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(deleteExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(requests).toEqual([])
      }
    })
  ))

test("SafeStorage bridge client rejects invalid keys in list output as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly label: string; readonly keys: ReadonlyArray<string> }> =
        [
          { label: "empty", keys: [""] },
          { label: "nul", keys: ["a\u0000O"] }
        ]

      for (const { label, keys } of cases) {
        const exchange = safeStorageExchange([], () => ({
          kind: "success",
          payload: { keys }
        }))
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const storage = yield* SafeStorage
            return yield* Effect.exit(storage.list())
          }),
          Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(label).toBeDefined()
      }
    })
  ))

test("SafeStorage bridge client decodes valid printable keys in list output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = safeStorageExchange([], () => ({
        kind: "success",
        payload: { keys: ["token", "session"] }
      }))
      const keys = yield* runScoped(
        Effect.gen(function* () {
          const storage = yield* SafeStorage
          return yield* storage.list()
        }),
        Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange))
      )

      expect(keys).toEqual(["token", "session"])
    })
  ))

test("native host RPC runtime denies protected SafeStorage calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostSafeStorageRpcRuntime(
        {
          "SafeStorage.set": (input) =>
            Effect.sync(() => {
              calls.push(`set:${input.key}:${input.value.byteLength}`)
            }),
          "SafeStorage.get": (input) =>
            Effect.sync(() => {
              calls.push(`get:${input.key}`)
              return new SafeStorageSecretPayload({
                value: unsafeSecretBytes(makeSafeStorageTestSecret())
              })
            }),
          "SafeStorage.delete": (input) =>
            Effect.sync(() => {
              calls.push(`delete:${input.key}`)
            }),
          "SafeStorage.list": () =>
            Effect.sync(() => {
              calls.push("list")
              return new SafeStorageListResult({ keys: ["token"] })
            }),
          "SafeStorage.isAvailable": () =>
            Effect.succeed(new SafeStorageAvailabilityResult({ available: true }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "safe-storage-denied",
            method: "SafeStorage.set",
            timestamp: 1710000000000,
            traceId: "trace-safe-storage-denied",
            payload: { key: "token", value: SafeStorageTestSecretBase64 }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
      expect(encodeUnknownJson(response)).not.toContain(SafeStorageTestSecretBase64)
    })
  ))

test("SafeStorage service propagates unsupported platform and host failure without secret values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "secure-storage-unavailable",
        message: "unsupported SafeStorage.set",
        operation: "SafeStorage.set",
        recoverable: false
      })
      const unsupportedClient: SafeStorageClientApi = {
        ...safeStorageClient([]),
        set: () => Effect.fail(unsupported)
      }
      const hostFailureClient: SafeStorageClientApi = {
        ...safeStorageClient([]),
        set: () => Effect.fail(makeHostProtocolHostUnavailableError("SafeStorage.set"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const storage = yield* SafeStorage
          return yield* Effect.exit(storage.set("token", makeSafeStorageTestSecret()))
        }),
        makeSafeStorageServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const storage = yield* SafeStorage
          return yield* Effect.exit(storage.set("token", makeSafeStorageTestSecret()))
        }),
        makeSafeStorageServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
      expect(unsupportedExit.pipe(encodeUnknownJson)).not.toContain(SafeStorageTestSecretBase64)
      expect(hostFailureExit.pipe(encodeUnknownJson)).not.toContain(SafeStorageTestSecretBase64)
    })
  ))

test("Linux SafeStorage client reports unimplemented adapter as unavailable with unsupported operations", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const storage = yield* SafeStorage
          const available = yield* storage.isAvailable()
          const setExit = yield* Effect.exit(storage.set("token", makeSafeStorageTestSecret()))
          const getExit = yield* Effect.exit(storage.get("token"))
          const deleteExit = yield* Effect.exit(storage.delete("token"))
          const keys = yield* storage.list()
          return { available, deleteExit, getExit, keys, setExit }
        }),
        makeSafeStorageServiceLayer(makeLinuxSafeStorageClient())
      )

      expect(result.available).toBe(false)
      expect(result.keys).toEqual([])
      expectExitFailure(
        result.setExit,
        (error) =>
          hasErrorTag(error, "Unsupported") &&
          typeof error === "object" &&
          error !== null &&
          "reason" in error &&
          error.reason === "secret-service-adapter-unimplemented"
      )
      expectExitFailure(result.getExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(result.deleteExit, (error) => hasErrorTag(error, "Unsupported"))
    })
  ))

test("UpdaterRpcs declares the Phase 8 Updater method surface", () => {
  expect([...UpdaterMethodNames]).toEqual(expectedUpdaterMethods)
  expect(rpcMethodNames("Updater", UpdaterRpcs)).toEqual(expectedUpdaterMethods)
  expect(Object.keys(UpdaterRpcEvents)).toEqual(["PreparingRestart"])
})

test("Updater.download support metadata keeps network artifact download unavailable", () => {
  expect(UpdaterRpcs.requests.get("Updater.download")!.pipe(rpcSupport)).toEqual({
    status: "partial",
    reason: "signed-manifest-file-artifact-only",
    platforms: [
      { platform: "macos", status: "partial", reason: "signed-manifest-file-artifact-only" },
      { platform: "windows", status: "partial", reason: "signed-manifest-file-artifact-only" },
      { platform: "linux", status: "partial", reason: "signed-manifest-file-artifact-only" }
    ]
  })
})

test("Updater.getStatus support metadata reports the host-owned updater state", () => {
  expect(UpdaterRpcs.requests.get("Updater.getStatus")!.pipe(rpcSupport)).toEqual({
    status: "supported"
  })
})

test("Updater.install support metadata keeps staged install limitations visible", () => {
  expect(UpdaterRpcs.requests.get("Updater.install")!.pipe(rpcSupport)).toEqual({
    status: "partial",
    reason: "signed-manifest-staged-install-only",
    platforms: [
      { platform: "macos", status: "partial", reason: "signed-manifest-staged-install-only" },
      { platform: "windows", status: "partial", reason: "signed-manifest-staged-install-only" },
      { platform: "linux", status: "partial", reason: "signed-manifest-staged-install-only" }
    ]
  })
})

test("Updater.installAndRestart support metadata keeps restart handshake limitations visible", () => {
  expect(UpdaterRpcs.requests.get("Updater.installAndRestart")!.pipe(rpcSupport)).toEqual({
    status: "partial",
    reason: "signed-manifest-restart-handshake-only",
    platforms: [
      { platform: "macos", status: "partial", reason: "signed-manifest-restart-handshake-only" },
      { platform: "windows", status: "partial", reason: "signed-manifest-restart-handshake-only" },
      { platform: "linux", status: "partial", reason: "signed-manifest-restart-handshake-only" }
    ]
  })
})

test("Updater.readyForRestart support metadata reports the executable restart acknowledgement", () => {
  expect(UpdaterRpcs.requests.get("Updater.readyForRestart")!.pipe(rpcSupport)).toEqual({
    status: "supported"
  })
})

test("Updater service delegates through a substitutable UpdaterClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const updater = yield* Updater
          const check = yield* updater.check(updaterCheckInput("1.0.0"))
          const downloaded = yield* updater.download({ version: "1.1.0" })
          const installed = yield* updater.install({ version: "1.1.0" })
          const restarted = yield* updater.installAndRestart({ version: "1.1.0" })
          const status = yield* updater.getStatus()
          return { check, downloaded, installed, restarted, status }
        }),
        makeUpdaterServiceLayer(updaterClient(calls))
      )

      expect(result.check.available).toBe(true)
      expect(result.check.version).toBe("1.1.0")
      expect(result.downloaded.state).toBe("downloaded")
      expect(result.installed.state).toBe("installing")
      expect(result.restarted.state).toBe("installing")
      expect(result.status.state).toBe("update-available")
      expect(calls).toEqual([
        "check:1.0.0",
        "download:1.1.0",
        "install:1.1.0",
        "installAndRestart:1.1.0",
        "getStatus"
      ])
    })
  ))

test("Updater bridge client sends typed host envelopes and decodes status values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = updaterExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "Updater.check"
            ? { available: true, version: "1.1.0", notes: "security update" }
            : request.method === "Updater.getStatus"
              ? { state: "update-available", version: "1.1.0" }
              : { state: "downloaded", version: "1.1.0", progress: 1 }
      }))
      const result = yield* runScoped(
        Effect.gen(function* () {
          const updater = yield* Updater
          const check = yield* updater.check(updaterCheckInput("1.0.0"))
          const downloaded = yield* updater.download({ version: "1.1.0" })
          const status = yield* updater.getStatus()
          return { check, downloaded, status }
        }),
        Layer.provide(UpdaterLive, makeUpdaterBridgeClientLayer(exchange))
      )

      expect(result.check.available).toBe(true)
      expect(result.check.version).toBe("1.1.0")
      expect(result.downloaded.state).toBe("downloaded")
      expect(result.status.state).toBe("update-available")
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Updater.check", updaterCheckInput("1.0.0")],
        ["Updater.download", { version: "1.1.0" }],
        ["Updater.getStatus", null]
      ])
    })
  ))

test("Updater bridge client sends signed manifest check inputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = updaterExchange(requests, () => ({
        kind: "success",
        payload: { available: true, version: "1.1.0", notes: "signed manifest verified" }
      }))

      yield* runScoped(
        Effect.gen(function* () {
          const updater = yield* Updater
          return yield* updater.check({
            currentVersion: "1.0.0",
            manifestJson: '{"schemaVersion":1}',
            trustAnchors: [{ keyVersion: 7, publicKey: "ed25519:public-key" }]
          })
        }),
        Layer.provide(UpdaterLive, makeUpdaterBridgeClientLayer(exchange))
      )

      expect(requests).toEqual([
        expect.objectContaining({
          method: "Updater.check",
          payload: {
            currentVersion: "1.0.0",
            manifestJson: '{"schemaVersion":1}',
            trustAnchors: [{ keyVersion: 7, publicKey: "ed25519:public-key" }]
          }
        })
      ])
    })
  ))

test("Updater bridge client rejects empty signed manifest trust anchors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Updater.asEffect(),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const emptyAnchorsExit = yield* Effect.exit(
        client.check({ manifestJson: '{"schemaVersion":1}', trustAnchors: [] })
      )

      expectExitFailure(emptyAnchorsExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Updater service exposes the restart readiness handshake", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const updater = yield* Updater
          const restartStatus = yield* updater.installAndRestart({ version: "1.1.0" })
          const events = yield* updater.onPreparingRestart().pipe(Stream.take(1), Stream.runCollect)
          yield* updater.readyForRestart()
          return { events, restartStatus }
        }),
        makeUpdaterServiceLayer(updaterClient(calls))
      )

      expect(result.restartStatus.state).toBe("installing")
      expect(Array.from(result.events)).toEqual([
        new UpdaterPreparingRestartEvent({ deadlineMs: 5_000 })
      ])
      expect(calls).toEqual(["installAndRestart:1.1.0", "readyForRestart"])
    })
  ))

test("CrashReporterRpcs declares the Phase 8 CrashReporter method surface", () => {
  expect([...CrashReporterMethodNames]).toEqual(expectedCrashReporterMethods)
  expect(rpcMethodNames("CrashReporter", CrashReporterRpcs)).toEqual(expectedCrashReporterMethods)
  expect(Object.keys(CrashReporterRpcEvents)).toEqual([])
})

test("CrashReporter memory client requires start and flushes recorded breadcrumbs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCrashReporterMemoryClient()
      const permissions = yield* makeCrashReporterPermissions()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const reporter = yield* CrashReporter
          const notStartedExit = yield* Effect.exit(
            reporter.recordBreadcrumb({ category: "user", message: "clicked save" })
          )
          yield* reporter.start()
          yield* reporter.recordBreadcrumb({ category: "user", message: "clicked save" })
          const flush = yield* reporter.flush()
          const reports = yield* reporter.getReports()
          return { flush, notStartedExit, reports }
        }),
        makeCrashReporterServiceLayer(client, { permissions })
      )

      expectExitFailure(result.notStartedExit, (error) => hasErrorTag(error, "InvalidState"))
      expect(result.flush.flushed).toBe(1)
      expect(result.reports.reports).toEqual([])
    })
  ))

test("CrashReporter service denies native invoke before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const permissions = yield* makeCrashReporterPermissions("deny")
      const exchange = crashReporterExchange(requests, () => ({
        kind: "success",
        payload: undefined
      }))

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const reporter = yield* CrashReporter
          return yield* Effect.exit(reporter.start())
        }),
        Layer.provide(
          Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
          Layer.succeed(PermissionRegistry)(permissions)
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "PermissionDenied"))
      expect(requests).toEqual([])
    })
  ))

test("CrashReporter memory client drains breadcrumbs after flush", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCrashReporterMemoryClient()
      yield* client.start()
      yield* client.recordBreadcrumb({ category: "user", message: "clicked save" })
      const firstFlush = yield* client.flush()
      const secondFlush = yield* client.flush()

      expect(firstFlush.flushed).toBe(1)
      expect(secondFlush.flushed).toBe(0)
    })
  ))

test("CrashReporter rejects control bytes in breadcrumb categories", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCrashReporterMemoryClient()
      yield* client.start()

      const exits: Array<Exit.Exit<unknown, unknown>> = []
      for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
        exits.push(
          yield* Effect.exit(
            client.recordBreadcrumb({
              category: `user${String.fromCharCode(codePoint)}forged`,
              message: "ok"
            })
          )
        )
      }
      exits.push(
        yield* Effect.exit(
          client.recordBreadcrumb({
            category: `user${String.fromCharCode(127)}forged`,
            message: "ok"
          })
        )
      )
      for (const exit of exits) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      yield* client.recordBreadcrumb({ category: "user", message: "ok" })
      const flushed = yield* client.flush()
      expect(flushed.flushed).toBe(1)
    })
  ))

test("CrashReporter rejects invalid breadcrumb timestamps before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const permissions = yield* makeCrashReporterPermissions()
      const exchange = crashReporterExchange(requests, (request) => ({
        kind: "success",
        payload: request.method === "CrashReporter.flush" ? { flushed: 0 } : undefined
      }))

      for (const timestamp of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const reporter = yield* CrashReporter
            yield* reporter.start()
            return yield* Effect.exit(
              reporter.recordBreadcrumb({
                category: "system",
                message: "invalid timestamp",
                timestamp
              })
            )
          }),
          Layer.provide(
            Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
            Layer.succeed(PermissionRegistry)(permissions)
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }

      expect(requests.map((request) => request.method)).toEqual([
        "CrashReporter.start",
        "CrashReporter.start",
        "CrashReporter.start",
        "CrashReporter.start"
      ])
    })
  ))

test("CrashReporter rejects cyclic breadcrumb details", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCrashReporterMemoryClient()
      yield* client.start()
      const cyclicDetails: { self: unknown } = { self: null }
      cyclicDetails.self = cyclicDetails

      const exit = yield* Effect.exit(
        client.recordBreadcrumb({
          category: "system",
          message: "cyclic details",
          details: cyclicDetails
        })
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      const flushed = yield* client.flush()
      expect(flushed.flushed).toBe(0)
    })
  ))

test("CrashReporter bridge client records breadcrumbs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_710_000_555_000
      const permissions = yield* makeCrashReporterPermissions()
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = crashReporterExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "CrashReporter.flush"
            ? { flushed: 0 }
            : request.method === "CrashReporter.getReports"
              ? { reports: [] }
              : undefined
      }))
      const result = yield* runScoped(
        Effect.gen(function* () {
          const reporter = yield* CrashReporter
          yield* reporter.start()
          yield* reporter.recordBreadcrumb({
            category: "user",
            message: "clicked save",
            details: { authorization: "Bearer abc" }
          })
          const flush = yield* reporter.flush()
          const reports = yield* reporter.getReports()
          return { flush, reports }
        }).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp))),
        Layer.provide(
          Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
          Layer.succeed(PermissionRegistry)(permissions)
        )
      )

      expect(result.flush.flushed).toBe(0)
      expect(result.reports.reports).toEqual([])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["CrashReporter.start", {}],
        [
          "CrashReporter.recordBreadcrumb",
          {
            category: "user",
            message: "clicked save",
            details: { authorization: "<redacted:redacted>" },
            timestamp
          }
        ],
        ["CrashReporter.flush", null],
        ["CrashReporter.getReports", null]
      ])
    })
  ))

test("CrashReporter bridge client rejects cyclic breadcrumb details before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const permissions = yield* makeCrashReporterPermissions()
      const exchange = crashReporterExchange(requests, (request) => ({
        kind: "success",
        payload: request.method === "CrashReporter.flush" ? { flushed: 0 } : undefined
      }))
      const cyclicDetails: { self: unknown } = { self: null }
      cyclicDetails.self = cyclicDetails

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const reporter = yield* CrashReporter
          yield* reporter.start()
          return yield* Effect.exit(
            reporter.recordBreadcrumb({
              category: "system",
              message: "cyclic details",
              details: cyclicDetails
            })
          )
        }),
        Layer.provide(
          Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
          Layer.succeed(PermissionRegistry)(permissions)
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests.map((request) => request.method)).toEqual(["CrashReporter.start"])
    })
  ))

test("CrashReporter bridge client rejects invalid flush counts as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]

      for (const flushed of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const permissions = yield* makeCrashReporterPermissions()
        const exchange = crashReporterExchange(requests, (request) => ({
          kind: "success",
          payload: request.method === "CrashReporter.flush" ? { flushed } : undefined
        }))
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const reporter = yield* CrashReporter
            return yield* Effect.exit(reporter.flush())
          }),
          Layer.provide(
            Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
            Layer.succeed(PermissionRegistry)(permissions)
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(requests.map((request) => request.method)).toEqual(["CrashReporter.flush"])
      }
    })
  ))

test("CrashReporter bridge client rejects invalid report timestamps as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const permissions = yield* makeCrashReporterPermissions()
      const exchange = crashReporterExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "CrashReporter.getReports"
            ? {
                reports: [
                  {
                    reportId: "crash-1",
                    artifactPath: "/tmp/crash-1.json",
                    createdAt: -1,
                    sizeBytes: 1,
                    uploaded: false
                  }
                ]
              }
            : undefined
      }))
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const reporter = yield* CrashReporter
          return yield* Effect.exit(reporter.getReports())
        }),
        Layer.provide(
          Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
          Layer.succeed(PermissionRegistry)(permissions)
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      expect(requests.map((request) => request.method)).toEqual(["CrashReporter.getReports"])
    })
  ))

test("CrashReporter bridge client rejects control bytes in report metadata as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [
        { reportId: "crash\n1", artifactPath: "/tmp/crash-1.json" },
        { reportId: "crash-1", artifactPath: `/tmp/crash${String.fromCharCode(0)}1.json` }
      ]

      for (const report of cases) {
        const requests: HostProtocolRequestEnvelope[] = []
        const permissions = yield* makeCrashReporterPermissions()
        const exchange = crashReporterExchange(requests, (request) => ({
          kind: "success",
          payload:
            request.method === "CrashReporter.getReports"
              ? {
                  reports: [
                    {
                      ...report,
                      createdAt: 1_710_000_000_000,
                      sizeBytes: 1,
                      uploaded: false
                    }
                  ]
                }
              : undefined
        }))
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const reporter = yield* CrashReporter
            return yield* Effect.exit(reporter.getReports())
          }),
          Layer.provide(
            Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)),
            Layer.succeed(PermissionRegistry)(permissions)
          )
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(requests.map((request) => request.method)).toEqual(["CrashReporter.getReports"])
      }
    })
  ))

test("ShellRpcs declares the Phase 8 Shell method surface", () => {
  expect([...ShellMethodNames]).toEqual(expectedShellMethods)
  expect(rpcMethodNames("Shell", ShellRpcs)).toEqual(expectedShellMethods)
  expect(ShellRpcs.requests.get("Shell.trashItem")!.pipe(rpcSupport)).toEqual({
    status: "supported"
  })
})

test("Shell service delegates through a substitutable ShellClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      yield* runScoped(
        Effect.gen(function* () {
          const shell = yield* Shell
          yield* shell.openExternal("https://example.com/docs")
          yield* shell.showItemInFolder("/tmp/report.txt")
          yield* shell.openPath("/tmp/report.txt")
          yield* shell.trashItem("/tmp/old-report.txt")
        }),
        makeShellServiceLayer(shellClient(calls))
      )

      expect(calls).toEqual([
        "openExternal:https://example.com/docs:",
        "showItemInFolder:/tmp/report.txt",
        "openPath:/tmp/report.txt:false",
        "trashItem:/tmp/old-report.txt"
      ])
    })
  ))

test("Shell service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-shell-unavailable",
        message: "unsupported Shell.openExternal",
        operation: "Shell.openExternal",
        recoverable: false
      })
      const unsupportedClient: ShellClientApi = {
        ...shellClient([]),
        openExternal: () => Effect.fail(unsupported)
      }
      const hostFailureClient: ShellClientApi = {
        ...shellClient([]),
        openExternal: () => Effect.fail(makeHostProtocolHostUnavailableError("Shell.openExternal"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const shell = yield* Shell
          return yield* Effect.exit(shell.openExternal("https://example.com/docs"))
        }),
        makeShellServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const shell = yield* Shell
          return yield* Effect.exit(shell.openExternal("https://example.com/docs"))
        }),
        makeShellServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("Shell bridge client validates schemes and path argv before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Shell
          yield* client.openExternal("https://example.com/docs")
          const fileExit = yield* Effect.exit(client.openExternal("file:///etc/passwd"))
          const executableExit = yield* Effect.exit(client.openPath("/tmp/install.sh"))
          const cmdExecutableExit = yield* Effect.exit(client.openPath("C:\\Temp\\install.cmd"))
          const metacharExit = yield* Effect.exit(client.trashItem("/tmp/a;b.txt"))
          yield* client.openPath("/tmp/install.sh", { allowExecutable: true })
          yield* client.openPath("C:\\Temp\\install.cmd", { allowExecutable: true })
          return { cmdExecutableExit, executableExit, fileExit, metacharExit }
        }),
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      expectExitFailure(result.fileExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expectExitFailure(result.executableExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expectExitFailure(result.cmdExecutableExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expectExitFailure(result.metacharExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Shell.openExternal", { url: "https://example.com/docs" }],
        ["Shell.openPath", { path: "/tmp/install.sh", allowExecutable: true }],
        ["Shell.openPath", { path: "C:\\Temp\\install.cmd", allowExecutable: true }]
      ])
    })
  ))

test("Shell bridge client validates external URL schemes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Shell
          const denied = yield* Effect.exit(client.openExternal("myapp://callback"))
          yield* client.openExternal("myapp://callback", { allowedSchemes: ["MyApp"] })
          const javascriptDenied = yield* Effect.exit(
            client.openExternal("javascript:alert(1)", { allowedSchemes: ["javascript"] })
          )
          return { denied, javascriptDenied }
        }),
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      expectExitFailure(result.denied, (error) => hasErrorTag(error, "PermissionDenied"))
      expectExitFailure(result.javascriptDenied, (error) => hasErrorTag(error, "PermissionDenied"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Shell.openExternal", { url: "myapp://callback", allowedSchemes: ["MyApp"] }]
      ])
    })
  ))

test("Shell bridge client rejects control characters in external URLs before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Shell.asEffect(),
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      for (const url of [
        "https://example.com/ok\nHeader: x",
        "https://example.com/\r",
        `https://example.com/${String.fromCharCode(0)}`
      ]) {
        const exit = yield* Effect.exit(client.openExternal(url))
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }

      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Shell calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostShellRpcRuntime(
        {
          "Shell.openExternal": () =>
            Effect.sync(() => {
              calls.push("openExternal")
            }),
          "Shell.showItemInFolder": () => Effect.void,
          "Shell.openPath": () => Effect.void,
          "Shell.trashItem": () => Effect.void
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "shell-denied",
            method: "Shell.openExternal",
            payload: { url: "https://example.com/docs" },
            timestamp: 1710000000000,
            traceId: "trace-shell-denied"
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("ScreenRpcs declares the Phase 8 Screen method surface", () => {
  expect([...ScreenMethodNames]).toEqual(expectedScreenMethods)
  expect(Array.from(ScreenRpcs.requests.keys())).toEqual([
    "Screen.getDisplays",
    "Screen.getPrimaryDisplay",
    "Screen.getPointerPoint",
    "Screen.isSupported"
  ])
  expect("tag" in ScreenRpcs).toBe(false)
  expect("events" in ScreenRpcs).toBe(false)
  expect("spec" in ScreenRpcs).toBe(false)
  expect(Object.keys(ScreenRpcEvents)).toEqual(["DisplaysChanged"])
})

test("ScreenSurface derives server, client, test, and metadata surfaces from the RpcGroup", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const app = Desktop.make({
        id: "screen-test",
        windows: Desktop.window("main", { title: "Screen Test" }),
        rpcs: ScreenSurface.serverLayer
      })

      for (const law of ScreenSurface.contractLaws) {
        yield* law.check
      }

      expect(ScreenSurface.group).toBe(ScreenRpcs)
      expect(Array.isArray(ScreenSurface.serverLayer)).toBe(true)
      expect(Layer.isLayer(ScreenSurface.clientLayer)).toBe(true)
      expect(Layer.isLayer(ScreenSurface.testClientLayer)).toBe(true)
      // Identity assertion: inspect the declaration data and confirm (group, handlers)
      // was threaded through unchanged.
      const screenRegistrations = yield* snapshotSurfaceRegistrations(ScreenSurface.serverLayer)
      expect(screenRegistrations).toHaveLength(1)
      expect(screenRegistrations[0]?.group).toBe(ScreenRpcs)
      expect(Object.is(screenRegistrations[0]?.handlers, ScreenHandlersLive)).toBe(true)
      expect(Desktop.manifest(app).rpcGroups[0]?.group).toBe(ScreenRpcs)
      expect(Desktop.describeRpcs(app, ScreenRpcs).map((descriptor) => descriptor.tag)).toEqual([
        "Screen.getDisplays",
        "Screen.getPrimaryDisplay",
        "Screen.getPointerPoint",
        "Screen.isSupported"
      ])
      expect(
        ScreenSurface.schemaDocs.map((doc) => ({
          name: doc.name,
          tag: doc.tag,
          kind: doc.kind,
          callable: doc.callable,
          payload: Option.getOrUndefined(doc.payload),
          success: Option.getOrUndefined(doc.success),
          error: Option.getOrUndefined(doc.error),
          stream: doc.stream,
          support: doc.support,
          capability: Option.isSome(doc.capability) ? doc.capability.value : undefined
        }))
      ).toEqual([
        {
          name: "getDisplays",
          tag: "Screen.getDisplays",
          kind: "mutation",
          callable: true,
          payload: Schema.Void,
          success: ScreenDisplaysResult,
          error: HostProtocolErrorSchema,
          stream: Option.none(),
          support: { status: "supported" },
          capability: P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] })
        },
        {
          name: "getPrimaryDisplay",
          tag: "Screen.getPrimaryDisplay",
          kind: "mutation",
          callable: true,
          payload: Schema.Void,
          success: ScreenDisplay,
          error: HostProtocolErrorSchema,
          stream: Option.none(),
          support: { status: "supported" },
          capability: P.nativeInvoke({ primitive: "Screen", methods: ["getPrimaryDisplay"] })
        },
        {
          name: "getPointerPoint",
          tag: "Screen.getPointerPoint",
          kind: "mutation",
          callable: true,
          payload: Schema.Void,
          success: ScreenPoint,
          error: HostProtocolErrorSchema,
          stream: Option.none(),
          support: { status: "supported" },
          capability: P.nativeInvoke({ primitive: "Screen", methods: ["getPointerPoint"] })
        },
        {
          name: "isSupported",
          tag: "Screen.isSupported",
          kind: "mutation",
          callable: true,
          payload: ScreenIsSupportedInput,
          success: ScreenSupportedResult,
          error: HostProtocolErrorSchema,
          stream: Option.none(),
          support: { status: "supported" },
          capability: { kind: "none" }
        }
      ])
    })
  ))

test("native DesktopRpc surfaces derive server, client, test, and metadata layers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const surfaces = [
        {
          name: "App",
          surface: AppSurface,
          group: AppRpcs,
          handlers: AppHandlersLive,
          tags: Array.from(AppRpcs.requests.keys())
        },
        {
          name: "Clipboard",
          surface: ClipboardSurface,
          group: ClipboardRpcs,
          handlers: ClipboardHandlersLive,
          tags: Array.from(ClipboardRpcs.requests.keys())
        },
        {
          name: "ContextMenu",
          surface: ContextMenuSurface,
          group: ContextMenuRpcs,
          handlers: ContextMenuHandlersLive,
          tags: [
            ...Array.from(ContextMenuRpcs.requests.keys()),
            ...ContextMenuCapabilityFacts.map((fact) => fact.tag)
          ]
        },
        {
          name: "CrashReporter",
          surface: CrashReporterSurface,
          group: CrashReporterRpcs,
          handlers: CrashReporterHandlersLive,
          tags: Array.from(CrashReporterRpcs.requests.keys())
        },
        {
          name: "Dialog",
          surface: DialogSurface,
          group: DialogRpcs,
          handlers: DialogHandlersLive,
          tags: Array.from(DialogRpcs.requests.keys())
        },
        {
          name: "Dock",
          surface: DockSurface,
          group: DockRpcs,
          handlers: DockHandlersLive,
          tags: [
            ...Array.from(DockRpcs.requests.keys()),
            ...DockCapabilityFacts.map((fact) => fact.tag)
          ]
        },
        {
          name: "GlobalShortcut",
          surface: GlobalShortcutSurface,
          group: GlobalShortcutRpcs,
          handlers: GlobalShortcutHandlersLive,
          tags: [
            ...Array.from(GlobalShortcutRpcs.requests.keys()),
            ...GlobalShortcutCapabilityFacts.map((fact) => fact.tag)
          ]
        },
        {
          name: "Menu",
          surface: MenuSurface,
          group: MenuRpcs,
          handlers: MenuHandlersLive,
          tags: [
            ...Array.from(MenuRpcs.requests.keys()),
            ...MenuCapabilityFacts.map((fact) => fact.tag)
          ]
        },
        {
          name: "Notification",
          surface: NotificationSurface,
          group: NotificationRpcs,
          handlers: NotificationHandlersLive,
          tags: Array.from(NotificationRpcs.requests.keys())
        },
        {
          name: "Path",
          surface: PathSurface,
          group: PathRpcs,
          handlers: PathHandlersLive,
          tags: Array.from(PathRpcs.requests.keys())
        },
        {
          name: "PowerMonitor",
          surface: PowerMonitorSurface,
          group: PowerMonitorRpcs,
          handlers: PowerMonitorHandlersLive,
          tags: Array.from(PowerMonitorRpcs.requests.keys())
        },
        {
          name: "Protocol",
          surface: ProtocolSurface,
          group: ProtocolRpcs,
          handlers: ProtocolHandlersLive,
          tags: Array.from(ProtocolRpcs.requests.keys())
        },
        {
          name: "SafeStorage",
          surface: SafeStorageSurface,
          group: SafeStorageRpcs,
          handlers: SafeStorageHandlersLive,
          tags: Array.from(SafeStorageRpcs.requests.keys())
        },
        {
          name: "Shell",
          surface: ShellSurface,
          group: ShellRpcs,
          handlers: ShellHandlersLive,
          tags: Array.from(ShellRpcs.requests.keys())
        },
        {
          name: "SystemAppearance",
          surface: SystemAppearanceSurface,
          group: SystemAppearanceRpcs,
          handlers: SystemAppearanceHandlersLive,
          tags: Array.from(SystemAppearanceRpcs.requests.keys())
        },
        {
          name: "Tray",
          surface: TraySurface,
          group: TrayRpcs,
          handlers: TrayHandlersLive,
          tags: Array.from(TrayRpcs.requests.keys())
        },
        {
          name: "Updater",
          surface: UpdaterSurface,
          group: UpdaterRpcs,
          handlers: UpdaterHandlersLive,
          tags: Array.from(UpdaterRpcs.requests.keys())
        },
        {
          name: "WebView",
          surface: WebViewSurface,
          group: WebViewRpcs,
          handlers: WebViewHandlersLive,
          tags: [
            ...WebViewRpcs.requests.keys(),
            ...expectedWebViewCapabilityFactMethods.map((method) => `WebView.${method}`)
          ]
        },
        {
          name: "Window",
          surface: WindowSurface,
          group: WindowRpcs,
          handlers: WindowHandlersLive,
          tags: Array.from(WindowRpcs.requests.keys())
        }
      ] as const

      for (const { name, surface, group, handlers, tags } of surfaces) {
        for (const law of surface.contractLaws) {
          yield* law.check
        }

        expect(name).toBe(surface.tag)
        expect(surface.group).toBe(group)
        expect(Array.isArray(surface.serverLayer)).toBe(true)
        // Identity assertion: inspect declaration data and confirm the (group, handlers)
        // pair survived. Catches surface() regressions where the wrong group or handlers
        // reference is captured.
        const surfaceRegistrations = yield* snapshotSurfaceRegistrations(surface.serverLayer)
        expect(surfaceRegistrations).toHaveLength(1)
        expect(surfaceRegistrations[0]?.group).toBe(group)
        expect(Object.is(surfaceRegistrations[0]?.handlers, handlers)).toBe(true)
        expect(Layer.isLayer(surface.clientLayer)).toBe(true)
        expect(Layer.isLayer(surface.testClientLayer)).toBe(true)
        expect(surface.schemaDocs.map((doc) => doc.tag)).toEqual(Array.from(tags))
        const callableDocs = surface.schemaDocs.filter((doc) => doc.callable)
        expect(callableDocs.map((doc) => Option.getOrUndefined(doc.error))).toEqual(
          callableDocs.map(() => HostProtocolErrorSchema)
        )
      }
    })
  ))

test("ClipboardSurface test client layer runs Clipboard RPCs through the generated service requirement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const testLayer = Layer.provide(
        ClipboardSurface.testClientLayer,
        makeClipboardServiceLayer(clipboardClient(calls))
      )
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ClipboardClient
          yield* client.writeText("hello")
          const text = yield* client.readText()
          yield* client.writeHtml("<p>hello</p>")
          const html = yield* client.readHtml()
          yield* client.clear()
          const supported = yield* client.isSupported("html")
          return { html, supported, text }
        }),
        testLayer
      )

      expect(result.text).toEqual(new ClipboardText({ text: "hello" }))
      expect(result.html).toEqual(new ClipboardHtml({ html: "<p>hello</p>" }))
      expect(result.supported).toEqual(new ClipboardSupportedResult({ supported: true }))
      expect(calls).toEqual([
        "writeText:hello",
        "readText",
        "writeHtml:<p>hello</p>",
        "readHtml",
        "clear",
        "isSupported:html"
      ])
    })
  ))

test("DialogSurface test client layer runs Dialog RPCs through the generated service requirement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const testLayer = Layer.provide(
        DialogSurface.testClientLayer,
        makeDialogServiceLayer(dialogClient(calls))
      )
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* DialogClient
          const files = yield* client.openFile({ title: "Open" })
          const path = yield* client.saveFile({ defaultPath: "/tmp/report.txt" })
          yield* client.message({ level: "info", message: "Done" })
          const confirmed = yield* client.confirm({ message: "Continue?" })
          return { confirmed, files, path }
        }),
        testLayer
      )

      expect(result.files).toEqual(
        new DialogOpenResult({ paths: ["/canonical/file-a.txt", "/canonical/file-b.txt"] })
      )
      expect(result.path).toEqual(new DialogSaveResult({ path: "/canonical/report.txt" }))
      expect(result.confirmed).toEqual(new DialogConfirmResult({ confirmed: true }))
      expect(calls).toEqual([
        "openFile:Open::false",
        "saveFile:/tmp/report.txt",
        "message:info:Done",
        "confirm:Continue?"
      ])
    })
  ))

test("ScreenSurface test client layer runs Screen RPCs through the generated service requirement", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const testLayer = Layer.provide(
        ScreenSurface.testClientLayer,
        makeScreenServiceLayer(screenClient(calls))
      )
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* ScreenClient
          return {
            displays: yield* client.getDisplays(),
            primary: yield* client.getPrimaryDisplay(),
            pointer: yield* client.getPointerPoint(),
            pointerSupported: yield* client.isSupported("getPointerPoint")
          }
        }),
        testLayer
      )

      expect(result.displays).toEqual(new ScreenDisplaysResult({ displays: [primaryDisplay] }))
      expect(result.primary).toEqual(primaryDisplay)
      expect(result.pointer).toEqual(new ScreenPoint({ x: 12, y: 34 }))
      expect(result.pointerSupported).toEqual(new ScreenSupportedResult({ supported: true }))
      expect(calls).toEqual([
        "getDisplays",
        "getPrimaryDisplay",
        "getPointerPoint",
        "isSupported:getPointerPoint"
      ])
    })
  ))

test("Screen service delegates through a substitutable ScreenClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const screen = yield* Screen
          return {
            displays: yield* screen.getDisplays(),
            changed: yield* screen.onDisplaysChanged().pipe(Stream.take(1), Stream.runCollect),
            primary: yield* screen.getPrimaryDisplay(),
            pointer: yield* screen.getPointerPoint(),
            pointerSupported: yield* screen.isSupported("getPointerPoint")
          }
        }),
        makeScreenServiceLayer(screenClient(calls))
      )

      expect(result.displays).toEqual([primaryDisplay])
      expect(Array.from(result.changed)).toEqual([
        new ScreenDisplaysChangedEvent({ displays: [primaryDisplay] })
      ])
      expect(result.primary).toEqual(primaryDisplay)
      expect(result.pointer).toEqual(new ScreenPoint({ x: 12, y: 34 }))
      expect(result.pointerSupported).toBe(true)
      expect(calls).toEqual([
        "getDisplays",
        "onDisplaysChanged",
        "getPrimaryDisplay",
        "getPointerPoint",
        "isSupported:getPointerPoint"
      ])
    })
  ))

test("Screen service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-screen-unavailable",
        message: "unsupported Screen.getDisplays",
        operation: "Screen.getDisplays",
        recoverable: false
      })
      const unsupportedClient: ScreenClientApi = {
        ...screenClient([]),
        getDisplays: () => Effect.fail(unsupported)
      }
      const hostFailureClient: ScreenClientApi = {
        ...screenClient([]),
        getDisplays: () => Effect.fail(makeHostProtocolHostUnavailableError("Screen.getDisplays"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const screen = yield* Screen
          return yield* Effect.exit(screen.getDisplays())
        }),
        makeScreenServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const screen = yield* Screen
          return yield* Effect.exit(screen.getDisplays())
        }),
        makeScreenServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("Screen bridge client sends typed host envelopes and decodes values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = screenExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "Screen.getDisplays"
            ? { displays: [primaryDisplay] }
            : request.method === "Screen.getPrimaryDisplay"
              ? primaryDisplay
              : request.method === "Screen.isSupported"
                ? { supported: true }
                : { x: 12, y: 34 }
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const screen = yield* Screen
          return {
            displays: yield* screen.getDisplays(),
            changed: yield* screen.onDisplaysChanged().pipe(Stream.take(1), Stream.runCollect),
            primary: yield* screen.getPrimaryDisplay(),
            pointer: yield* screen.getPointerPoint(),
            pointerSupported: yield* screen.isSupported("getPointerPoint")
          }
        }),
        Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))
      )

      expect(result.displays).toEqual([primaryDisplay])
      expect(Array.from(result.changed)).toEqual([
        new ScreenDisplaysChangedEvent({ displays: [primaryDisplay] })
      ])
      expect(result.primary).toMatchObject(primaryDisplay)
      expect(result.pointer).toEqual(new ScreenPoint({ x: 12, y: 34 }))
      expect(result.pointerSupported).toBe(true)
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Screen.getDisplays", undefined],
        ["Screen.getPrimaryDisplay", undefined],
        ["Screen.getPointerPoint", undefined],
        ["Screen.isSupported", { method: "getPointerPoint" }]
      ])
    })
  ))

test("Screen contracts reject invalid display geometry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const validDisplay = {
        id: "main",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 24, width: 1920, height: 1056 },
        scaleFactor: 2,
        primary: true
      }
      const invalidDisplays = [
        { ...validDisplay, bounds: { ...validDisplay.bounds, x: Number.NaN } },
        { ...validDisplay, bounds: { ...validDisplay.bounds, width: 0 } },
        { ...validDisplay, bounds: { ...validDisplay.bounds, height: -1 } },
        {
          ...validDisplay,
          workArea: { ...validDisplay.workArea, width: Number.POSITIVE_INFINITY }
        },
        { ...validDisplay, scaleFactor: 0 },
        { ...validDisplay, scaleFactor: Number.NaN }
      ]

      for (const display of invalidDisplays) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(ScreenDisplay)(display))
        expect(Exit.isFailure(exit)).toBe(true)
      }

      const negativeCoordinate = yield* Schema.decodeUnknownEffect(ScreenDisplay)({
        ...validDisplay,
        bounds: { ...validDisplay.bounds, x: -1920 },
        workArea: { ...validDisplay.workArea, x: -1920 }
      })
      expect(negativeCoordinate.bounds.x).toBe(-1920)

      const invalidPointer = yield* Effect.exit(
        Schema.decodeUnknownEffect(ScreenPoint)({ x: Number.NaN, y: 34 })
      )
      expect(Exit.isFailure(invalidPointer)).toBe(true)
    })
  ))

test("Screen bridge client rejects invalid display geometry as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidDisplay = {
        id: "main",
        bounds: { x: 0, y: 0, width: Number.NaN, height: 1080 },
        workArea: { x: 0, y: 24, width: 1920, height: 1056 },
        scaleFactor: 2,
        primary: true
      }
      const exchange: BridgeClientExchange = {
        request: (request) =>
          Effect.succeed({
            kind: "success",
            payload:
              request.method === "Screen.getDisplays"
                ? { displays: [invalidDisplay] }
                : request.method === "Screen.getPrimaryDisplay"
                  ? invalidDisplay
                  : request.method === "Screen.isSupported"
                    ? { supported: true }
                    : { x: 12, y: 34 }
          }),
        subscribe: (method) =>
          method === "Screen.DisplaysChanged"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000601,
                  traceId: "event-trace",
                  method,
                  payload: { displays: [invalidDisplay] }
                })
              )
            : Stream.empty
      }
      const result = yield* runScoped(
        Effect.gen(function* () {
          const screen = yield* Screen
          const displays = yield* Effect.exit(screen.getDisplays())
          const primary = yield* Effect.exit(screen.getPrimaryDisplay())
          const changed = yield* Effect.exit(
            screen.onDisplaysChanged().pipe(Stream.take(1), Stream.runCollect)
          )
          return { changed, displays, primary }
        }),
        Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))
      )

      expectExitFailure(result.displays, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(result.primary, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(result.changed, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("Screen bridge client rejects invalid primary display topology as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const nonPrimaryDisplay = {
        id: "display-1",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 24, width: 1920, height: 1056 },
        scaleFactor: 2,
        primary: false
      }
      const exchange = screenExchange([], (request) => ({
        kind: "success",
        payload:
          request.method === "Screen.getPrimaryDisplay"
            ? nonPrimaryDisplay
            : request.method === "Screen.getDisplays"
              ? { displays: [primaryDisplay] }
              : request.method === "Screen.isSupported"
                ? { supported: true }
                : { x: 12, y: 34 }
      }))
      const result = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const screen = yield* Screen
            return yield* screen.getPrimaryDisplay()
          }),
          Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(result, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("Screen bridge client rejects invalid primary display and display-change geometry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const notPrimary = {
        id: "main",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 24, width: 1920, height: 1056 },
        scaleFactor: 2,
        primary: false
      }
      const invalidEventDisplay = {
        ...notPrimary,
        primary: true,
        bounds: { x: 0, y: 0, width: 1920, height: Number.NaN }
      }
      const exchange: BridgeClientExchange = {
        request: (request) =>
          Effect.succeed({
            kind: "success",
            payload:
              request.method === "Screen.getPrimaryDisplay"
                ? notPrimary
                : request.method === "Screen.isSupported"
                  ? { supported: true }
                  : { displays: [primaryDisplay] }
          }),
        subscribe: (method) =>
          method === "Screen.DisplaysChanged"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1_710_000_000_600,
                  traceId: "event-trace",
                  method,
                  payload: { displays: [invalidEventDisplay] }
                })
              )
            : Stream.empty
      }
      const result = yield* runScoped(
        Effect.gen(function* () {
          const screen = yield* Screen
          return {
            primary: yield* Effect.exit(screen.getPrimaryDisplay()),
            event: yield* Effect.exit(
              screen.onDisplaysChanged().pipe(Stream.take(1), Stream.runCollect)
            )
          }
        }),
        Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))
      )

      expectExitFailure(result.primary, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(result.event, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("native host RPC runtime denies protected Screen calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const rows: AuditEvent[] = []
      const runtime = makeHostScreenRpcRuntime(
        {
          "Screen.getDisplays": () =>
            Effect.sync(() => {
              calls.push("getDisplays")
              return new ScreenDisplaysResult({ displays: [primaryDisplay] })
            }),
          "Screen.getPrimaryDisplay": () => Effect.succeed(primaryDisplay),
          "Screen.getPointerPoint": () => Effect.succeed(new ScreenPoint({ x: 12, y: 34 })),
          "Screen.isSupported": () => Effect.succeed(new ScreenSupportedResult({ supported: true }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-screen-denied"
      })

      const response = yield* runtime
        .dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "screen-denied",
            method: "Screen.getDisplays",
            timestamp: 1710000000000,
            traceId: "trace-screen-denied"
          })
        )
        .pipe(Effect.provideService(PermissionRegistry, permissions))

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
      expect(rows.map((row) => row.kind)).toEqual(["permission-denied"])
      expect(rows.map((row) => row.normalizedCapability)).toEqual([
        P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] })
      ])
    })
  ))

test("native host RPC runtime audits Screen.getDisplays permission use", () => {
  const rows: AuditEvent[] = []
  const calls: string[] = []
  const runtime = makeHostScreenRpcRuntime(
    {
      "Screen.getDisplays": () =>
        Effect.sync(() => {
          calls.push("getDisplays")
          return new ScreenDisplaysResult({ displays: [primaryDisplay] })
        }),
      "Screen.getPrimaryDisplay": () => Effect.succeed(primaryDisplay),
      "Screen.getPointerPoint": () => Effect.succeed(new ScreenPoint({ x: 12, y: 34 })),
      "Screen.isSupported": () => Effect.succeed(new ScreenSupportedResult({ supported: true }))
    },
    { originAuth: RendererOriginAuth.unsafeDisabledForTests }
  )

  return Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-screen-audit"
      })
      yield* permissions.declare(
        P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] }),
        {
          source: "screen-persistence-test",
          effect: "allow"
        }
      )
      const response = yield* runtime
        .dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "screen-get-displays-allowed",
            method: "Screen.getDisplays",
            timestamp: 1_710_000_003_200,
            traceId: "trace-screen-get-displays-allowed"
          })
        )
        .pipe(Effect.provideService(PermissionRegistry, permissions))

      expect(response.kind).toBe("success")
      expect(calls).toEqual(["getDisplays"])
      expect(rows.map((row) => row.kind)).toEqual([
        "permission-granted",
        "permission-granted",
        "permission-used"
      ])
      expect(rows.map((row) => row.normalizedCapability)).toEqual([
        P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] }),
        P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] }),
        P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] })
      ])
    })
  )
})

test("native host RPC runtime lets permission-free Screen support calls pass through", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostScreenRpcRuntime(
        {
          "Screen.getDisplays": () => Effect.succeed(new ScreenDisplaysResult({ displays: [] })),
          "Screen.getPrimaryDisplay": () => Effect.succeed(primaryDisplay),
          "Screen.getPointerPoint": () => Effect.succeed(new ScreenPoint({ x: 12, y: 34 })),
          "Screen.isSupported": (input) =>
            Effect.sync(() => {
              calls.push(input.method)
              return new ScreenSupportedResult({ supported: input.method === "getDisplays" })
            })
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "screen-support",
            method: "Screen.isSupported",
            timestamp: 1710000000000,
            traceId: "trace-screen-support",
            payload: { method: "getDisplays" }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response).toEqual({ kind: "success", payload: { supported: true } })
      expect(calls).toEqual(["getDisplays"])
    })
  ))

test("native host RPC runtime uses the Effect Clock for inspector state timestamps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_710_000_777_000
      const events: unknown[] = []
      const runtime = makeNativeHostRpcRuntime(
        ScreenRpcs,
        ScreenRpcs.toLayer({
          "Screen.getDisplays": () => Effect.succeed(new ScreenDisplaysResult({ displays: [] })),
          "Screen.getPrimaryDisplay": () => Effect.succeed(primaryDisplay),
          "Screen.getPointerPoint": () => Effect.succeed(new ScreenPoint({ x: 12, y: 34 })),
          "Screen.isSupported": () => Effect.succeed(new ScreenSupportedResult({ supported: true }))
        }),
        {
          originAuth: RendererOriginAuth.unsafeDisabledForTests,
          nativeHostInspector: {
            publish: (event) =>
              Effect.sync(() => {
                events.push(event)
              }),
            events: Stream.empty
          }
        }
      )

      const response = yield* runScoped(
        runtime
          .dispatch(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: "screen-inspected",
              method: "Screen.isSupported",
              timestamp: 1710000000000,
              traceId: "trace-screen-inspected",
              payload: { method: "getDisplays" }
            })
          )
          .pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp))),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response).toEqual({ kind: "success", payload: { supported: true } })
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "host",
          message: "Pending",
          timestamp,
          traceId: "trace-screen-inspected"
        })
      )
    })
  ))

test("Screen bridge client validates generated protocol timestamps as typed failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const assertScreenBridgeClientOptionsRejectRequestId = (
        makeLayer: typeof makeScreenBridgeClientLayer
      ): void => {
        makeLayer(
          screenExchange([], () => ({ kind: "success", payload: {} })),
          {
            // @ts-expect-error Effect RPC owns request IDs for generated Screen clients
            nextRequestId: () => "request-id"
          }
        )
      }
      void assertScreenBridgeClientOptionsRejectRequestId
      const exchange = screenExchange([], () => ({ kind: "success", payload: { displays: [] } }))
      const result = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const screen = yield* Screen
            return yield* screen.getDisplays()
          }),
          Layer.provide(
            ScreenLive,
            makeScreenBridgeClientLayer(exchange, { now: () => Number.NaN })
          )
        )
      )

      expectExitFailure(
        result,
        (error) =>
          hasErrorTag(error, "InvalidArgument") &&
          typeof error === "object" &&
          error !== null &&
          "field" in error &&
          error.field === "timestamp"
      )
    })
  ))

test("Screen bridge client rejects empty display lists as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = screenExchange([], () => ({ kind: "success", payload: { displays: [] } }))
      const result = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const screen = yield* Screen
            return yield* screen.getDisplays()
          }),
          Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(result, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("Screen bridge client rejects invalid primary display topologies as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const multiplePrimary = {
        displays: [
          new ScreenDisplay({
            id: "secondary-1",
            bounds: screenBounds,
            workArea: new ScreenBounds({ x: 0, y: 24, width: 1920, height: 1056 }),
            scaleFactor: 2,
            primary: true
          }),
          new ScreenDisplay({
            id: "secondary-2",
            bounds: screenBounds,
            workArea: new ScreenBounds({ x: 0, y: 24, width: 1920, height: 1056 }),
            scaleFactor: 2,
            primary: true
          })
        ]
      }
      const exchange = screenExchange([], (request) => ({
        kind: "success",
        payload: request.method === "Screen.getDisplays" ? multiplePrimary : primaryDisplay
      }))
      const result = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const screen = yield* Screen
            return yield* screen.getDisplays()
          }),
          Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))
        )
      )

      expectExitFailure(result, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("SystemAppearanceRpcs declares the Phase 8 SystemAppearance method and event surface", () => {
  expect([...SystemAppearanceMethodNames]).toEqual(expectedSystemAppearanceMethods)
  expect(rpcMethodNames("SystemAppearance", SystemAppearanceRpcs)).toEqual(
    expectedSystemAppearanceMethods
  )
  expect(
    SystemAppearanceRpcs.requests.get("SystemAppearance.getAccentColor")!.pipe(rpcSupport)
  ).toEqual({
    status: "supported"
  })
  expect(
    SystemAppearanceRpcs.requests.get("SystemAppearance.getAppearance")!.pipe(rpcSupport)
  ).toEqual({
    status: "partial",
    reason: "host-system-appearance-snapshot",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ]
  })
  expect(
    SystemAppearanceRpcs.requests.get("SystemAppearance.getReducedMotion")!.pipe(rpcSupport)
  ).toEqual({
    status: "partial",
    reason: "host-system-appearance-snapshot",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ]
  })
  expect(
    SystemAppearanceRpcs.requests.get("SystemAppearance.getReducedTransparency")!.pipe(rpcSupport)
  ).toEqual({
    status: "partial",
    reason: "host-system-appearance-snapshot",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ]
  })
  expect(Object.keys(SystemAppearanceRpcEvents)).toEqual(["AppearanceChanged"])
})

test("SystemAppearance service maps result wrappers to public values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const appearance = yield* SystemAppearance
          return {
            mode: yield* appearance.getAppearance(),
            accent: yield* appearance.getAccentColor(),
            motion: yield* appearance.getReducedMotion(),
            transparency: yield* appearance.getReducedTransparency(),
            changed: yield* appearance
              .onAppearanceChanged()
              .pipe(Stream.take(1), Stream.runCollect),
            accentSupported: yield* appearance.isSupported("getAccentColor"),
            changeSupported: yield* appearance.isSupported("onAppearanceChanged")
          }
        }),
        makeSystemAppearanceServiceLayer(systemAppearanceClient(calls))
      )

      expect(result.mode).toBe("dark")
      expect(result.accent).toEqual(accentColor)
      expect(result.motion).toBe(true)
      expect(result.transparency).toBe(false)
      expect(result.accentSupported).toBe(true)
      expect(result.changeSupported).toBe(true)
      expect(Array.from(result.changed)).toEqual([
        new SystemAppearanceChangedEvent({
          appearance: "highContrast",
          accentColor,
          reducedMotion: true,
          reducedTransparency: false
        })
      ])
      expect(calls).toEqual([
        "getAppearance",
        "getAccentColor",
        "getReducedMotion",
        "getReducedTransparency",
        "isSupported:getAccentColor",
        "isSupported:onAppearanceChanged"
      ])
    })
  ))

test("SystemAppearance bridge client decodes nullable accent color and events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = systemAppearanceExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "SystemAppearance.getAppearance"
            ? { appearance: "dark" }
            : request.method === "SystemAppearance.getAccentColor"
              ? { color: null }
              : request.method === "SystemAppearance.isSupported"
                ? { supported: true }
                : { enabled: request.method === "SystemAppearance.getReducedMotion" }
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const appearance = yield* SystemAppearance
          return {
            mode: yield* appearance.getAppearance(),
            accent: yield* appearance.getAccentColor(),
            motion: yield* appearance.getReducedMotion(),
            transparency: yield* appearance.getReducedTransparency(),
            changed: yield* appearance
              .onAppearanceChanged()
              .pipe(Stream.take(1), Stream.runCollect),
            accentSupported: yield* appearance.isSupported("getAccentColor")
          }
        }),
        Layer.provide(SystemAppearanceLive, makeSystemAppearanceBridgeClientLayer(exchange))
      )

      expect(result.mode).toBe("dark")
      expect(result.accent).toBeNull()
      expect(result.motion).toBe(true)
      expect(result.transparency).toBe(false)
      expect(result.accentSupported).toBe(true)
      expect(Array.from(result.changed)).toEqual([
        new SystemAppearanceChangedEvent({
          appearance: "highContrast",
          accentColor: null,
          reducedMotion: true,
          reducedTransparency: false
        })
      ])
      expect(requests.map((request) => request.method)).toEqual([
        "SystemAppearance.getAppearance",
        "SystemAppearance.getAccentColor",
        "SystemAppearance.getReducedMotion",
        "SystemAppearance.getReducedTransparency",
        "SystemAppearance.isSupported",
        "SystemAppearance.isSupported"
      ])
    })
  ))

test("SystemAppearance contracts reject invalid color channels", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const validColor = yield* Schema.decodeUnknownEffect(SystemAppearanceColor)({
        r: 0,
        g: 0.5,
        b: 1,
        a: 1
      })
      expect(validColor).toEqual(new SystemAppearanceColor({ r: 0, g: 0.5, b: 1, a: 1 }))

      const invalidColors = [
        { r: Number.NaN, g: 0, b: 0, a: 1 },
        { r: Number.POSITIVE_INFINITY, g: 0, b: 0, a: 1 },
        { r: -0.1, g: 0, b: 0, a: 1 },
        { r: 1.1, g: 0, b: 0, a: 1 },
        { r: 0, g: 0, b: 0, a: Number.NaN }
      ]

      for (const color of invalidColors) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(SystemAppearanceColor)(color))
        expect(Exit.isFailure(exit)).toBe(true)
      }
    })
  ))

test("SystemAppearance bridge client rejects invalid color channels as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidAccentColor = { r: 0, g: 1.25, b: 0, a: 1 }
      const invalidEventColor = { r: 0, g: 0, b: 0, a: Number.NaN }
      const exchange: BridgeClientExchange = {
        request: (request) =>
          Effect.succeed({
            kind: "success",
            payload:
              request.method === "SystemAppearance.getAccentColor"
                ? { color: invalidAccentColor }
                : request.method === "SystemAppearance.isSupported"
                  ? { supported: true }
                  : request.method === "SystemAppearance.getAppearance"
                    ? { appearance: "dark" }
                    : { enabled: false }
          }),
        subscribe: (method) =>
          method === "SystemAppearance.AppearanceChanged"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1_710_000_000_702,
                  traceId: "event-trace",
                  method,
                  payload: {
                    appearance: "dark",
                    accentColor: invalidEventColor,
                    reducedMotion: false,
                    reducedTransparency: false
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const appearance = yield* SystemAppearance
          return {
            accent: yield* Effect.exit(appearance.getAccentColor()),
            changed: yield* Effect.exit(
              appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect)
            )
          }
        }),
        Layer.provide(SystemAppearanceLive, makeSystemAppearanceBridgeClientLayer(exchange))
      )

      expectExitFailure(result.accent, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(result.changed, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("SystemAppearance bridge client rejects partial appearance events as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [
        {
          name: "missing accentColor",
          payload: {
            appearance: "dark",
            reducedMotion: true,
            reducedTransparency: false
          }
        },
        {
          name: "excess field",
          payload: {
            appearance: "dark",
            accentColor: null,
            reducedMotion: true,
            reducedTransparency: false,
            isDark: true
          }
        }
      ] as const

      for (const { payload } of cases) {
        const result = yield* runScoped(
          Effect.gen(function* () {
            const appearance = yield* SystemAppearance
            return yield* Effect.exit(
              appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect)
            )
          }),
          Layer.provide(
            SystemAppearanceLive,
            makeSystemAppearanceBridgeClientLayer(systemAppearanceEventExchange(payload))
          )
        )

        expectExitFailure(result, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("SystemAppearance bridge client fails unsupported appearance events before subscription", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: string[] = []
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request.method)
          return request.method === "SystemAppearance.isSupported"
            ? Effect.succeed({ kind: "success", payload: { supported: false } })
            : Effect.die(`unexpected SystemAppearance request: ${request.method}`)
        },
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const appearance = yield* SystemAppearance
          return yield* Effect.exit(
            appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect)
          )
        }),
        Layer.provide(SystemAppearanceLive, makeSystemAppearanceBridgeClientLayer(exchange))
      )

      expectExitFailure(result, (error) => hasErrorTag(error, "Unsupported"))
      expect(requests).toEqual(["SystemAppearance.isSupported"])
      expect(subscriptions).toEqual([])
    })
  ))

test("native host RPC runtime denies protected SystemAppearance support queries before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostSystemAppearanceRpcRuntime(
        {
          "SystemAppearance.getAppearance": () =>
            Effect.succeed(new SystemAppearanceResult({ appearance: "dark" })),
          "SystemAppearance.getAccentColor": () =>
            Effect.succeed(new SystemAppearanceAccentColorResult({ color: null })),
          "SystemAppearance.getReducedMotion": () =>
            Effect.succeed(new SystemAppearanceBooleanResult({ enabled: false })),
          "SystemAppearance.getReducedTransparency": () =>
            Effect.succeed(new SystemAppearanceBooleanResult({ enabled: false })),
          "SystemAppearance.isSupported": () =>
            Effect.sync(() => {
              calls.push("isSupported")
              return new SystemAppearanceSupportedResult({ supported: true })
            })
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "system-appearance-denied",
            method: "SystemAppearance.isSupported",
            timestamp: 1710000000000,
            traceId: "trace-system-appearance-denied",
            payload: { method: "onAppearanceChanged" }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

const systemAppearanceEventExchange = (payload: Record<string, unknown>): BridgeClientExchange => ({
  request: (request) =>
    request.method === "SystemAppearance.isSupported"
      ? Effect.succeed({ kind: "success", payload: { supported: true } })
      : Effect.die(`unexpected SystemAppearance request: ${request.method}`),
  subscribe: (method) =>
    method === "SystemAppearance.AppearanceChanged"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000701,
            traceId: "event-trace",
            method,
            payload
          })
        )
      : Stream.empty
})

test("PowerMonitorRpcs declares the Phase 8 event-only surface", () => {
  expect([...PowerMonitorMethodNames]).toEqual(expectedPowerMonitorMethods)
  expect(Array.from(PowerMonitorRpcs.requests.keys())).toEqual(["PowerMonitor.isSupported"])
  expect(Object.keys(PowerMonitorRpcEvents)).toEqual([
    "Suspend",
    "Resume",
    "Shutdown",
    "LockScreen",
    "UnlockScreen",
    "PowerSourceChanged"
  ])
})

test("PowerMonitor bridge client decodes power event streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const power = yield* PowerMonitor
          return {
            suspend: yield* power.onSuspend().pipe(Stream.take(1), Stream.runCollect),
            resume: yield* power.onResume().pipe(Stream.take(1), Stream.runCollect),
            shutdown: yield* power.onShutdown().pipe(Stream.take(1), Stream.runCollect),
            lock: yield* power.onLockScreen().pipe(Stream.take(1), Stream.runCollect),
            unlock: yield* power.onUnlockScreen().pipe(Stream.take(1), Stream.runCollect),
            source: yield* power.onPowerSourceChanged().pipe(Stream.take(1), Stream.runCollect),
            lockSupported: yield* power.isSupported("onLockScreen"),
            sourceSupported: yield* power.isSupported("onPowerSourceChanged")
          }
        }),
        Layer.provide(PowerMonitorLive, makePowerMonitorBridgeClientLayer(powerMonitorExchange()))
      )

      expect(Array.from(result.suspend)).toEqual([
        new PowerMonitorSuspendEvent({ reason: "sleep" })
      ])
      expect(Array.from(result.resume)).toEqual([new PowerMonitorResumeEvent({ reason: "wake" })])
      expect(Array.from(result.shutdown)).toEqual([
        new PowerMonitorShutdownEvent({ reason: "system" })
      ])
      expect(Array.from(result.lock)).toEqual([
        new PowerMonitorLockScreenEvent({ reason: "locked" })
      ])
      expect(Array.from(result.unlock)).toEqual([
        new PowerMonitorUnlockScreenEvent({ reason: "unlocked" })
      ])
      expect(Array.from(result.source)).toEqual([
        new PowerMonitorSourceChangedEvent({ source: "battery" })
      ])
      expect(result.lockSupported).toBe(true)
      expect(result.sourceSupported).toBe(true)
    })
  ))

test("PowerMonitor bridge client rejects blank event reasons as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly method:
          | "PowerMonitor.Suspend"
          | "PowerMonitor.Resume"
          | "PowerMonitor.Shutdown"
          | "PowerMonitor.LockScreen"
          | "PowerMonitor.UnlockScreen"
      }> = [
        { method: "PowerMonitor.Suspend" },
        { method: "PowerMonitor.Resume" },
        { method: "PowerMonitor.Shutdown" },
        { method: "PowerMonitor.LockScreen" },
        { method: "PowerMonitor.UnlockScreen" }
      ]

      for (const { method } of cases) {
        const exchange: BridgeClientExchange = {
          request: (request) =>
            request.method === "PowerMonitor.isSupported"
              ? Effect.succeed({ kind: "success" as const, payload: { supported: true } })
              : Effect.die(`unexpected PowerMonitor request: ${request.method}`),
          subscribe: (eventMethod) =>
            eventMethod === method
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000610,
                    traceId: "event-trace",
                    method: eventMethod,
                    payload: { reason: "" }
                  })
                )
              : Stream.empty
        }
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const power = yield* PowerMonitor
            return yield* Effect.exit(
              method === "PowerMonitor.Suspend"
                ? power.onSuspend().pipe(Stream.take(1), Stream.runCollect)
                : method === "PowerMonitor.Resume"
                  ? power.onResume().pipe(Stream.take(1), Stream.runCollect)
                  : method === "PowerMonitor.Shutdown"
                    ? power.onShutdown().pipe(Stream.take(1), Stream.runCollect)
                    : method === "PowerMonitor.LockScreen"
                      ? power.onLockScreen().pipe(Stream.take(1), Stream.runCollect)
                      : power.onUnlockScreen().pipe(Stream.take(1), Stream.runCollect)
            )
          }),
          Layer.provide(PowerMonitorLive, makePowerMonitorBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("PowerMonitor bridge client fails unsupported event streams before subscription", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: string[] = []
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: (request) => {
          requests.push(request.method)
          return request.method === "PowerMonitor.isSupported"
            ? Effect.succeed({ kind: "success", payload: { supported: false } })
            : Effect.die(`unexpected PowerMonitor request: ${request.method}`)
        },
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const power = yield* PowerMonitor
          return yield* Effect.exit(power.onSuspend().pipe(Stream.take(1), Stream.runCollect))
        }),
        Layer.provide(PowerMonitorLive, makePowerMonitorBridgeClientLayer(exchange))
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "Unsupported"))
      expect(requests).toEqual(["PowerMonitor.isSupported"])
      expect(subscriptions).toEqual([])
    })
  ))

test("native host RPC runtime denies protected PowerMonitor support queries before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostPowerMonitorRpcRuntime(
        {
          "PowerMonitor.isSupported": () =>
            Effect.sync(() => {
              calls.push("isSupported")
              return new PowerMonitorSupportedResult({ supported: true })
            })
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "power-monitor-denied",
            method: "PowerMonitor.isSupported",
            timestamp: 1710000000000,
            traceId: "trace-power-monitor-denied",
            payload: { method: "onSuspend" }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("DockRpcs declares the Phase 8 Dock method surface", () => {
  expect([...DockMethodNames]).toEqual(expectedDockMethods)
  expect(rpcMethodNames("Dock", DockRpcs)).toEqual(expectedDockMethods)
})

test("Dock declares setMenu, setJumpList as non-callable capability facts", () => {
  const factTags = DockCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    expectedDockCapabilityFactMethods.map((method) => `Dock.${method}`).toSorted()
  )
  for (const fact of DockCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }

  const callableTags = Array.from(DockRpcs.requests.keys())
  for (const method of expectedDockCapabilityFactMethods) {
    expect(callableTags).not.toContain(`Dock.${method}`)
  }

  const nonCallableTags = DockSurface.schemaDocs
    .filter((doc) => !doc.callable)
    .map((doc) => doc.tag)
    .toSorted()
  expect(nonCallableTags).toEqual(
    expectedDockCapabilityFactMethods.map((method) => `Dock.${method}`).toSorted()
  )
})

test("Dock service delegates through a substitutable DockClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const supported = yield* runScoped(
        Effect.gen(function* () {
          const dock = yield* Dock
          yield* dock.setBadgeCount(5)
          yield* dock.setBadgeText("5")
          yield* dock.setProgress(0.5, { state: "normal" })
          yield* dock.requestAttention({ critical: true })
          return yield* dock.isSupported("setBadgeText")
        }),
        makeDockServiceLayer(dockClient(calls))
      )

      expect(supported).toBe(true)
      expect(calls).toEqual([
        "setBadgeCount:5",
        "setBadgeText:5",
        "setProgress:0.5:normal",
        "requestAttention:true",
        "isSupported:setBadgeText"
      ])
    })
  ))

test("Dock bridge client sends typed host envelopes and maps support result", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = dockExchange(requests, (request) => ({
        kind: "success",
        payload: request.method === "Dock.isSupported" ? { supported: true } : undefined
      }))

      const supported = yield* runScoped(
        Effect.gen(function* () {
          const dock = yield* Dock
          yield* dock.setBadgeCount(5)
          yield* dock.setBadgeText("1")
          yield* dock.setBadgeText(null)
          yield* dock.setProgress(null)
          yield* dock.requestAttention()
          return yield* dock.isSupported("setJumpList")
        }),
        Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))
      )

      expect(supported).toBe(true)
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Dock.setBadgeCount", { count: 5 }],
        ["Dock.setBadgeText", { text: "1" }],
        ["Dock.setBadgeText", { text: null }],
        ["Dock.setProgress", { value: null }],
        ["Dock.requestAttention", {}],
        ["Dock.isSupported", { method: "setJumpList" }]
      ])
    })
  ))

test("Dock bridge client rejects invalid badge text before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = dockExchange(requests, () => ({
        kind: "success",
        payload: undefined
      }))

      const dock = yield* runScoped(
        Dock.asEffect(),
        Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))
      )

      const nulExit = yield* Effect.exit(dock.setBadgeText("bad\u0000text"))
      const newlineExit = yield* Effect.exit(dock.setBadgeText("line\nbreak"))
      const tabExit = yield* Effect.exit(dock.setBadgeText("badge\ttext"))

      for (const exit of [nulExit, newlineExit, tabExit]) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("Dock bridge client rejects invalid numeric state before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = dockExchange(requests, () => ({
        kind: "success",
        payload: undefined
      }))

      const dock = yield* runScoped(
        Dock.asEffect(),
        Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))
      )

      const negativeBadgeExit = yield* Effect.exit(dock.setBadgeCount(-1))
      const fractionalBadgeExit = yield* Effect.exit(dock.setBadgeCount(1.5))
      const belowZeroProgressExit = yield* Effect.exit(dock.setProgress(-0.5))
      const aboveOneProgressExit = yield* Effect.exit(dock.setProgress(1.5))
      const invalidProgressExit = yield* Effect.exit(dock.setProgress(Number.NaN))

      for (const exit of [
        negativeBadgeExit,
        fractionalBadgeExit,
        belowZeroProgressExit,
        aboveOneProgressExit,
        invalidProgressExit
      ]) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime denies protected Dock calls before handlers run", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const runtime = makeHostDockRpcRuntime(
        {
          "Dock.setBadgeCount": (input) =>
            Effect.sync(() => {
              calls.push(`setBadgeCount:${input.count}`)
            }),
          "Dock.setBadgeText": (input) =>
            Effect.sync(() => {
              calls.push(`setBadgeText:${input.text ?? ""}`)
            }),
          "Dock.setProgress": (input) =>
            Effect.sync(() => {
              calls.push(`setProgress:${input.value ?? ""}`)
            }),
          "Dock.requestAttention": (input) =>
            Effect.sync(() => {
              calls.push(`requestAttention:${input.critical ?? false}`)
            }),
          "Dock.isSupported": () => Effect.succeed(new DockSupportedResult({ supported: true }))
        },
        { originAuth: RendererOriginAuth.unsafeDisabledForTests }
      )

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "dock-denied",
            method: "Dock.setBadgeCount",
            timestamp: 1710000000000,
            traceId: "trace-dock-denied",
            payload: { count: 1 }
          })
        ),
        Layer.effect(PermissionRegistry, makePermissionRegistry())
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(calls).toEqual([])
    })
  ))

test("Dock service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported Dock.setBadgeCount",
        operation: "Dock.setBadgeCount",
        recoverable: false
      })
      const unsupportedClient: DockClientApi = {
        ...dockClient([]),
        setBadgeCount: () => Effect.fail(unsupported)
      }
      const hostFailureClient: DockClientApi = {
        ...dockClient([]),
        setProgress: () => Effect.fail(makeHostProtocolHostUnavailableError("Dock.setProgress"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const dock = yield* Dock
          return yield* Effect.exit(dock.setBadgeCount(1))
        }),
        makeDockServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const dock = yield* Dock
          return yield* Effect.exit(dock.setProgress(0.5))
        }),
        makeDockServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("Linux Dock client reports unimplemented partial methods as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const dock = yield* Dock
          const badgeCountSupported = yield* dock.isSupported("setBadgeCount")
          const progressSupported = yield* dock.isSupported("setProgress")
          const attentionSupported = yield* dock.isSupported("requestAttention")
          const badgeTextSupported = yield* dock.isSupported("setBadgeText")
          const menuSupported = yield* dock.isSupported("setMenu")
          const badgeCountExit = yield* Effect.exit(dock.setBadgeCount(1))
          const progressExit = yield* Effect.exit(dock.setProgress(0.5))
          const attentionExit = yield* Effect.exit(dock.requestAttention())
          const textExit = yield* Effect.exit(dock.setBadgeText("hi"))
          return {
            attentionExit,
            attentionSupported,
            badgeCountExit,
            badgeCountSupported,
            badgeTextSupported,
            menuSupported,
            progressExit,
            progressSupported,
            textExit
          }
        }),
        makeDockServiceLayer(makeLinuxDockClient())
      )

      expect(result.badgeCountSupported).toBe(false)
      expect(result.progressSupported).toBe(false)
      expect(result.attentionSupported).toBe(true)
      expect(result.badgeTextSupported).toBe(false)
      expect(result.menuSupported).toBe(false)
      expectExitFailure(result.badgeCountExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(result.progressExit, (error) => hasErrorTag(error, "Unsupported"))
      expect(Exit.isSuccess(result.attentionExit)).toBe(true)
      expectExitFailure(
        result.textExit,
        (error) =>
          hasErrorTag(error, "Unsupported") &&
          typeof error === "object" &&
          error !== null &&
          "reason" in error &&
          error.reason === "no portable badge text on Linux"
      )
    })
  ))

test("GlobalShortcutRpcs declares the Phase 8 GlobalShortcut method and event surface", () => {
  expect([...GlobalShortcutMethodNames]).toEqual(expectedGlobalShortcutMethods)
  expect(rpcMethodNames("GlobalShortcut", GlobalShortcutRpcs)).toEqual(
    expectedGlobalShortcutMethods
  )
  expect(Object.keys(GlobalShortcutRpcEvents)).toEqual(["Pressed"])
})

test("GlobalShortcut declares register, unregister, unregisterAll as non-callable capability facts", () => {
  const factTags = GlobalShortcutCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(
    expectedGlobalShortcutCapabilityFactMethods
      .map((method) => `GlobalShortcut.${method}`)
      .toSorted()
  )
  for (const fact of GlobalShortcutCapabilityFacts) {
    expect(fact.support.status).toBe("unsupported")
  }

  const callableTags = Array.from(GlobalShortcutRpcs.requests.keys())
  for (const method of expectedGlobalShortcutCapabilityFactMethods) {
    expect(callableTags).not.toContain(`GlobalShortcut.${method}`)
  }

  const nonCallableTags = GlobalShortcutSurface.schemaDocs
    .filter((doc) => !doc.callable)
    .map((doc) => doc.tag)
    .toSorted()
  expect(nonCallableTags).toEqual(
    expectedGlobalShortcutCapabilityFactMethods
      .map((method) => `GlobalShortcut.${method}`)
      .toSorted()
  )
})

test("GlobalShortcut service delegates through a substitutable GlobalShortcutClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          const supported = yield* shortcuts.isSupported()
          yield* shortcuts.register("CmdOrCtrl+K", windowHandle)
          const registered = yield* shortcuts.isRegistered("CmdOrCtrl+K")
          const pressed = yield* shortcuts.onPressed().pipe(Stream.take(1), Stream.runCollect)
          yield* shortcuts.unregister("CmdOrCtrl+K")
          yield* shortcuts.unregisterAll()

          return { pressed, registered, supported }
        }),
        makeGlobalShortcutServiceLayer(globalShortcutClient(calls))
      )

      expect(result.supported).toEqual(new GlobalShortcutSupportedResult({ supported: true }))
      expect(result.registered).toBe(true)
      expect(Array.from(result.pressed)).toEqual([
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: "window-1"
        })
      ])
      expect(calls).toEqual([
        "isSupported",
        "register:CmdOrCtrl+K:window-1",
        "isRegistered:CmdOrCtrl+K",
        "unregister:CmdOrCtrl+K",
        "unregisterAll"
      ])
    })
  ))

test("GlobalShortcut bridge client sends typed host envelopes and decodes pressed events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = globalShortcutExchange(requests, (request) => ({
        kind: "success",
        payload:
          request.method === "GlobalShortcut.isSupported"
            ? { supported: true }
            : request.method === "GlobalShortcut.isRegistered"
              ? { registered: true }
              : undefined
      }))

      const result = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          const supported = yield* shortcuts.isSupported()
          const registered = yield* shortcuts.isRegistered("CmdOrCtrl+K")
          const pressed = yield* shortcuts.onPressed().pipe(Stream.take(1), Stream.runCollect)
          const registerExit = yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
          const unregisterExit = yield* Effect.exit(shortcuts.unregister("CmdOrCtrl+K"))
          const unregisterAllExit = yield* Effect.exit(shortcuts.unregisterAll())

          return {
            pressed,
            registered,
            registerExit,
            supported,
            unregisterAllExit,
            unregisterExit
          }
        }),
        Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
      )

      expect(result.supported).toEqual(new GlobalShortcutSupportedResult({ supported: true }))
      expect(result.registered).toBe(true)
      expectExitFailure(result.registerExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(result.unregisterExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(result.unregisterAllExit, (error) => hasErrorTag(error, "Unsupported"))
      expect(Array.from(result.pressed)).toEqual([
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: "window-1"
        })
      ])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["GlobalShortcut.isSupported", null],
        ["GlobalShortcut.isRegistered", { accelerator: "CmdOrCtrl+K" }]
      ])
    })
  ))

test("GlobalShortcut bridge client rejects inconsistent isSupported output as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly label: string; readonly payload: unknown }> = [
        {
          label: "true with reason",
          payload: { supported: true, reason: "wayland-no-global-shortcut" }
        },
        { label: "false without reason", payload: { supported: false } }
      ]

      for (const { label, payload } of cases) {
        const exchange = globalShortcutExchange([], () => ({ kind: "success", payload }))
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const client = yield* GlobalShortcut
            return yield* Effect.exit(client.isSupported())
          }),
          Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(label).toBeDefined()
      }
    })
  ))

test("GlobalShortcut bridge client decodes valid isSupported outputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly payload: unknown
        readonly expected: GlobalShortcutSupportedResult
      }> = [
        {
          payload: { supported: true },
          expected: new GlobalShortcutSupportedResult({ supported: true })
        },
        {
          payload: { supported: false, reason: "wayland-no-global-shortcut" },
          expected: new GlobalShortcutSupportedResult({
            supported: false,
            reason: "wayland-no-global-shortcut"
          })
        }
      ]

      for (const { payload, expected } of cases) {
        const exchange = globalShortcutExchange([], () => ({ kind: "success", payload }))
        const result = yield* runScoped(
          Effect.gen(function* () {
            const shortcuts = yield* GlobalShortcut
            return yield* shortcuts.isSupported()
          }),
          Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
        )

        expect(result).toEqual(expected)
      }
    })
  ))

test("GlobalShortcut bridge client rejects invalid pressed event identifiers as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{ readonly label: string; readonly payload: unknown }> = [
        { label: "empty accelerator", payload: { accelerator: "", registrarWindowId: "window-1" } },
        { label: "empty windowId", payload: { accelerator: "CmdOrCtrl+K", registrarWindowId: "" } },
        {
          label: "nul accelerator",
          payload: { accelerator: "Cmd\u0000K", registrarWindowId: "window-1" }
        }
      ]

      for (const { label, payload } of cases) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
          subscribe: (method) =>
            method === "GlobalShortcut.Pressed"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000900,
                    traceId: "event-trace",
                    method,
                    payload
                  })
                )
              : Stream.empty
        }
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const shortcuts = yield* GlobalShortcut
            return yield* Effect.exit(shortcuts.onPressed().pipe(Stream.take(1), Stream.runCollect))
          }),
          Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
        )

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
        expect(label).toBeDefined()
      }
    })
  ))

test("GlobalShortcut bridge client rejects empty and NUL-bearing accelerators as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        GlobalShortcut.asEffect(),
        Layer.provide(
          GlobalShortcutLive,
          makeGlobalShortcutBridgeClientLayer(
            globalShortcutExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const registerEmptyExit = yield* Effect.exit(client.register("", windowHandle))
      const isRegisteredEmptyExit = yield* Effect.exit(client.isRegistered(""))
      const unregisterNulExit = yield* Effect.exit(client.unregister("Cmd\u0000K"))
      const registerNulExit = yield* Effect.exit(client.register("Cmd\u0000K", windowHandle))

      expectExitFailure(registerEmptyExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(isRegisteredEmptyExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(unregisterNulExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(registerNulExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("GlobalShortcut capability facts carry the protected nativeInvoke capability", () => {
  const factsByTag = new Map(GlobalShortcutCapabilityFacts.map((fact) => [fact.tag, fact] as const))

  for (const method of expectedGlobalShortcutCapabilityFactMethods) {
    const fact = factsByTag.get(`GlobalShortcut.${method}`)
    expect(fact).toBeDefined()
    expect(fact!.capability.kind).toBe("native.invoke")
    expect(fact!.support.status).toBe("unsupported")
  }
})

test("GlobalShortcut bindCommand invokes CommandRegistry for matching registrar events, keeps listening after command failure, and unregisters on scope close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const rows: AuditEvent[] = []
      const pressed = yield* Queue.unbounded<GlobalShortcutPressedEvent>()
      const invoked = yield* Deferred.make<void>()
      const resources = yield* makeResourceRegistry()
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-1"
      })
      const commands = yield* makeCommandRegistry(resources, permissions, {
        audit: memoryAudit(rows)
      })
      yield* permissions.declare(globalShortcutCommandCapability, { source: "test" })
      let handlerCalls = 0
      yield* registerTestCommand(commands, {
        id: "openProject",
        payload: Schema.Void,
        capability: globalShortcutCommandCapability,
        ownerScope: windowHandle.ownerScope,
        handler: () => {
          handlerCalls += 1
          if (handlerCalls === 1) {
            return Effect.fail("transient command failure")
          }

          return Effect.void.pipe(Effect.tap(() => Deferred.succeed(invoked, undefined)))
        }
      })

      const handle = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          return yield* shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle)
        }),
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer({
            ...globalShortcutClient(calls),
            onPressed: () => Stream.fromQueue(pressed)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )

      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+P",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: "window-2"
        })
      )
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Deferred.await(invoked)
      yield* Effect.sleep("10 millis")
      yield* resources.closeScope(windowHandle.ownerScope)
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Effect.sleep("10 millis")

      expect(handle).toMatchObject({
        kind: "global-shortcut-command",
        id: "global-shortcut-command:window-1:CmdOrCtrl+K",
        ownerScope: windowHandle.ownerScope,
        state: "registered"
      })
      expect(handlerCalls).toBe(2)
      expect(calls).toEqual(["register:CmdOrCtrl+K:window-1", "unregister:CmdOrCtrl+K"])
      expect(rows.map((row) => row.kind)).toContain("permission-granted")
      expect(rows.map((row) => row.kind)).toContain("command-invoked")
    })
  ))

test("command binding warning errors expose bounded attributes only", () => {
  const handlerFailure = new CommandRegistryHandlerFailureError({
    operation: "CommandRegistry.invoke",
    commandId: "openProject",
    cause: new Error("secret handler payload")
  })
  const nativeFailure = new HostProtocolNotFoundError({
    tag: "NotFound",
    resource: "global-shortcut",
    message: "secret native payload",
    operation: "GlobalShortcut.unregister",
    recoverable: false,
    cause: { stack: "secret stack" }
  })

  expect(handlerFailure.pipe(commandBindingWarningError)).toEqual({
    tag: "HandlerFailure",
    operation: "CommandRegistry.invoke",
    commandId: "openProject"
  })
  expect(commandBindingWarningError(nativeFailure)).toEqual({
    tag: "NotFound",
    operation: "GlobalShortcut.unregister",
    recoverable: false
  })
  expect(JSON.stringify(commandBindingWarningError(handlerFailure))).not.toContain("secret")
  expect(JSON.stringify(commandBindingWarningError(nativeFailure))).not.toContain("secret")
})

test("GlobalShortcut bindCommand invokes CommandRegistry for matching registrar events and unregisters on scope close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const rows: AuditEvent[] = []
      const pressed = yield* Queue.unbounded<GlobalShortcutPressedEvent>()
      const invoked = yield* Deferred.make<void>()
      const resources = yield* makeResourceRegistry()
      const permissions = yield* makePermissionRegistry({
        audit: memoryAudit(rows),
        traceId: () => "trace-1"
      })
      const commands = yield* makeCommandRegistry(resources, permissions, {
        audit: memoryAudit(rows)
      })
      yield* permissions.declare(globalShortcutCommandCapability, { source: "test" })
      let handlerCalls = 0
      yield* registerTestCommand(commands, {
        id: "openProject",
        payload: Schema.Void,
        capability: globalShortcutCommandCapability,
        ownerScope: windowHandle.ownerScope,
        handler: () =>
          Effect.sync(() => {
            handlerCalls += 1
          }).pipe(Effect.tap(() => Deferred.succeed(invoked, undefined)))
      })

      const handle = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          return yield* shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle)
        }),
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer({
            ...globalShortcutClient(calls),
            onPressed: () => Stream.fromQueue(pressed)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )

      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+P",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: "window-2"
        })
      )
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Deferred.await(invoked)
      yield* Effect.sleep("10 millis")
      yield* resources.closeScope(windowHandle.ownerScope)
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Effect.sleep("10 millis")

      expect(handle).toMatchObject({
        kind: "global-shortcut-command",
        id: "global-shortcut-command:window-1:CmdOrCtrl+K",
        ownerScope: windowHandle.ownerScope,
        state: "registered"
      })
      expect(handlerCalls).toBe(1)
      expect(calls).toEqual(["register:CmdOrCtrl+K:window-1", "unregister:CmdOrCtrl+K"])
      expect(rows.map((row) => row.kind)).toContain("permission-granted")
      expect(rows.map((row) => row.kind)).toContain("command-invoked")
    })
  ))

test("GlobalShortcut conflicts are typed Effect values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const bindingResources = yield* makeResourceRegistry()
      const bindingPermissions = yield* makePermissionRegistry()
      const bindingCommands = yield* makeCommandRegistry(bindingResources, bindingPermissions)
      const bindingCoreLayer = Layer.mergeAll(
        Layer.succeed(ResourceRegistry)(bindingResources),
        Layer.succeed(CommandRegistry)(bindingCommands)
      )
      const conflictExit = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          return yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
        }),
        makeGlobalShortcutServiceLayer({
          ...globalShortcutClient([]),
          register: (accelerator) =>
            Effect.fail(makeGlobalShortcutAlreadyRegisteredError(accelerator))
        })
      )
      const bindConflictExit = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          return yield* Effect.exit(
            shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle)
          )
        }),
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer({
            ...globalShortcutClient([]),
            register: (accelerator) =>
              Effect.fail(makeGlobalShortcutAlreadyRegisteredError(accelerator))
          }),
          bindingCoreLayer
        )
      )
      expectExitFailure(conflictExit, (error) => hasErrorTag(error, "AlreadyExists"))
      expectExitFailure(bindConflictExit, (error) => hasErrorTag(error, "AlreadyExists"))
    })
  ))

test("GlobalShortcut service propagates unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "host-adapter-unimplemented",
        message: "unsupported GlobalShortcut.register",
        operation: "GlobalShortcut.register",
        recoverable: false
      })
      const unsupportedClient: GlobalShortcutClientApi = {
        ...globalShortcutClient([]),
        register: () => Effect.fail(unsupported)
      }
      const hostFailureClient: GlobalShortcutClientApi = {
        ...globalShortcutClient([]),
        register: () => Effect.fail(makeHostProtocolHostUnavailableError("GlobalShortcut.register"))
      }

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          return yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
        }),
        makeGlobalShortcutServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          return yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
        }),
        makeGlobalShortcutServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("Linux GlobalShortcut client reports missing host adapters as typed unsupported values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const shortcuts = yield* GlobalShortcut
          const supported = yield* shortcuts.isSupported()
          const registerExit = yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
          const x11Supported = yield* makeLinuxGlobalShortcutClient("x11").isSupported()
          return { registerExit, supported, x11Supported }
        }),
        makeGlobalShortcutServiceLayer(makeLinuxGlobalShortcutClient("wayland"))
      )

      expect(result.supported).toEqual(
        new GlobalShortcutSupportedResult({
          supported: false,
          reason: "wayland-no-global-shortcut"
        })
      )
      expect(result.x11Supported).toEqual(
        new GlobalShortcutSupportedResult({
          supported: false,
          reason: "host-adapter-unimplemented"
        })
      )
      expectExitFailure(
        result.registerExit,
        (error) =>
          hasErrorTag(error, "Unsupported") &&
          typeof error === "object" &&
          error !== null &&
          "reason" in error &&
          error.reason === "host-adapter-unimplemented"
      )
    })
  ))

test("WindowRpcs declares only callable Window methods", () => {
  const supportedWindowMethods = Array.from(WindowRpcs.requests)
    .filter(([, rpc]) => rpcSupport(rpc).status !== "unsupported")
    .map(([method]) => method)

  expect([...WindowMethodNames]).toEqual(expectedWindowMethods)
  expect(Array.from(WindowRpcs.requests.keys())).toEqual([
    "Window.create",
    "Window.close",
    "Window.destroy",
    "Window.show",
    "Window.hide",
    "Window.focus",
    "Window.getCurrent",
    "Window.getById",
    "Window.list",
    "Window.getParent",
    "Window.getChildren",
    WINDOW_SUBSCRIBE_EVENTS_METHOD,
    "Window.getBounds",
    "Window.setBounds",
    "Window.setBoundsOnDisplay",
    "Window.center",
    "Window.centerOnDisplay",
    "Window.setTitle",
    "Window.setResizable",
    "Window.setDecorations",
    "Window.setTrafficLights",
    "Window.setVibrancy",
    "Window.clearVibrancy",
    "Window.setShadow",
    "Window.setTitleBarStyle",
    "Window.setTitleBarTransparent",
    "Window.setTransparent",
    "Window.setAlwaysOnTop",
    "Window.setSkipTaskbar",
    "Window.setProgress",
    "Window.requestAttention",
    "Window.cancelAttention",
    "Window.minimize",
    "Window.maximize",
    "Window.restore",
    "Window.setFullscreen",
    "Window.setSimpleFullscreen",
    "Window.getState"
  ])
  expect(Array.from(WindowSupportedRpcs.requests.keys())).toEqual(supportedWindowMethods)
  const assertSupportedWindowClient = (
    client: DesktopRpcClient<RpcGroup.Rpcs<typeof WindowSupportedRpcs>>
  ): void => {
    void client["Window.create"]
    void client["Window.close"]
    void client["Window.destroy"]
    void client["Window.show"]
    void client["Window.hide"]
    void client["Window.focus"]
    void client["Window.getCurrent"]
    void client["Window.getById"]
    void client["Window.list"]
    void client["Window.getParent"]
    void client["Window.getChildren"]
    void client[WINDOW_SUBSCRIBE_EVENTS_METHOD]
    void client["Window.getBounds"]
    void client["Window.setBounds"]
    void client["Window.setBoundsOnDisplay"]
    void client["Window.center"]
    void client["Window.centerOnDisplay"]
    void client["Window.setTitle"]
    void client["Window.setResizable"]
    void client["Window.setDecorations"]
    void client["Window.setTrafficLights"]
    void client["Window.setVibrancy"]
    void client["Window.clearVibrancy"]
    void client["Window.setShadow"]
    void client["Window.setTitleBarStyle"]
    void client["Window.setTitleBarTransparent"]
    void client["Window.setTransparent"]
    void client["Window.setAlwaysOnTop"]
    void client["Window.setSkipTaskbar"]
    void client["Window.setProgress"]
    void client["Window.requestAttention"]
    void client["Window.cancelAttention"]
    void client["Window.minimize"]
    void client["Window.maximize"]
    void client["Window.restore"]
    void client["Window.setFullscreen"]
    void client["Window.setSimpleFullscreen"]
    void client["Window.getState"]
  }
  void assertSupportedWindowClient
  expect(supportedWindowMethods).toEqual([
    "Window.create",
    "Window.close",
    "Window.destroy",
    "Window.show",
    "Window.hide",
    "Window.focus",
    "Window.getCurrent",
    "Window.getById",
    "Window.list",
    "Window.getParent",
    "Window.getChildren",
    WINDOW_SUBSCRIBE_EVENTS_METHOD,
    "Window.getBounds",
    "Window.setBounds",
    "Window.setBoundsOnDisplay",
    "Window.center",
    "Window.centerOnDisplay",
    "Window.setTitle",
    "Window.setResizable",
    "Window.setDecorations",
    "Window.setTrafficLights",
    "Window.setVibrancy",
    "Window.clearVibrancy",
    "Window.setShadow",
    "Window.setTitleBarStyle",
    "Window.setTitleBarTransparent",
    "Window.setTransparent",
    "Window.setAlwaysOnTop",
    "Window.setSkipTaskbar",
    "Window.setProgress",
    "Window.requestAttention",
    "Window.cancelAttention",
    "Window.minimize",
    "Window.maximize",
    "Window.restore",
    "Window.setFullscreen",
    "Window.setSimpleFullscreen",
    "Window.getState"
  ])
  expect(WindowRpcs.requests.has("Window.show")).toBe(true)
  expect(Object.keys(WindowRpcEvents)).toEqual(["Event"])
  expect("spec" in WindowRpcs).toBe(false)
  expect("events" in WindowRpcs).toBe(false)
})

test("WindowPersistence dependency RPCs declare native capabilities", () => {
  const windowDocs = new Map(WindowSurface.schemaDocs.map((doc) => [doc.tag, doc.capability]))
  const screenDocs = new Map(ScreenSurface.schemaDocs.map((doc) => [doc.tag, doc.capability]))
  const expectCapability = (
    docs: ReadonlyMap<string, Option.Option<unknown>>,
    tag: string,
    capability: NormalizedCapability
  ): void => {
    const documentedCapability = docs.get(tag)
    if (documentedCapability === undefined) {
      throw new Error(`missing schema doc for ${tag}`)
    }
    expect(Option.getOrThrow(documentedCapability)).toEqual(capability)
  }

  expectCapability(
    windowDocs,
    WINDOW_GET_BY_ID_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["getById"] })
  )
  expectCapability(
    windowDocs,
    WINDOW_GET_BOUNDS_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["getBounds"] })
  )
  expectCapability(
    windowDocs,
    WINDOW_GET_STATE_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["getState"] })
  )
  expectCapability(
    windowDocs,
    WINDOW_SET_BOUNDS_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["setBounds"] })
  )
  expectCapability(
    windowDocs,
    WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["setBoundsOnDisplay"] })
  )
  expectCapability(
    windowDocs,
    WINDOW_SET_FULLSCREEN_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["setFullscreen"] })
  )
  expectCapability(
    windowDocs,
    WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
    P.nativeInvoke({ primitive: "Window", methods: ["setSimpleFullscreen"] })
  )
  expectCapability(
    screenDocs,
    "Screen.getDisplays",
    P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] })
  )
})

test("Window service delegates through a substitutable WindowClient port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const client: WindowClientApi = {
        create: (input) =>
          Effect.sync(() => {
            calls.push(`create:${input?.title ?? ""}`)
            return windowHandle
          }),
        close: () => recordVoid(calls, "close"),
        destroy: () => recordVoid(calls, "destroy"),
        show: () => recordVoid(calls, "show"),
        hide: () => recordVoid(calls, "hide"),
        focus: () => recordVoid(calls, "focus"),
        getCurrent: () =>
          Effect.sync(() => {
            calls.push("getCurrent")
            return windowHandle
          }),
        getById: (windowId) =>
          Effect.sync(() => {
            calls.push(`getById:${windowId}`)
            return windowHandle
          }),
        list: () =>
          Effect.sync(() => {
            calls.push("list")
            return [windowHandle]
          }),
        getParent: () =>
          Effect.sync(() => {
            calls.push("getParent")
            return undefined
          }),
        getChildren: () =>
          Effect.sync(() => {
            calls.push("getChildren")
            return []
          }),
        getBounds: () =>
          Effect.sync(() => {
            calls.push("getBounds")
            return new WindowBounds({ x: 10, y: 20, width: 640, height: 480 })
          }),
        setBounds: (_window, bounds) =>
          recordVoid(calls, `setBounds:${bounds.width}x${bounds.height}`).pipe(
            Effect.as(new WindowBounds(bounds))
          ),
        setBoundsOnDisplay: (_window, displayId, bounds) =>
          recordVoid(
            calls,
            `setBoundsOnDisplay:${displayId}:${bounds.width}x${bounds.height}`
          ).pipe(Effect.as(new WindowBounds(bounds))),
        center: () =>
          recordVoid(calls, "center").pipe(
            Effect.as(new WindowBounds({ x: 50, y: 60, width: 640, height: 480 }))
          ),
        centerOnDisplay: (_window, displayId) =>
          recordVoid(calls, `centerOnDisplay:${displayId}`).pipe(
            Effect.as(new WindowBounds({ x: 70, y: 80, width: 640, height: 480 }))
          ),
        setTitle: (_window, title) => recordVoid(calls, `setTitle:${title}`),
        setResizable: (_window, resizable) => recordVoid(calls, `setResizable:${resizable}`),
        setDecorations: (_window, decorations) =>
          recordVoid(calls, `setDecorations:${decorations}`),
        setTrafficLights: (_window, trafficLights) =>
          recordVoid(calls, `setTrafficLights:${trafficLights.x},${trafficLights.y}`),
        setVibrancy: (_window, material) => recordVoid(calls, `setVibrancy:${material}`),
        clearVibrancy: () => recordVoid(calls, "clearVibrancy"),
        setShadow: (_window, hasShadow) => recordVoid(calls, `setShadow:${hasShadow}`),
        setTitleBarStyle: (_window, titleBarStyle) =>
          recordVoid(calls, `setTitleBarStyle:${titleBarStyle}`),
        setTitleBarTransparent: (_window, titleBarTransparent) =>
          recordVoid(calls, `setTitleBarTransparent:${titleBarTransparent}`),
        setTransparent: (_window, transparent) =>
          recordVoid(calls, `setTransparent:${transparent}`),
        setAlwaysOnTop: (_window, alwaysOnTop) =>
          recordVoid(calls, `setAlwaysOnTop:${alwaysOnTop}`),
        setSkipTaskbar: (_window, skipTaskbar) =>
          recordVoid(calls, `setSkipTaskbar:${skipTaskbar}`),
        setProgress: (_window, input) => recordVoid(calls, `setProgress:${input.progress ?? ""}`),
        requestAttention: (_window, requestType) =>
          recordVoid(calls, `requestAttention:${requestType}`),
        cancelAttention: () => recordVoid(calls, "cancelAttention"),
        minimize: () =>
          recordVoid(calls, "minimize").pipe(
            Effect.as(
              new WindowState({
                minimized: true,
                maximized: false,
                fullscreen: false,
                simpleFullscreen: false
              })
            )
          ),
        maximize: () =>
          recordVoid(calls, "maximize").pipe(
            Effect.as(
              new WindowState({
                minimized: false,
                maximized: true,
                fullscreen: false,
                simpleFullscreen: false
              })
            )
          ),
        restore: () => recordVoid(calls, "restore").pipe(Effect.as(defaultWindowState())),
        setFullscreen: (_window, fullscreen) =>
          recordVoid(calls, `setFullscreen:${fullscreen}`).pipe(
            Effect.as(
              new WindowState({
                minimized: false,
                maximized: true,
                fullscreen,
                simpleFullscreen: false
              })
            )
          ),
        setSimpleFullscreen: (_window, simpleFullscreen) =>
          recordVoid(calls, `setSimpleFullscreen:${simpleFullscreen}`).pipe(
            Effect.as(
              new WindowState({
                minimized: false,
                maximized: true,
                fullscreen: true,
                simpleFullscreen
              })
            )
          ),
        getState: () =>
          Effect.sync(() => {
            calls.push("getState")
            return new WindowState({
              minimized: false,
              maximized: true,
              fullscreen: true,
              simpleFullscreen: true
            })
          }),
        events: () =>
          Stream.make(
            new WindowRegistryEvent({
              type: "window-registry-event",
              phase: "opened",
              windowId: "window-1",
              window: windowHandle,
              terminal: false
            })
          )
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({ title: "Main" })
          yield* window.show(created)
          yield* window.hide(created)
          yield* window.focus(created)
          const current = yield* window.getCurrent()
          const byId = yield* window.getById(String(created.id))
          const windows = yield* window.list()
          const parent = yield* window.getParent(created)
          const children = yield* window.getChildren(created)
          const bounds = yield* window.getBounds(created)
          yield* window.setBounds(
            created,
            new WindowBounds({ x: bounds.x, y: bounds.y, width: 800, height: 600 })
          )
          yield* window.setBoundsOnDisplay(
            created,
            "display-1",
            new WindowBounds({ x: 15, y: 25, width: 700, height: 500 })
          )
          yield* window.center(created)
          yield* window.centerOnDisplay(created, "display-1")
          yield* window.setTitle(created, "Renamed")
          yield* window.setResizable(created, false)
          yield* window.setDecorations(created, true)
          yield* window.setTrafficLights(created, { x: 12, y: 13 })
          yield* window.setVibrancy(created, "windowBackground")
          yield* window.clearVibrancy(created)
          yield* window.setShadow(created, false)
          yield* window.setTitleBarStyle(created, "hiddenInset")
          yield* window.setTitleBarTransparent(created, true)
          yield* window.setTransparent(created, true)
          yield* window.setAlwaysOnTop(created, true)
          yield* window.setSkipTaskbar(created, true)
          yield* window.setProgress(created, { state: "normal", progress: 42 })
          yield* window.requestAttention(created, "critical")
          yield* window.cancelAttention(created)
          yield* window.minimize(created)
          yield* window.maximize(created)
          yield* window.setFullscreen(created, true)
          yield* window.setSimpleFullscreen(created, true)
          const state = yield* window.getState(created)
          const event = yield* window.events().pipe(Stream.take(1), Stream.runHead)
          yield* window.restore(created)
          yield* window.destroy(created)
          yield* window.close(created)

          return { bounds, byId, children, created, current, event, parent, state, windows }
        }),
        makeWindowServiceLayer(client)
      )

      expect(result.created).toEqual(windowHandle)
      expect(result.current).toEqual(windowHandle)
      expect(result.byId).toEqual(windowHandle)
      expect(result.windows).toEqual([windowHandle])
      expect(result.parent).toBeUndefined()
      expect(result.children).toEqual([])
      expect(result.bounds).toEqual(new WindowBounds({ x: 10, y: 20, width: 640, height: 480 }))
      expect(result.state).toEqual(
        new WindowState({
          minimized: false,
          maximized: true,
          fullscreen: true,
          simpleFullscreen: true
        })
      )
      const serviceEvent = Option.getOrThrow(result.event)
      expect(serviceEvent.type).toBe("window-registry-event")
      if (serviceEvent.type !== "window-registry-event") {
        throw new Error("expected window registry event")
      }
      expect(serviceEvent.phase).toBe("opened")
      expect(calls).toEqual([
        "create:Main",
        "show",
        "hide",
        "focus",
        "getCurrent",
        "getById:window-1",
        "list",
        "getParent",
        "getChildren",
        "getBounds",
        "setBounds:800x600",
        "setBoundsOnDisplay:display-1:700x500",
        "center",
        "centerOnDisplay:display-1",
        "setTitle:Renamed",
        "setResizable:false",
        "setDecorations:true",
        "setTrafficLights:12,13",
        "setVibrancy:windowBackground",
        "clearVibrancy",
        "setShadow:false",
        "setTitleBarStyle:hiddenInset",
        "setTitleBarTransparent:true",
        "setTransparent:true",
        "setAlwaysOnTop:true",
        "setSkipTaskbar:true",
        "setProgress:42",
        "requestAttention:critical",
        "cancelAttention",
        "minimize",
        "maximize",
        "setFullscreen:true",
        "setSimpleFullscreen:true",
        "getState",
        "restore",
        "destroy",
        "close"
      ])
    })
  ))

test("Window service can be composed from a separately provided WindowClient", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const client: WindowClientApi = {
        ...noopWindowClient,
        create: (input) =>
          Effect.sync(() => {
            calls.push(`create:${Object.keys(input).length}`)
            return windowHandle
          })
      }

      const created = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          return yield* window.create()
        }),
        Layer.provide(WindowLive, Layer.succeed(WindowClient)(client))
      )

      expect(created.id).toBe(resourceId("window-1"))
      expect(calls).toEqual(["create:0"])
    })
  ))

test("host WindowClient adapter opens and closes through host envelopes with registry lifetime", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const rpcExchange = makeWindowRpcExchange(windowExchange(requests), registry, {
        nextRequestId: nextId([
          "create-request",
          "show-request",
          "hide-request",
          "focus-request",
          "get-bounds-request",
          "set-bounds-request",
          "set-bounds-on-display-request",
          "center-request",
          "center-on-display-request",
          "set-title-request",
          "set-resizable-request",
          "set-decorations-request",
          "set-traffic-lights-request",
          "set-vibrancy-request",
          "clear-vibrancy-request",
          "set-shadow-request",
          "set-title-bar-style-request",
          "set-title-bar-transparent-request",
          "set-transparent-request",
          "set-always-on-top-request",
          "set-skip-taskbar-request",
          "set-progress-request",
          "request-attention-request",
          "cancel-attention-request",
          "minimize-request",
          "maximize-request",
          "set-fullscreen-request",
          "set-simple-fullscreen-request",
          "get-state-request",
          "restore-request",
          "destroy-request"
        ]),
        nextTraceId: nextId([
          "create-trace",
          "show-trace",
          "hide-trace",
          "focus-trace",
          "get-bounds-trace",
          "set-bounds-trace",
          "set-bounds-on-display-trace",
          "center-trace",
          "center-on-display-trace",
          "set-title-trace",
          "set-resizable-trace",
          "set-decorations-trace",
          "set-traffic-lights-trace",
          "set-vibrancy-trace",
          "clear-vibrancy-trace",
          "set-shadow-trace",
          "set-title-bar-style-trace",
          "set-title-bar-transparent-trace",
          "set-transparent-trace",
          "set-always-on-top-trace",
          "set-skip-taskbar-trace",
          "set-progress-trace",
          "request-attention-trace",
          "cancel-attention-trace",
          "minimize-trace",
          "maximize-trace",
          "set-fullscreen-trace",
          "set-simple-fullscreen-trace",
          "get-state-trace",
          "restore-trace",
          "destroy-trace"
        ]),
        now: nextNumber([
          1_710_000_000_000, 1_710_000_000_001, 1_710_000_000_002, 1_710_000_000_003,
          1_710_000_000_004, 1_710_000_000_005, 1_710_000_000_006, 1_710_000_000_007,
          1_710_000_000_008, 1_710_000_000_009, 1_710_000_000_010, 1_710_000_000_011,
          1_710_000_000_012, 1_710_000_000_013, 1_710_000_000_014, 1_710_000_000_015,
          1_710_000_000_016, 1_710_000_000_017, 1_710_000_000_018, 1_710_000_000_019,
          1_710_000_000_020, 1_710_000_000_021, 1_710_000_000_022, 1_710_000_000_023,
          1_710_000_000_024, 1_710_000_000_025, 1_710_000_000_026, 1_710_000_000_027,
          1_710_000_000_028, 1_710_000_000_029, 1_710_000_000_030
        ])
      })
      const program = runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({
            title: "Main",
            width: 320,
            height: 240,
            titleBarStyle: "hiddenInset",
            vibrancy: "windowBackground",
            trafficLights: { x: 12, y: 13 }
          })
          const duringLifetime = yield* registry.list()
          yield* window.show(created)
          yield* window.hide(created)
          yield* window.focus(created)
          const bounds = yield* window.getBounds(created)
          yield* window.setBounds(
            created,
            new WindowBounds({ x: 30, y: 40, width: bounds.width, height: bounds.height })
          )
          yield* window.setBoundsOnDisplay(
            created,
            "display-1",
            new WindowBounds({ x: 15, y: 25, width: 320, height: 240 })
          )
          yield* window.center(created)
          yield* window.centerOnDisplay(created, "display-1")
          yield* window.setTitle(created, "Renamed")
          yield* window.setResizable(created, false)
          yield* window.setDecorations(created, true)
          yield* window.setTrafficLights(created, { x: 12, y: 13 })
          yield* window.setVibrancy(created, "windowBackground")
          yield* window.clearVibrancy(created)
          yield* window.setShadow(created, false)
          yield* window.setTitleBarStyle(created, "hiddenInset")
          yield* window.setTitleBarTransparent(created, true)
          yield* window.setTransparent(created, true)
          yield* window.setAlwaysOnTop(created, true)
          yield* window.setSkipTaskbar(created, true)
          yield* window.setProgress(created, {
            state: "normal",
            progress: 42,
            window: handleFor("forged-window")
          } as Parameters<typeof window.setProgress>[1])
          yield* window.requestAttention(created, "critical")
          yield* window.cancelAttention(created)
          yield* window.minimize(created)
          yield* window.maximize(created)
          yield* window.setFullscreen(created, true)
          yield* window.setSimpleFullscreen(created, true)
          const state = yield* window.getState(created)
          yield* window.restore(created)
          yield* window.close(created)
          const afterClose = yield* registry.list()

          return { created, duringLifetime, afterClose, state }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      const result = yield* program

      expect(result.created).toMatchObject({
        kind: "window",
        id: "host-window-1",
        generation: 0,
        ownerScope: "window:host-window-1",
        state: "open"
      })
      expect(result.duringLifetime.entries.map((entry) => String(entry.handle.id))).toEqual([
        "host-window-1"
      ])
      expect(result.afterClose.entries).toEqual([])
      expect(result.state).toEqual(
        new WindowState({
          minimized: false,
          maximized: true,
          fullscreen: true,
          simpleFullscreen: true
        })
      )
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [
          WINDOW_CREATE_METHOD,
          {
            title: "Main",
            width: 320,
            height: 240,
            titleBarStyle: "hiddenInset",
            vibrancy: "windowBackground",
            trafficLights: { x: 12, y: 13 }
          }
        ],
        [
          WINDOW_SHOW_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_HIDE_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_FOCUS_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_GET_BOUNDS_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_SET_BOUNDS_METHOD,
          {
            windowId: "host-window-1",
            bounds: {
              x: 30,
              y: 40,
              width: 640,
              height: 480
            }
          }
        ],
        [
          WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
          {
            windowId: "host-window-1",
            displayId: "display-1",
            bounds: {
              x: 15,
              y: 25,
              width: 320,
              height: 240
            }
          }
        ],
        [
          WINDOW_CENTER_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_CENTER_ON_DISPLAY_METHOD,
          {
            windowId: "host-window-1",
            displayId: "display-1"
          }
        ],
        [
          WINDOW_SET_TITLE_METHOD,
          {
            windowId: "host-window-1",
            title: "Renamed"
          }
        ],
        [
          WINDOW_SET_RESIZABLE_METHOD,
          {
            windowId: "host-window-1",
            resizable: false
          }
        ],
        [
          WINDOW_SET_DECORATIONS_METHOD,
          {
            windowId: "host-window-1",
            decorations: true
          }
        ],
        [
          WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
          {
            windowId: "host-window-1",
            trafficLights: { x: 12, y: 13 }
          }
        ],
        [
          WINDOW_SET_VIBRANCY_METHOD,
          {
            windowId: "host-window-1",
            material: "windowBackground"
          }
        ],
        [
          WINDOW_CLEAR_VIBRANCY_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_SET_SHADOW_METHOD,
          {
            windowId: "host-window-1",
            hasShadow: false
          }
        ],
        [
          WINDOW_SET_TITLE_BAR_STYLE_METHOD,
          {
            windowId: "host-window-1",
            titleBarStyle: "hiddenInset"
          }
        ],
        [
          WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
          {
            windowId: "host-window-1",
            titleBarTransparent: true
          }
        ],
        [
          WINDOW_SET_TRANSPARENT_METHOD,
          {
            windowId: "host-window-1",
            transparent: true
          }
        ],
        [
          WINDOW_SET_ALWAYS_ON_TOP_METHOD,
          {
            windowId: "host-window-1",
            alwaysOnTop: true
          }
        ],
        [
          WINDOW_SET_SKIP_TASKBAR_METHOD,
          {
            windowId: "host-window-1",
            skipTaskbar: true
          }
        ],
        [
          WINDOW_SET_PROGRESS_METHOD,
          {
            windowId: "host-window-1",
            state: "normal",
            progress: 42
          }
        ],
        [
          WINDOW_REQUEST_ATTENTION_METHOD,
          {
            windowId: "host-window-1",
            requestType: "critical"
          }
        ],
        [
          WINDOW_CANCEL_ATTENTION_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_MINIMIZE_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_MAXIMIZE_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_SET_FULLSCREEN_METHOD,
          {
            windowId: "host-window-1",
            fullscreen: true
          }
        ],
        [
          WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
          {
            windowId: "host-window-1",
            simpleFullscreen: true
          }
        ],
        [
          WINDOW_GET_STATE_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_RESTORE_METHOD,
          {
            windowId: "host-window-1"
          }
        ],
        [
          WINDOW_DESTROY_METHOD,
          {
            windowId: "host-window-1"
          }
        ]
      ])
    })
  ))

test("host WindowClient adapter exposes explicit destroy through host destroy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const rpcExchange = makeWindowRpcExchange(windowExchange(requests), registry, {
        nextRequestId: nextId(["create-request", "destroy-request"]),
        nextTraceId: nextId(["create-trace", "destroy-trace"]),
        now: nextNumber([1_710_000_000_100, 1_710_000_000_101])
      })

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({ title: "Destroy" })
          yield* window.destroy(created)
          const afterDestroy = yield* registry.list()
          return { afterDestroy, created }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      expect(String(result.created.id)).toBe("host-window-1")
      expect(result.afterDestroy.entries).toEqual([])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Destroy" }],
        [WINDOW_DESTROY_METHOD, { windowId: "host-window-1" }]
      ])
    })
  ))

test("host WindowClient adapter creates owned child windows and closes children with parent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const createWindowIds = nextId(["host-parent", "host-child"])
      const hostExchange: HostWindowExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed(
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: request.id,
              timestamp: request.timestamp + 1,
              traceId: request.traceId,
              ...(request.method === WINDOW_CREATE_METHOD
                ? { payload: { windowId: createWindowIds() } }
                : {})
            })
          )
        }
      }
      const rpcExchange = makeWindowRpcExchange(hostExchange, registry, {
        nextRequestId: nextId([
          "create-parent-request",
          "create-child-request",
          "destroy-child-request",
          "destroy-parent-request"
        ]),
        nextTraceId: nextId([
          "create-parent-trace",
          "create-child-trace",
          "destroy-child-trace",
          "destroy-parent-trace"
        ]),
        now: nextNumber([
          1_710_000_001_000, 1_710_000_001_001, 1_710_000_001_002, 1_710_000_001_003
        ])
      })

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const parent = yield* window.create({ title: "Parent" })
          const child = yield* window.create({ title: "Child", parent })
          const duringLifetime = yield* registry.list()
          yield* window.close(parent)
          const afterClose = yield* registry.list()

          return { afterClose, child, duringLifetime, parent }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      expect(String(result.parent.id)).toBe("host-parent")
      expect(String(result.child.id)).toBe("host-child")
      expect(result.duringLifetime.entries.map((entry) => String(entry.handle.id)).sort()).toEqual([
        "host-child",
        "host-parent"
      ])
      expect(result.afterClose.entries).toEqual([])
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Parent" }],
        [WINDOW_CREATE_METHOD, { title: "Child", parentWindowId: "host-parent" }],
        [WINDOW_DESTROY_METHOD, { windowId: "host-child" }],
        [WINDOW_DESTROY_METHOD, { windowId: "host-parent" }]
      ])
    })
  ))

test("host WindowClient adapter looks up current, id, list, and removes closed windows", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeResourceRegistry()
          const router = yield* makeAppEventRouter()
          const createWindowIds = nextId(["host-parent", "host-child"])
          const hostExchange: HostWindowExchange = {
            request: (request) => {
              requests.push(request)
              const currentWindowId =
                request.method === "Window.getCurrent" &&
                requests.some((sent) => sent.method === WINDOW_FOCUS_METHOD)
                  ? "host-child"
                  : "host-parent"
              const requestedWindowId =
                typeof request.payload === "object" &&
                request.payload !== null &&
                "windowId" in request.payload &&
                typeof request.payload.windowId === "string"
                  ? request.payload.windowId
                  : "host-parent"
              return Effect.succeed(
                new HostProtocolResponseEnvelope({
                  kind: "response",
                  id: request.id,
                  timestamp: request.timestamp + 1,
                  traceId: request.traceId,
                  ...(request.method === WINDOW_CREATE_METHOD
                    ? { payload: { windowId: createWindowIds() } }
                    : request.method === "Window.getCurrent"
                      ? { payload: { windowId: currentWindowId } }
                      : request.method === "Window.getById"
                        ? { payload: { windowId: requestedWindowId } }
                        : request.method === "Window.list"
                          ? {
                              payload: {
                                windows: [{ windowId: "host-parent" }, { windowId: "host-child" }]
                              }
                            }
                          : request.method === WINDOW_GET_PARENT_METHOD
                            ? { payload: { parentWindowId: "host-parent" } }
                            : request.method === WINDOW_GET_CHILDREN_METHOD
                              ? { payload: { windows: [{ windowId: "host-child" }] } }
                              : {})
                })
              )
            }
          }
          const rpcExchange = makeWindowRpcExchange(
            hostExchange,
            registry,
            {
              nextRequestId: nextId([
                "create-parent-request",
                "get-current-parent-request",
                "create-child-request",
                "list-request",
                "get-parent-request",
                "get-children-request",
                "get-by-id-request",
                "focus-child-request",
                "get-current-child-request",
                "close-child-request",
                "get-by-id-closed-request",
                "close-parent-request"
              ]),
              nextTraceId: nextId([
                "create-parent-trace",
                "get-current-parent-trace",
                "create-child-trace",
                "list-trace",
                "get-parent-trace",
                "get-children-trace",
                "get-by-id-trace",
                "focus-child-trace",
                "get-current-child-trace",
                "close-child-trace",
                "get-by-id-closed-trace",
                "close-parent-trace"
              ]),
              now: nextNumber([
                1_710_000_002_000, 1_710_000_002_001, 1_710_000_002_002, 1_710_000_002_003,
                1_710_000_002_004, 1_710_000_002_005, 1_710_000_002_006, 1_710_000_002_007,
                1_710_000_002_008, 1_710_000_002_009, 1_710_000_002_010, 1_710_000_002_011
              ])
            },
            router
          )
          return yield* runScoped(
            Effect.gen(function* () {
              const window = yield* Window
              const parent = yield* window.create({ title: "Parent" })
              const currentParent = yield* window.getCurrent()
              const child = yield* window.create({ title: "Child", parent })
              const listed = yield* window.list()
              const childParent = yield* window.getParent(child)
              const parentChildren = yield* window.getChildren(parent)
              const parentById = yield* window.getById(String(parent.id))
              yield* window.focus(child)
              const currentChild = yield* window.getCurrent()
              yield* window.close(child)
              const closedChildExit = yield* Effect.exit(window.getById(String(child.id)))
              yield* window.close(parent)

              return {
                child,
                childParent,
                closedChildExit,
                currentChild,
                currentParent,
                listed,
                parent,
                parentChildren,
                parentById
              }
            }),
            Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
          )
        })
      )

      expect(result.currentParent.id).toBe(result.parent.id)
      expect(result.childParent?.id).toBe(result.parent.id)
      expect(result.parentChildren.map((window) => String(window.id))).toEqual(["host-child"])
      expect(result.parentById.id).toBe(result.parent.id)
      expect(result.currentChild.id).toBe(result.child.id)
      expect(result.listed.map((window) => String(window.id)).sort()).toEqual([
        "host-child",
        "host-parent"
      ])
      expectExitFailure(
        result.closedChildExit,
        (error) =>
          Schema.is(HostProtocolNotFoundError)(error) && error.operation === "Window.getById"
      )
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Parent" }],
        ["Window.getCurrent", undefined],
        [WINDOW_CREATE_METHOD, { title: "Child", parentWindowId: "host-parent" }],
        ["Window.list", undefined],
        [WINDOW_GET_PARENT_METHOD, { windowId: "host-child" }],
        [WINDOW_GET_CHILDREN_METHOD, { windowId: "host-parent" }],
        ["Window.getById", { windowId: "host-parent" }],
        [WINDOW_FOCUS_METHOD, { windowId: "host-child" }],
        ["Window.getCurrent", undefined],
        [WINDOW_DESTROY_METHOD, { windowId: "host-child" }],
        ["Window.getById", { windowId: "host-child" }],
        [WINDOW_DESTROY_METHOD, { windowId: "host-parent" }]
      ])
    })
  ))

test("Window.events streams renderer-visible lifecycle events from the app router", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeResourceRegistry()
          const router = yield* makeAppEventRouter()
          const rpcExchange = makeWindowRpcExchange(windowExchange([]), registry, {}, router)

          return yield* runScoped(
            Effect.gen(function* () {
              const window = yield* Window
              const eventsFiber = yield* window
                .events()
                .pipe(
                  Stream.take(5),
                  Stream.runCollect,
                  Effect.forkChild({ startImmediately: true })
                )
              yield* Effect.sleep("10 millis")
              const created = yield* window.create({ title: "Events" })
              yield* window.show(created)
              yield* window.hide(created)
              yield* window.focus(created)
              yield* window.close(created)

              return yield* Fiber.join(eventsFiber)
            }),
            Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
          )
        })
      )

      expect(
        Array.from(result).map((event) => {
          if (event.type !== "window-registry-event") {
            throw new Error("expected window registry event")
          }
          return [event.phase, event.windowId, event.terminal]
        })
      ).toEqual([
        ["opened", "host-window-1", false],
        ["shown", "host-window-1", false],
        ["hidden", "host-window-1", false],
        ["focused", "host-window-1", false],
        ["closed", "host-window-1", true]
      ])
    })
  ))

test("Window.events registers host-originated opened events in ResourceRegistry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_SUBSCRIBE_EVENTS_METHOD
            ? Effect.succeed({ kind: "success", payload: { subscribed: true } })
            : Effect.die(`unexpected request: ${request.method}`),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_674,
                  traceId: "host-window-close-requested-unknown-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "closeRequested",
                    windowId: "host-close-requested-window",
                    window: {
                      kind: "window",
                      id: "host-close-requested-window",
                      generation: 0,
                      ownerScope: "window:host-close-requested-window",
                      state: "open"
                    },
                    terminal: false
                  }
                }),
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_600,
                  traceId: "host-window-opened-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "opened",
                    windowId: "host-opened-window",
                    terminal: false
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const event = yield* window.events().pipe(
            Stream.filter(
              (event) => event.type === "window-registry-event" && event.phase === "opened"
            ),
            Stream.take(1),
            Stream.runHead
          )
          const snapshot = yield* registry.list()
          return { event, snapshot }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      const event = Option.getOrThrow(result.event)
      expect(event.windowId).toBe("host-opened-window")
      expect(event.window).toMatchObject({
        kind: "window",
        id: "host-opened-window",
        ownerScope: "window:host-opened-window",
        state: "open"
      })
      expect(result.snapshot.entries.map((entry) => String(entry.handle.id))).toEqual([
        "host-opened-window"
      ])
    })
  ))

test("Window.events rejects host-originated opened events with mismatched handles", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_SUBSCRIBE_EVENTS_METHOD
            ? Effect.succeed({ kind: "success", payload: { subscribed: true } })
            : Effect.die(`unexpected request: ${request.method}`),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_650,
                  traceId: "host-window-mismatched-opened-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "opened",
                    windowId: "host-opened-window",
                    window: {
                      kind: "window",
                      id: "host-opened-window",
                      generation: 0,
                      ownerScope: "app",
                      state: "open"
                    },
                    terminal: false
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const eventExit = yield* Effect.exit(window.events().pipe(Stream.take(1), Stream.runHead))
          const snapshot = yield* registry.list()
          return { eventExit, snapshot }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      expectExitFailure(
        result.eventExit,
        (error) =>
          Schema.is(HostProtocolInvalidOutputError)(error) &&
          error.operation === WINDOW_EVENT_METHOD
      )
      expect(result.snapshot.entries).toEqual([])
    })
  ))

test("Window.events rejects registry events with terminal flags that do not match phase", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_SUBSCRIBE_EVENTS_METHOD
            ? Effect.succeed({ kind: "success", payload: { subscribed: true } })
            : Effect.die(`unexpected request: ${request.method}`),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_651,
                  traceId: "host-window-terminal-mismatch-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "closed",
                    windowId: "host-closed-window",
                    terminal: false
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const eventExit = yield* Effect.exit(window.events().pipe(Stream.take(1), Stream.runHead))
          const snapshot = yield* registry.list()
          return { eventExit, snapshot }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      expectExitFailure(
        result.eventExit,
        (error) =>
          Schema.is(HostProtocolInvalidOutputError)(error) &&
          error.operation === WINDOW_EVENT_METHOD
      )
      expect(result.snapshot.entries).toEqual([])
    })
  ))

test("Window.events strips handles for host-originated events without local resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_SUBSCRIBE_EVENTS_METHOD
            ? Effect.succeed({ kind: "success", payload: { subscribed: true } })
            : Effect.die(`unexpected request: ${request.method}`),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_675,
                  traceId: "host-window-shown-unknown-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "shown",
                    windowId: "host-focused-window",
                    window: {
                      kind: "window",
                      id: "host-focused-window",
                      generation: 0,
                      ownerScope: "window:host-focused-window",
                      state: "open"
                    },
                    terminal: false
                  }
                }),
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_676,
                  traceId: "host-window-closed-unknown-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "closed",
                    windowId: "host-closed-window",
                    window: {
                      kind: "window",
                      id: "host-closed-window",
                      generation: 0,
                      ownerScope: "window:host-closed-window",
                      state: "open"
                    },
                    terminal: true
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const events = yield* window.events().pipe(Stream.take(3), Stream.runCollect)
          const snapshot = yield* registry.list()
          return { events, snapshot }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      expect(Array.from(result.events).map((event) => event.window)).toEqual([
        undefined,
        undefined,
        undefined
      ])
      expect(result.snapshot.entries).toEqual([])
    })
  ))

test("Window.events closes ResourceRegistry handles for host-originated terminal events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const baseExchange = makeWindowRpcExchange(windowExchange([]), registry)
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_GET_STATE_METHOD
            ? Effect.succeed({
                kind: "success",
                payload: {
                  minimized: true,
                  maximized: false,
                  fullscreen: false,
                  simpleFullscreen: false
                }
              })
            : baseExchange.request(request),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_700,
                  traceId: "host-window-closed-event",
                  payload: {
                    type: "window-registry-event",
                    phase: "closed",
                    windowId: "host-window-1",
                    terminal: true
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({ title: "Host closed" })
          const event = yield* window.events().pipe(Stream.take(1), Stream.runHead)
          const snapshot = yield* registry.list()
          return { created, event, snapshot }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      const event = Option.getOrThrow(result.event)
      expect(event.windowId).toBe(String(result.created.id))
      expect(event.window).toEqual(result.created)
      expect(result.snapshot.entries).toEqual([])
    })
  ))

test("Window.events attaches host-originated state events to fresh handles", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const baseExchange = makeWindowRpcExchange(windowExchange([]), registry)
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_GET_STATE_METHOD
            ? Effect.succeed({
                kind: "success",
                payload: {
                  minimized: true,
                  maximized: false,
                  fullscreen: false,
                  simpleFullscreen: false
                }
              })
            : baseExchange.request(request),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_725,
                  traceId: "host-window-state-event",
                  payload: {
                    type: "window-state-event",
                    windowId: "host-window-1",
                    state: {
                      minimized: true,
                      maximized: false,
                      fullscreen: false,
                      simpleFullscreen: false
                    }
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({ title: "Host state" })
          const event = yield* window.events().pipe(Stream.take(1), Stream.runHead)
          const state = yield* window.getState(created)
          return { created, event, state }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      const event = Option.getOrThrow(result.event)
      expect(event.type).toBe("window-state-event")
      if (event.type !== "window-state-event") {
        throw new Error("expected window state event")
      }
      expect(event.windowId).toBe(String(result.created.id))
      expect(event.window).toEqual(result.created)
      expect(event.state).toEqual({
        minimized: true,
        maximized: false,
        fullscreen: false,
        simpleFullscreen: false
      })
      expect(result.state).toEqual({
        minimized: true,
        maximized: false,
        fullscreen: false,
        simpleFullscreen: false
      })
    })
  ))

test("Window.events attaches host-originated bounds events to fresh handles", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const baseExchange = makeWindowRpcExchange(windowExchange([]), registry)
      const exchange: BridgeClientExchange = {
        request: (request) =>
          request.method === WINDOW_GET_STATE_METHOD
            ? Effect.succeed({
                kind: "success",
                payload: {
                  minimized: false,
                  maximized: false,
                  fullscreen: false,
                  simpleFullscreen: false
                }
              })
            : baseExchange.request(request),
        subscribe: (method) =>
          method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_726,
                  traceId: "host-window-bounds-event",
                  payload: {
                    type: "window-bounds-event",
                    windowId: "host-window-1",
                    bounds: { x: 10, y: 20, width: 640, height: 480 }
                  }
                })
              )
            : Stream.empty
      }

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({ title: "Host bounds" })
          const event = yield* window.events().pipe(Stream.take(1), Stream.runHead)
          return { created, event }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(exchange, registry))
      )

      const event = Option.getOrThrow(result.event)
      expect(event).toEqual(
        new WindowBoundsEvent({
          type: "window-bounds-event",
          windowId: String(result.created.id),
          window: result.created,
          bounds: new WindowBounds({ x: 10, y: 20, width: 640, height: 480 })
        })
      )
    })
  ))

test("Window.events checks and audits subscribe permission before opening the event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const deniedRows: AuditEvent[] = []
      const deniedRegistry = yield* makeResourceRegistry()
      const deniedPermissions = yield* makePermissionRegistry({
        audit: memoryAudit(deniedRows),
        traceId: () => "trace-denied"
      })
      let deniedSubscribeCount = 0
      const deniedRuntime = makeHostWindowRpcRuntime(windowExchange([]), undefined, {
        originAuth: RendererOriginAuth.unsafeDisabledForTests
      })
      const deniedExchange: BridgeClientExchange = {
        request: (request) =>
          runScoped(
            deniedRuntime.dispatch(request),
            Layer.mergeAll(
              Layer.succeed(ResourceRegistry)(deniedRegistry),
              Layer.succeed(PermissionRegistry)(deniedPermissions)
            )
          ) as ReturnType<BridgeClientExchange["request"]>,
        subscribe: () => {
          deniedSubscribeCount += 1
          return Stream.empty
        }
      }

      const deniedExit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const window = yield* Window
            return yield* window.events().pipe(Stream.take(1), Stream.runHead)
          }),
          Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(deniedExchange, deniedRegistry))
        )
      )

      expectExitFailure(deniedExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expect(deniedSubscribeCount).toBe(0)
      expect(deniedRows.map((row) => row.kind)).toEqual(["permission-denied"])
      expect(deniedRows.map((row) => row.normalizedCapability)).toEqual([
        P.nativeInvoke({ primitive: "Window", methods: ["subscribeEvents"] })
      ])

      const allowedRows: AuditEvent[] = []
      const allowedRegistry = yield* makeResourceRegistry()
      const allowedPermissions = yield* makePermissionRegistry({
        audit: memoryAudit(allowedRows),
        traceId: () => "trace-allowed"
      })
      yield* allowedPermissions.declare(
        P.nativeInvoke({ primitive: "Window", methods: ["subscribeEvents"] }),
        {
          source: "window-events-test",
          effect: "allow"
        }
      )
      let allowedSubscribeCount = 0
      const allowedRuntime = makeHostWindowRpcRuntime(windowExchange([]), undefined, {
        originAuth: RendererOriginAuth.unsafeDisabledForTests
      })
      const allowedExchange: BridgeClientExchange = {
        request: (request) =>
          runScoped(
            allowedRuntime.dispatch(request),
            Layer.mergeAll(
              Layer.succeed(ResourceRegistry)(allowedRegistry),
              Layer.succeed(PermissionRegistry)(allowedPermissions)
            )
          ) as ReturnType<BridgeClientExchange["request"]>,
        subscribe: (method) => {
          allowedSubscribeCount += 1
          return method === WINDOW_EVENT_METHOD
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  method,
                  timestamp: 1_710_000_002_800,
                  traceId: "host-window-events-allowed",
                  payload: {
                    type: "window-registry-event",
                    phase: "opened",
                    windowId: "host-allowed-window",
                    terminal: false
                  }
                })
              )
            : Stream.empty
        }
      }

      const event = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          return yield* window.events().pipe(Stream.take(1), Stream.runHead)
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(allowedExchange, allowedRegistry))
      )

      expect(Option.getOrThrow(event).windowId).toBe("host-allowed-window")
      expect(allowedSubscribeCount).toBe(1)
      expect(allowedRows.map((row) => row.kind)).toEqual([
        "permission-granted",
        "permission-granted",
        "permission-used"
      ])
      expect(allowedRows.map((row) => row.normalizedCapability)).toEqual([
        P.nativeInvoke({ primitive: "Window", methods: ["subscribeEvents"] }),
        P.nativeInvoke({ primitive: "Window", methods: ["subscribeEvents"] }),
        P.nativeInvoke({ primitive: "Window", methods: ["subscribeEvents"] })
      ])
    })
  ))

test("native host RPC runtime denies Window.getCurrent before lookup work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeResourceRegistry()
          const router = yield* makeAppEventRouter()
          const runtime = makeHostWindowRpcRuntime(
            windowExchange(requests),
            { appEventRouter: router },
            {
              originAuth: RendererOriginAuth.unsafeDisabledForTests
            }
          )
          return yield* runScoped(
            runtime.dispatch(
              new HostProtocolRequestEnvelope({
                kind: "request",
                id: "window-get-current-denied",
                method: "Window.getCurrent",
                timestamp: 1710000000000,
                traceId: "trace-window-get-current-denied"
              })
            ),
            Layer.mergeAll(
              Layer.effect(PermissionRegistry, makePermissionRegistry()),
              Layer.succeed(ResourceRegistry)(registry)
            )
          )
        })
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(requests).toEqual([])
    })
  ))

test("native host RPC runtime audits WindowPersistence Window dependency permissions", () => {
  const windowDependencyCalls = [
    {
      method: WINDOW_GET_BY_ID_METHOD,
      payload: { windowId: "host-window-1" },
      capability: P.nativeInvoke({ primitive: "Window", methods: ["getById"] })
    },
    {
      method: WINDOW_GET_BOUNDS_METHOD,
      payload: { window: handleFor("host-window-1") },
      capability: P.nativeInvoke({ primitive: "Window", methods: ["getBounds"] })
    },
    {
      method: WINDOW_GET_STATE_METHOD,
      payload: { window: handleFor("host-window-1") },
      capability: P.nativeInvoke({ primitive: "Window", methods: ["getState"] })
    },
    {
      method: WINDOW_SET_BOUNDS_METHOD,
      payload: {
        window: handleFor("host-window-1"),
        bounds: { x: 10, y: 20, width: 640, height: 480 }
      },
      capability: P.nativeInvoke({ primitive: "Window", methods: ["setBounds"] })
    },
    {
      method: WINDOW_SET_FULLSCREEN_METHOD,
      payload: { window: handleFor("host-window-1"), fullscreen: true },
      capability: P.nativeInvoke({ primitive: "Window", methods: ["setFullscreen"] })
    },
    {
      method: WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
      payload: { window: handleFor("host-window-1"), simpleFullscreen: true },
      capability: P.nativeInvoke({ primitive: "Window", methods: ["setSimpleFullscreen"] })
    }
  ] as const
  const deniedRows: AuditEvent[] = []
  const deniedRequests: HostProtocolRequestEnvelope[] = []
  const deniedRuntime = makeHostWindowRpcRuntime(windowExchange(deniedRequests), undefined, {
    originAuth: RendererOriginAuth.unsafeDisabledForTests
  })

  return Effect.runPromise(
    Effect.gen(function* () {
      const deniedPermissions = yield* makePermissionRegistry({
        audit: memoryAudit(deniedRows),
        traceId: () => "trace-denied"
      })
      const deniedRegistry = yield* makeResourceRegistry()

      for (const [index, call] of windowDependencyCalls.entries()) {
        const response = yield* deniedRuntime
          .dispatch(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: `window-persistence-denied-${index}`,
              method: call.method,
              payload: call.payload,
              timestamp: 1_710_000_003_000 + index,
              traceId: `trace-window-persistence-denied-${index}`
            })
          )
          .pipe(
            Effect.provideService(ResourceRegistry, deniedRegistry),
            Effect.provideService(PermissionRegistry, deniedPermissions)
          )
        expect(response.kind).toBe("failure")
        if (response.kind === "failure") {
          expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
        }
      }

      expect(deniedRequests).toEqual([])
      expect(deniedRows.map((row) => row.kind)).toEqual(
        windowDependencyCalls.map(() => "permission-denied")
      )
      expect(deniedRows.map((row) => row.normalizedCapability)).toEqual(
        windowDependencyCalls.map((call) => call.capability)
      )

      const allowedRows: AuditEvent[] = []
      const allowedRequests: HostProtocolRequestEnvelope[] = []
      const allowedPermissions = yield* makePermissionRegistry({
        audit: memoryAudit(allowedRows),
        traceId: () => "trace-allowed"
      })
      for (const call of windowDependencyCalls) {
        yield* allowedPermissions.declare(call.capability, {
          source: "window-persistence-test",
          effect: "allow"
        })
      }
      const allowedRegistry = yield* makeResourceRegistry()
      const allowedRuntime = makeHostWindowRpcRuntime(windowExchange(allowedRequests), undefined, {
        originAuth: RendererOriginAuth.unsafeDisabledForTests
      })

      const allowedResponses: BridgeClientResponse[] = []
      for (const [index, call] of windowDependencyCalls.entries()) {
        const response = yield* allowedRuntime
          .dispatch(
            new HostProtocolRequestEnvelope({
              kind: "request",
              id: `window-persistence-allowed-${index}`,
              method: call.method,
              payload: call.payload,
              timestamp: 1_710_000_003_100 + index,
              traceId: `trace-window-persistence-allowed-${index}`
            })
          )
          .pipe(
            Effect.provideService(ResourceRegistry, allowedRegistry),
            Effect.provideService(PermissionRegistry, allowedPermissions)
          )
        allowedResponses.push(response)
      }

      expect(allowedResponses.map((response) => response.kind)).toEqual(
        windowDependencyCalls.map(() => "failure")
      )
      for (const response of allowedResponses) {
        if (response.kind === "failure") {
          expect(hasErrorTag(response.error, "PermissionDenied")).toBe(false)
        }
      }
      expect(allowedRequests.map((request) => request.method)).toEqual([WINDOW_GET_BY_ID_METHOD])
      expect(
        allowedRows.filter((row) => row.kind === "permission-used").map((row) => row.kind)
      ).toEqual(windowDependencyCalls.map(() => "permission-used"))
      expect(
        allowedRows
          .filter((row) => row.kind === "permission-used")
          .map((row) => row.normalizedCapability)
      ).toEqual(windowDependencyCalls.map((call) => call.capability))
    })
  )
})

test("Window lookup uses host transport without runtime router", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const rpcExchange = makeWindowRpcExchange(windowExchange(requests), registry)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const created = yield* window.create({ title: "Lookup" })
          const current = yield* window.getCurrent()
          return { created, current }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      expect(result.current.id).toBe(result.created.id)
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Lookup" }],
        ["Window.getCurrent", undefined]
      ])
    })
  ))

test("native host RPC runtime denies owned child Window.create before host transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const runtime = makeHostWindowRpcRuntime(windowExchange(requests), undefined, {
        originAuth: RendererOriginAuth.unsafeDisabledForTests
      })

      const response = yield* runScoped(
        runtime.dispatch(
          new HostProtocolRequestEnvelope({
            kind: "request",
            id: "window-create-child-denied",
            method: WINDOW_CREATE_METHOD,
            payload: { title: "Child", parent: handleFor("parent") },
            timestamp: 1710000000000,
            traceId: "trace-window-create-child-denied"
          })
        ),
        Layer.mergeAll(
          Layer.effect(PermissionRegistry, makePermissionRegistry()),
          Layer.effect(ResourceRegistry, makeResourceRegistry())
        )
      )

      expect(response.kind).toBe("failure")
      if (response.kind === "failure") {
        expect(hasErrorTag(response.error, "PermissionDenied")).toBe(true)
      }
      expect(requests).toEqual([])
    })
  ))

test("Window service propagates owned child unsupported platform and host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unsupported = new HostProtocolUnsupportedError({
        tag: "Unsupported",
        reason: "window-parent-ownership-unavailable",
        message: "unsupported Window.create parent",
        operation: "Window.create",
        recoverable: false
      })
      const unsupportedClient: WindowClientApi = {
        ...noopWindowClient,
        create: () => Effect.fail(unsupported)
      }
      const hostFailureClient: WindowClientApi = {
        ...noopWindowClient,
        create: () => Effect.fail(makeHostProtocolHostUnavailableError("Window.create"))
      }
      const parent = handleFor("parent")

      const unsupportedExit = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          return yield* Effect.exit(window.create({ parent }))
        }),
        makeWindowServiceLayer(unsupportedClient)
      )
      const hostFailureExit = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          return yield* Effect.exit(window.create({ parent }))
        }),
        makeWindowServiceLayer(hostFailureClient)
      )

      expectExitFailure(unsupportedExit, (error) => hasErrorTag(error, "Unsupported"))
      expectExitFailure(hostFailureExit, (error) => hasErrorTag(error, "HostUnavailable"))
    })
  ))

test("host WindowClient adapter propagates owned child create host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const hostExchange: HostWindowExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed(
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: request.id,
              timestamp: request.timestamp + 1,
              traceId: request.traceId,
              ...(request.method === WINDOW_CREATE_METHOD && requests.length === 1
                ? { payload: { windowId: "host-parent" } }
                : { error: makeHostProtocolHostUnavailableError("Window.create") })
            })
          )
        }
      }
      const rpcExchange = makeWindowRpcExchange(hostExchange, registry, {
        nextRequestId: nextId(["create-parent-request", "create-child-request"]),
        nextTraceId: nextId(["create-parent-trace", "create-child-trace"]),
        now: nextNumber([1_710_000_001_100, 1_710_000_001_101])
      })

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const parent = yield* window.create({ title: "Parent" })
          const childExit = yield* Effect.exit(window.create({ title: "Child", parent }))
          return { childExit, parent }
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      expectExitFailure(result.childExit, (error) => hasErrorTag(error, "HostUnavailable"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Parent" }],
        [WINDOW_CREATE_METHOD, { title: "Child", parentWindowId: "host-parent" }]
      ])
    })
  ))

test("host WindowClient adapter propagates lookup host failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const hostExchange: HostWindowExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed(
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: request.id,
              timestamp: request.timestamp + 1,
              traceId: request.traceId,
              ...(request.method === WINDOW_CREATE_METHOD
                ? { payload: { windowId: "host-window" } }
                : { error: makeHostProtocolHostUnavailableError(WINDOW_GET_CURRENT_METHOD) })
            })
          )
        }
      }
      const rpcExchange = makeWindowRpcExchange(hostExchange, registry, {
        nextRequestId: nextId(["create-request", "get-current-request"]),
        nextTraceId: nextId(["create-trace", "get-current-trace"]),
        now: nextNumber([1_710_000_001_200, 1_710_000_001_201])
      })

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          yield* window.create({ title: "Lookup" })
          return yield* Effect.exit(window.getCurrent())
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      expectExitFailure(result, (error) => hasErrorTag(error, "HostUnavailable"))
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Lookup" }],
        [WINDOW_GET_CURRENT_METHOD, undefined]
      ])
    })
  ))

test("host WindowClient adapter rejects mismatched lookup host output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const registry = yield* makeResourceRegistry()
      const createWindowIds = nextId(["host-parent", "host-child"])
      const hostExchange: HostWindowExchange = {
        request: (request) => {
          requests.push(request)
          return Effect.succeed(
            new HostProtocolResponseEnvelope({
              kind: "response",
              id: request.id,
              timestamp: request.timestamp + 1,
              traceId: request.traceId,
              ...(request.method === WINDOW_CREATE_METHOD
                ? { payload: { windowId: createWindowIds() } }
                : request.method === WINDOW_GET_BY_ID_METHOD
                  ? { payload: { windowId: "host-child" } }
                  : {})
            })
          )
        }
      }
      const rpcExchange = makeWindowRpcExchange(hostExchange, registry, {
        nextRequestId: nextId([
          "create-parent-request",
          "create-child-request",
          "get-by-id-request"
        ]),
        nextTraceId: nextId(["create-parent-trace", "create-child-trace", "get-by-id-trace"]),
        now: nextNumber([1_710_000_001_300, 1_710_000_001_301, 1_710_000_001_302])
      })

      const result = yield* runScoped(
        Effect.gen(function* () {
          const window = yield* Window
          const parent = yield* window.create({ title: "Parent" })
          yield* window.create({ title: "Child", parent })
          return yield* Effect.exit(window.getById(String(parent.id)))
        }),
        Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
      )

      expectExitFailure(
        result,
        (error) =>
          Schema.is(HostProtocolInvalidOutputError)(error) &&
          error.operation === WINDOW_GET_BY_ID_METHOD
      )
      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        [WINDOW_CREATE_METHOD, { title: "Parent" }],
        [WINDOW_CREATE_METHOD, { title: "Child", parentWindowId: "host-parent" }],
        [WINDOW_GET_BY_ID_METHOD, { windowId: "host-parent" }]
      ])
    })
  ))

test("AppEventRouter sends firstResponder events to the focused window only", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.windowOpened(handleFor("window-1"))
          yield* router.windowOpened(handleFor("window-2"))
          yield* router.windowFocused("window-2")
          const first = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
          const second = yield* router
            .subscribe("window-2", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "/tmp/README.md" },
            route: firstResponderRoute
          })
          yield* Effect.sleep("10 millis")
          yield* Fiber.interrupt(first)

          return yield* Fiber.join(second)
        })
      )

      expect(Array.from(result)).toEqual([
        {
          event: "onOpenFile",
          payload: { path: "/tmp/README.md" },
          windowId: "window-2",
          ownerScope: "window:window-2"
        }
      ])
    })
  ))

test("AppEventRouter buffers one firstResponder event per kind until a window opens", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "older.txt" },
            route: firstResponderRoute
          })
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "newer.txt" },
            route: firstResponderRoute
          })
          const audit = yield* router
            .audit()
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
          yield* router.windowOpened(handleFor("window-1"))
          const events = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "after-open.txt" },
            route: firstResponderRoute
          })

          return {
            events: yield* Fiber.join(events),
            audit: yield* Fiber.join(audit)
          }
        })
      )

      expect(appEventOpenFilePaths(result.events)).toEqual(["newer.txt"])
      expect(Array.from(result.audit).map((event) => event._tag)).toEqual(["EventBufferEvicted"])
    })
  ))

test("AppEventRouter rejects empty window identifiers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const router = yield* makeAppEventRouter()
            return yield* router.windowOpened(handleFor(""))
          })
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  ))

test("AppEventRouter targetedRoute rejects control-byte window identifiers", () => {
  expect(() => {
    targetedRoute(`window-${String.fromCharCode(0)}route`)
  }).toThrow(RangeError)
})

test("AppEventRouter rejects control-byte route metadata on publish", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const router = yield* makeAppEventRouter()
            return yield* router.publish({
              event: "onOpenFile",
              payload: { path: "/tmp/route.txt" },
              route: {
                _tag: "targeted",
                windowId: `window-${String.fromCharCode(0)}route`
              }
            })
          })
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  ))

test("AppEventRouter observes state transitions for windows, focus, and close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const snapshots = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          const states = yield* router
            .observeState()
            .pipe(Stream.take(5), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.windowOpened(handleFor("window-1"))
          yield* router.windowOpened(handleFor("window-2"))
          yield* router.windowFocused("window-2")
          yield* router.windowClosed("window-2")

          return yield* Fiber.join(states)
        })
      )

      expect(
        Array.from(snapshots).map((state) => ({
          windows: state.windows.map((window) => window.windowId),
          focusedWindowId: Option.getOrUndefined(state.focusedWindowId)
        }))
      ).toEqual([
        { windows: [], focusedWindowId: undefined },
        { windows: ["window-1"], focusedWindowId: "window-1" },
        { windows: ["window-1", "window-2"], focusedWindowId: "window-1" },
        { windows: ["window-1", "window-2"], focusedWindowId: "window-2" },
        { windows: ["window-1"], focusedWindowId: "window-1" }
      ])
    })
  ))

test("AppEventRouter emits ordered terminal window registry events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          const collected = yield* router
            .windowEvents()
            .pipe(Stream.take(5), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.windowOpened(handleFor("window-1"))
          yield* router.windowShown("window-1")
          yield* router.windowHidden("window-1")
          yield* router.windowFocused("window-1")
          yield* router.windowClosed("window-1")

          return yield* Fiber.join(collected)
        })
      )

      expect(
        Array.from(events).map((event) => ({
          phase: event.phase,
          terminal: event.terminal,
          windowId: event.windowId,
          window: event.window === undefined ? undefined : String(event.window.id)
        }))
      ).toEqual([
        { phase: "opened", terminal: false, windowId: "window-1", window: "window-1" },
        { phase: "shown", terminal: false, windowId: "window-1", window: "window-1" },
        { phase: "hidden", terminal: false, windowId: "window-1", window: "window-1" },
        { phase: "focused", terminal: false, windowId: "window-1", window: "window-1" },
        { phase: "closed", terminal: true, windowId: "window-1", window: "window-1" }
      ])
    })
  ))

test("AppEventRouter emits fallback focus after focused window closes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          const collected = yield* router
            .windowEvents()
            .pipe(Stream.take(5), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.windowOpened(handleFor("window-1"))
          yield* router.windowOpened(handleFor("window-2"))
          yield* router.windowFocused("window-2")
          yield* router.windowClosed("window-2")

          return yield* Fiber.join(collected)
        })
      )

      expect(
        Array.from(events).map((event) => ({
          phase: event.phase,
          terminal: event.terminal,
          windowId: event.windowId,
          window: event.window === undefined ? undefined : String(event.window.id)
        }))
      ).toEqual([
        { phase: "opened", terminal: false, windowId: "window-1", window: "window-1" },
        { phase: "opened", terminal: false, windowId: "window-2", window: "window-2" },
        { phase: "focused", terminal: false, windowId: "window-2", window: "window-2" },
        { phase: "closed", terminal: true, windowId: "window-2", window: "window-2" },
        { phase: "focused", terminal: false, windowId: "window-1", window: "window-1" }
      ])
    })
  ))

test("AppEventRouter observes firstResponder buffered pending and drained transitions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          const states = yield* router
            .observeState()
            .pipe(Stream.take(4), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "pending.txt" },
            route: firstResponderRoute
          })
          yield* router.windowOpened(handleFor("window-1"))
          const event = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect)

          return {
            event,
            states: yield* Fiber.join(states)
          }
        })
      )

      expect(appEventOpenFilePaths(result.event)).toEqual(["pending.txt"])
      expect(
        Array.from(result.states).map((state) => ({
          buffered: state.bufferedFirstResponder.map((event) => event.event),
          pending: state.pendingWindowEvents.map((entry) => ({
            windowId: entry.windowId,
            events: entry.events.map((event) => event.event)
          })),
          windows: state.windows.map((window) => window.windowId)
        }))
      ).toEqual([
        { buffered: [], pending: [], windows: [] },
        { buffered: ["onOpenFile"], pending: [], windows: [] },
        {
          buffered: [],
          pending: [{ windowId: "window-1", events: ["onOpenFile"] }],
          windows: ["window-1"]
        },
        { buffered: [], pending: [], windows: ["window-1"] }
      ])
    })
  ))

test("AppEventRouter completes active subscriptions when their window closes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.windowOpened(handleFor("window-1"))
          const events = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.windowClosed("window-1")

          return yield* Fiber.join(events)
        })
      )

      expect(Array.from(result)).toEqual([])
    })
  ))

test("AppEventRouter does not replay normal events to late subscribers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.windowOpened(handleFor("window-1"))
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "stale.txt" },
            route: targetedRoute("window-1")
          })
          const events = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "fresh.txt" },
            route: targetedRoute("window-1")
          })

          return yield* Fiber.join(events)
        })
      )

      expect(appEventOpenFilePaths(result)).toEqual(["fresh.txt"])
    })
  ))

test("AppEventRouter drains pending firstResponder events once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "pending.txt" },
            route: firstResponderRoute
          })
          yield* router.windowOpened(handleFor("window-1"))

          const first = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect)
          const second = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "after-drain.txt" },
            route: firstResponderRoute
          })

          return {
            first,
            second: yield* Fiber.join(second)
          }
        })
      )

      expect(appEventOpenFilePaths(result.first)).toEqual(["pending.txt"])
      expect(appEventOpenFilePaths(result.second)).toEqual(["after-drain.txt"])
    })
  ))

test("AppEventRouter receives live events published while pending replay is consumed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "pending.txt" },
            route: firstResponderRoute
          })
          yield* router.windowOpened(handleFor("window-1"))

          return yield* router.subscribe("window-1", "onOpenFile").pipe(
            Stream.tap((event) =>
              decodeAppEventOpenFilePayload(event.payload).path === "pending.txt"
                ? router.publish({
                    event: "onOpenFile",
                    payload: { path: "live.txt" },
                    route: targetedRoute("window-1")
                  })
                : Effect.void
            ),
            Stream.take(2),
            Stream.runCollect
          )
        })
      )

      expect(appEventOpenFilePaths(result)).toEqual(["pending.txt", "live.txt"])
    })
  ))

test("AppEventRouter isolates event channel capacity by window and event name", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter({ eventChannelCapacity: 1 })
          yield* router.windowOpened(handleFor("window-1"))
          yield* router.windowOpened(handleFor("window-2"))
          const events = yield* router
            .subscribe("window-1", "onOpenFile")
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.publish({
            event: "onOpenUrl",
            payload: { url: "app://unrelated-1" },
            route: targetedRoute("window-1")
          })
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "other-window.txt" },
            route: targetedRoute("window-2")
          })
          yield* router.publish({
            event: "onOpenUrl",
            payload: { url: "app://unrelated-2" },
            route: targetedRoute("window-1")
          })
          yield* router.publish({
            event: "onOpenFile",
            payload: { path: "relevant.txt" },
            route: targetedRoute("window-1")
          })

          return yield* Fiber.join(events)
        })
      )

      expect(appEventOpenFilePaths(result)).toEqual(["relevant.txt"])
    })
  ))

test("AppEventRouter keeps newest audit event when audit replay buffer is full", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const audits = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter({ auditReplayCapacity: 1 })
          yield* router.publish({
            event: "Tray.activation",
            payload: { button: "left" },
            route: targetedRoute("closed-window")
          })
          yield* router.publish({
            event: "Tray.activation",
            payload: { button: "right" },
            route: targetedRoute("closed-window")
          })

          return yield* router.audit().pipe(Stream.take(1), Stream.runCollect)
        })
      )

      expect(Array.from(audits)).toEqual([
        {
          _tag: "EventDroppedTargetClosed",
          event: "Tray.activation",
          windowId: "closed-window",
          dropped: {
            event: "Tray.activation",
            payload: { button: "right" }
          }
        }
      ])
    })
  ))

test("AppEventRouter broadcasts in creation order and short-circuits on refusal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const seen: string[] = []
      const decision = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          yield* router.windowOpened(handleFor("window-1"))
          yield* router.windowOpened(handleFor("window-2"))
          yield* router.windowOpened(handleFor("window-3"))

          return yield* router.dispatch(
            {
              event: "onWillQuit",
              payload: { reason: "test" },
              route: broadcastRoute
            },
            (event) =>
              Effect.sync(() => {
                seen.push(event.windowId)
                return event.windowId === "window-2" ? "refuse" : "continue"
              })
          )
        })
      )

      expect(decision).toBe("refuse")
      expect(seen).toEqual(["window-1", "window-2"])
    })
  ))

test("AppEventRouter drops targeted events for closed targets with an audit row", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* Effect.scoped(
        Effect.gen(function* () {
          const router = yield* makeAppEventRouter()
          const fiber = yield* router
            .audit()
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

          yield* router.publish({
            event: "Tray.activation",
            payload: { button: "left" },
            route: targetedRoute("closed-window")
          })

          return yield* Fiber.join(fiber)
        })
      )

      expect(Array.from(audit)).toEqual([
        {
          _tag: "EventDroppedTargetClosed",
          event: "Tray.activation",
          windowId: "closed-window",
          dropped: {
            event: "Tray.activation",
            payload: { button: "left" }
          }
        }
      ])
    })
  ))

test("host WindowClient adapter declares per-window scopes and closes scoped resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeResourceRegistry()
          const router = yield* makeAppEventRouter()
          const rpcExchange = makeWindowRpcExchange(windowExchange([]), registry, {}, router)
          return yield* runScoped(
            Effect.gen(function* () {
              const window = yield* Window
              const created = yield* window.create({})
              const child = yield* registry.register({
                kind: "stream",
                ownerScope: created.ownerScope,
                state: "open"
              })
              yield* window.close(created)
              const afterClose = yield* registry.list()

              return { child, afterClose }
            }),
            Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
          )
        })
      )

      expect(result.child.ownerScope).toBe("window:host-window-1")
      expect(result.afterClose.entries).toEqual([])
    })
  ))

test("host WindowClient adapter returns typed failures for invalid input and bad handles", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const rpcExchange = makeWindowRpcExchange(windowExchange([]), registry)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WindowClient
          const malformedInputExit = yield* Effect.exit(
            client.show({
              ...windowHandle,
              // @ts-expect-error intentionally malformed handle id exercises runtime decoding.
              id: ""
            })
          )
          const unknownExit = yield* Effect.exit(client.focus(windowHandle))
          const created = yield* client.create({})
          const invalidDisplayBoundsExit = yield* Effect.exit(
            client.setBoundsOnDisplay(created, "", { x: 0, y: 0, width: 100, height: 100 })
          )
          const invalidDisplayExit = yield* Effect.exit(client.centerOnDisplay(created, ""))
          const staleExit = yield* Effect.exit(
            client.hide({
              ...created,
              generation: created.generation + 1
            })
          )
          yield* client.close(created)
          const repeatedCloseExit = yield* Effect.exit(client.close(created))
          return {
            invalidDisplayBoundsExit,
            invalidDisplayExit,
            malformedInputExit,
            repeatedCloseExit,
            staleExit,
            unknownExit
          }
        }),
        makeWindowTestBridgeClientLayer(rpcExchange, registry)
      )

      expectExitFailure(
        result.malformedInputExit,
        (error) =>
          Schema.is(HostProtocolInvalidArgumentError)(error) && error.operation === "Window.show"
      )
      expectExitFailure(
        result.unknownExit,
        (error) => Schema.is(HostProtocolNotFoundError)(error) && error.operation === "Window.focus"
      )
      expectExitFailure(
        result.staleExit,
        (error) =>
          Schema.is(HostProtocolStaleHandleError)(error) && error.operation === "Window.hide"
      )
      expectExitFailure(
        result.invalidDisplayExit,
        (error) =>
          Schema.is(HostProtocolInvalidArgumentError)(error) &&
          error.operation === "Window.centerOnDisplay"
      )
      expectExitFailure(
        result.invalidDisplayBoundsExit,
        (error) =>
          Schema.is(HostProtocolInvalidArgumentError)(error) &&
          error.operation === "Window.setBoundsOnDisplay"
      )
      expectExitFailure(
        result.repeatedCloseExit,
        (error) =>
          Schema.is(HostProtocolStaleHandleError)(error) && error.operation === "Window.close"
      )
    })
  ))

test("host WindowClient adapter maps malformed generated RPC successes to typed invalid output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidCreateExchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: { windowId: "" } })
      }
      const invalidCloseExchange: BridgeClientExchange = {
        request: () => Effect.succeed({ kind: "success", payload: { unexpected: true } })
      }
      const createRegistry = yield* makeResourceRegistry()
      const closeRegistry = yield* makeResourceRegistry()

      const createExit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const client = yield* WindowClient
            return yield* client.create({})
          }),
          makeWindowTestBridgeClientLayer(invalidCreateExchange, createRegistry)
        )
      )
      const closeExit = yield* Effect.exit(
        runScoped(
          Effect.gen(function* () {
            const client = yield* WindowClient
            return yield* client.close(windowHandle)
          }),
          makeWindowTestBridgeClientLayer(invalidCloseExchange, closeRegistry)
        )
      )

      expectExitFailure(
        createExit,
        (error) =>
          Schema.is(HostProtocolInvalidOutputError)(error) && error.operation === "Window.create"
      )
      expectExitFailure(
        closeExit,
        (error) =>
          Schema.is(HostProtocolInvalidOutputError)(error) && error.operation === "Window.close"
      )
    })
  ))

test("host WindowClient adapter exposes only supported callable methods", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const rpcExchange = makeWindowRpcExchange(windowExchange([]), registry)
      const client = yield* runScoped(
        WindowClient.asEffect(),
        makeWindowTestBridgeClientLayer(rpcExchange, registry)
      )

      expect("create" in client).toBe(true)
      expect("close" in client).toBe(true)
      expect("destroy" in client).toBe(true)
      expect("show" in client).toBe(true)
      expect("hide" in client).toBe(true)
      expect("focus" in client).toBe(true)
      expect("getBounds" in client).toBe(true)
      expect("setBounds" in client).toBe(true)
      expect("setBoundsOnDisplay" in client).toBe(true)
      expect("center" in client).toBe(true)
      expect("centerOnDisplay" in client).toBe(true)
      expect("setVibrancy" in client).toBe(true)
      expect("clearVibrancy" in client).toBe(true)
      expect("setShadow" in client).toBe(true)
      expect("setTitleBarStyle" in client).toBe(true)
      expect("setTitleBarTransparent" in client).toBe(true)
      expect("setTransparent" in client).toBe(true)
    })
  ))

test("Window bridge client rejects invalid chrome inputs before crossing the host boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidInputs: ReadonlyArray<unknown> = [
        { title: "" },
        { vibrancy: "not-a-material" },
        { trafficLights: { x: -10, y: 0 } },
        { trafficLights: { x: 0, y: -20 } }
      ]

      for (const input of invalidInputs) {
        const requests: HostProtocolRequestEnvelope[] = []
        const registry = yield* makeResourceRegistry()
        const rpcExchange = makeWindowRpcExchange(windowExchange(requests), registry)
        const program = runScoped(
          Effect.gen(function* () {
            const window = yield* Window
            return yield* Effect.exit(window.create(input as WindowCreateOptions))
          }),
          Layer.provide(WindowLive, makeWindowTestBridgeClientLayer(rpcExchange, registry))
        )

        const exit = yield* program

        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
        expect(requests).toEqual([])
      }
    })
  ))

test("Shell bridge client rejects empty path strings as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Shell.asEffect(),
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const showExit = yield* Effect.exit(client.showItemInFolder(""))
      const openExit = yield* Effect.exit(client.openPath(""))
      const trashExit = yield* Effect.exit(client.trashItem(""))

      expectExitFailure(showExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(trashExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Shell bridge client rejects control characters in path inputs as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Shell.asEffect(),
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const showExit = yield* Effect.exit(client.showItemInFolder("/tmp/a\u0000b"))
      const openExit = yield* Effect.exit(client.openPath("/tmp/a\u0000b.txt"))
      const trashExit = yield* Effect.exit(client.trashItem("/tmp/a\u0000b"))

      expectExitFailure(showExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(trashExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Shell bridge client rejects unsafe path argv shapes as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Shell.asEffect(),
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const showExit = yield* Effect.exit(client.showItemInFolder("/tmp/../secret"))
      const openExit = yield* Effect.exit(client.openPath("C:\\Temp\\..\\secret.txt"))
      const trashExit = yield* Effect.exit(client.trashItem("../secret"))
      const optionPrefixExit = yield* Effect.exit(client.openPath("-a"))

      expectExitFailure(showExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(trashExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(optionPrefixExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Path bridge client rejects empty canonical path strings from host as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const path = yield* Path
          return yield* Effect.exit(path.appData())
        }),
        Layer.provide(
          PathLive,
          makePathBridgeClientLayer(
            pathExchange([], () => ({ kind: "success", payload: { path: "" } }))
          )
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("Updater bridge client rejects empty version strings as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Updater.asEffect(),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const checkExit = yield* Effect.exit(client.check(updaterCheckInput("")))
      const downloadExit = yield* Effect.exit(client.download({ version: "" }))
      const installExit = yield* Effect.exit(client.install({ version: "" }))

      expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(downloadExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(installExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Updater bridge client rejects check responses missing version when available", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const checkExit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Updater
          return yield* Effect.exit(client.check(updaterCheckInput("1.0.0")))
        }),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: { available: true } }))
          )
        )
      )

      expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expect(requests).toEqual([
        expect.objectContaining({ method: "Updater.check", payload: updaterCheckInput("1.0.0") })
      ])
    })
  ))

test("Updater bridge client requires version for update-bearing status states", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const updateStates: ReadonlyArray<UpdaterStatusState> = [
        "update-available",
        "downloading",
        "downloaded",
        "installing"
      ]
      for (const state of updateStates) {
        const statusExit = yield* runScoped(
          Effect.gen(function* () {
            const client = yield* Updater
            return yield* Effect.exit(client.getStatus())
          }),
          Layer.provide(
            UpdaterLive,
            makeUpdaterBridgeClientLayer(
              updaterExchange([], () => ({
                kind: "success",
                payload: { state }
              }))
            )
          )
        )

        expectExitFailure(statusExit, (error) => hasErrorTag(error, "InvalidOutput"))
      }
    })
  ))

test("Updater bridge client rejects out-of-bounds progress values from host as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Updater
          return yield* Effect.exit(client.getStatus())
        }),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange([], () => ({
              kind: "success",
              payload: { state: "downloading", progress: 1.5 }
            }))
          )
        )
      )

      expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    })
  ))

test("Updater bridge client rejects control-byte versions as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Updater.asEffect(),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const versions = ["1.0.0\u0000dev", "1.0.0\n", "1.0.0\u007f"]

      for (const version of versions) {
        const checkExit = yield* Effect.exit(client.check(updaterCheckInput(version)))
        const downloadExit = yield* Effect.exit(client.download({ version }))
        const installExit = yield* Effect.exit(client.install({ version }))

        expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(downloadExit, (error) => hasErrorTag(error, "InvalidArgument"))
        expectExitFailure(installExit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

test("Updater bridge client rejects control-byte versions from host output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const checkRequests: HostProtocolRequestEnvelope[] = []
      const checkExit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Updater
          return yield* Effect.exit(client.check(updaterCheckInput("1.0.0")))
        }),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(checkRequests, () => ({
              kind: "success",
              payload: { available: true, version: "1.2.3\n", notes: "update" }
            }))
          )
        )
      )
      const statusRequests: HostProtocolRequestEnvelope[] = []
      const statusExit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Updater
          return yield* Effect.exit(client.getStatus())
        }),
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(statusRequests, () => ({
              kind: "success",
              payload: { state: "downloading", version: "2.0.0\u007f", progress: 0.5 }
            }))
          )
        )
      )

      expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expectExitFailure(statusExit, (error) => hasErrorTag(error, "InvalidOutput"))
      expect(checkRequests).toHaveLength(1)
      expect(statusRequests).toHaveLength(1)
    })
  ))

test("Dialog bridge client rejects empty message strings as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Dialog.asEffect(),
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )

      const messageExit = yield* Effect.exit(client.message({ level: "info", message: "" }))
      const confirmExit = yield* Effect.exit(client.confirm({ message: "" }))

      expectExitFailure(messageExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(confirmExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Dialog bridge client rejects NUL bytes in defaultPath as InvalidArgument", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Dialog.asEffect(),
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({
              kind: "success",
              payload: { paths: [] }
            }))
          )
        )
      )

      const openFileExit = yield* Effect.exit(client.openFile({ defaultPath: "/tmp/a\u0000b" }))
      const openDirExit = yield* Effect.exit(client.openDirectory({ defaultPath: "/tmp/a\u0000b" }))
      const saveFileExit = yield* Effect.exit(client.saveFile({ defaultPath: "/tmp/a\u0000b" }))

      expectExitFailure(openFileExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openDirExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(saveFileExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Dialog bridge client rejects malformed file filters before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Dialog.asEffect(),
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({
              kind: "success",
              payload: { paths: ["/canonical/file.txt"] }
            }))
          )
        )
      )

      const openFileExit = yield* Effect.exit(
        client.openFile({ filters: [{ name: "", extensions: ["txt"] }] })
      )
      const openFileBadNameExit = yield* Effect.exit(
        client.openFile({ filters: [{ name: "Docs", extensions: [""] }] })
      )
      const openFileBadExtensionExit = yield* Effect.exit(
        client.openFile({ filters: [{ name: "Docs", extensions: ["*.txt"] }] })
      )
      const openFileEmptyExtensionsExit = yield* Effect.exit(
        client.openFile({ filters: [{ name: "Docs", extensions: [] }] })
      )
      const openFileControlExtensionExit = yield* Effect.exit(
        client.openFile({ filters: [{ name: "Docs", extensions: ["txt\n"] }] })
      )
      const openFileNulExtensionExit = yield* Effect.exit(
        client.openFile({
          filters: [{ name: "Docs", extensions: [`txt${String.fromCharCode(0)}x`] }]
        })
      )

      expectExitFailure(openFileExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openFileBadNameExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openFileBadExtensionExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expectExitFailure(openFileEmptyExtensionsExit, (error) =>
        hasErrorTag(error, "InvalidArgument")
      )
      expectExitFailure(openFileControlExtensionExit, (error) =>
        hasErrorTag(error, "InvalidArgument")
      )
      expectExitFailure(openFileNulExtensionExit, (error) => hasErrorTag(error, "InvalidArgument"))
      expect(requests).toEqual([])
    })
  ))

test("Dialog bridge client rejects malformed host output paths as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly method: keyof DialogClientApi
        readonly operation: string
      }> = [
        { method: "openFile", operation: "Dialog.openFile" },
        { method: "openDirectory", operation: "Dialog.openDirectory" },
        { method: "saveFile", operation: "Dialog.saveFile" }
      ]
      const badPaths = ["/tmp/a\u0000b", ""]

      for (const badPath of badPaths) {
        for (const { method, operation } of cases) {
          const requests: HostProtocolRequestEnvelope[] = []
          const exchange = dialogExchange(requests, (request) => {
            if (request.method === "Dialog.saveFile") {
              return { kind: "success", payload: { path: badPath } }
            }
            return { kind: "success", payload: { paths: ["/tmp/good.txt", badPath] } }
          })

          const exit = yield* runScoped(
            Effect.gen(function* () {
              const dialog = yield* Dialog
              if (method === "saveFile") {
                return yield* Effect.exit(dialog.saveFile({ defaultPath: "/tmp/seed.txt" }))
              }
              if (method === "openFile") {
                return yield* Effect.exit(dialog.openFile({ defaultPath: "/tmp/seed.txt" }))
              }
              return yield* Effect.exit(dialog.openDirectory({ defaultPath: "/tmp/seed.txt" }))
            }),
            Layer.provide(DialogLive, makeDialogBridgeClientLayer(exchange))
          )

          expectExitFailure(
            exit,
            (error) =>
              hasErrorTag(error, "InvalidOutput") &&
              typeof error === "object" &&
              error !== null &&
              "operation" in error &&
              error.operation === operation
          )
          expect(requests).toEqual([
            expect.objectContaining({
              method: operation
            })
          ])
        }
      }
    })
  ))

test("Dialog bridge client runs generated methods inside the layer scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const confirmed = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Dialog
          return yield* client.confirm({ message: "Continue?" })
        }),
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, (request) => ({
              kind: "success",
              payload: request.method === "Dialog.confirm" ? { confirmed: true } : undefined
            }))
          )
        )
      )

      expect(confirmed).toBe(true)
      expect(requests).toEqual([expect.objectContaining({ method: "Dialog.confirm" })])
    })
  ))

test("Dialog bridge client rejects invalid native UI text before transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = yield* runScoped(
        Dialog.asEffect(),
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({
              kind: "success",
              payload: { paths: [] }
            }))
          )
        )
      )

      const openFileTitleExit = yield* Effect.exit(client.openFile({ title: "bad\u0000" }))
      const openDirectoryTitleExit = yield* Effect.exit(client.openDirectory({ title: "bad\n" }))
      const saveFileTitleExit = yield* Effect.exit(client.saveFile({ title: "" }))
      const messageTitleExit = yield* Effect.exit(
        client.message({ level: "info", title: "bad\u0000", message: "hello" })
      )
      const messageTextExit = yield* Effect.exit(
        client.message({ level: "info", message: "hello\nworld" })
      )
      const messageDetailExit = yield* Effect.exit(
        client.message({ level: "info", message: "hello", detail: "bad\u007f" })
      )
      const confirmTitleExit = yield* Effect.exit(
        client.confirm({ title: "bad\u0000", message: "go" })
      )
      const confirmMessageExit = yield* Effect.exit(client.confirm({ message: "go\t" }))
      const confirmLabelExit = yield* Effect.exit(
        client.confirm({ message: "go", confirmLabel: "yes\n" })
      )
      const cancelLabelExit = yield* Effect.exit(client.confirm({ message: "go", cancelLabel: "" }))

      for (const exit of [
        openFileTitleExit,
        openDirectoryTitleExit,
        saveFileTitleExit,
        messageTitleExit,
        messageTextExit,
        messageDetailExit,
        confirmTitleExit,
        confirmMessageExit,
        confirmLabelExit,
        cancelLabelExit
      ]) {
        expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
      }
      expect(requests).toEqual([])
    })
  ))

const recordVoid = (calls: string[], call: string): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    calls.push(call)
  })

const appClient = (calls: string[]): AppClientApi => ({
  quit: (input: { readonly exitCode?: number }) =>
    recordVoid(calls, `quit:${input.exitCode ?? -1}`),
  exit: (input: { readonly exitCode?: number }) =>
    recordVoid(calls, `exit:${input.exitCode ?? -1}`),
  restart: (input: { readonly args?: readonly string[] }) =>
    recordVoid(calls, `restart:${input.args?.join(" ") ?? ""}`),
  relaunch: (input: { readonly args?: readonly string[] }) =>
    recordVoid(calls, `relaunch:${input.args?.join(" ") ?? ""}`),
  focus: () => recordVoid(calls, "focus"),
  activate: () => recordVoid(calls, "activate"),
  requestSingleInstanceLock: () => Effect.succeed({ acquired: true }),
  releaseSingleInstanceLock: () => recordVoid(calls, "releaseSingleInstanceLock"),
  onSecondInstance: () =>
    Stream.make(
      new AppSecondInstanceEvent({
        activationReason: "launch",
        argv: ["app", "--second"],
        cwd: "/repo",
        traceId: "trace"
      })
    ),
  onOpenFile: () => Stream.make(new AppOpenFileEvent({ path: "/tmp/README.md" })),
  onOpenUrl: () => Stream.make(new AppOpenUrlEvent({ url: "effect-desktop://open" })),
  onBeforeQuit: () => Stream.make(new AppBeforeQuitEvent({ traceId: "trace" }))
})

const appMetadataClient = (calls: string[]): AppMetadataClientApi => ({
  getInfo: () =>
    Effect.sync(() => {
      calls.push("getInfo")
      return appMetadataInfo
    }),
  getPaths: () =>
    Effect.sync(() => {
      calls.push("getPaths")
      return appMetadataPaths
    }),
  getLaunchContext: () =>
    Effect.sync(() => {
      calls.push("getLaunchContext")
      return appMetadataLaunchContext
    }),
  events: () =>
    Stream.sync(() => {
      calls.push("events")
      return new AppMetadataEvent({ phase: "failed", reason: "host-adapter-unimplemented" })
    })
})

const associationClient = (calls: string[]): AssociationClientApi => ({
  isDefaultProtocolClient: (input) =>
    Effect.sync(() => {
      calls.push(`isDefaultProtocolClient:${input.scheme}`)
      return new AssociationProtocolStatus({ scheme: input.scheme, isDefault: false })
    }),
  setDefaultProtocolClient: (input) =>
    recordVoid(calls, `setDefaultProtocolClient:${input.scheme}`),
  getFileAssociations: (input) =>
    Effect.sync(() => {
      calls.push(`getFileAssociations:${input?.extensions?.join(",") ?? ""}`)
      return new AssociationFileAssociationsResult({
        associations: [new AssociationFileAssociation({ extension: ".txt", isDefault: false })]
      })
    }),
  events: () =>
    Stream.sync(() => {
      calls.push("events")
      return new AssociationEvent({ phase: "failed", reason: "host-adapter-unimplemented" })
    })
})

const autostartClient = (calls: string[]): AutostartClientApi => ({
  isEnabled: () =>
    Effect.sync(() => {
      calls.push("isEnabled")
      return new AutostartStatus({ enabled: false, mechanism: "linux-xdg-autostart" })
    }),
  enable: (input) =>
    Effect.sync(() => {
      calls.push(`enable:${input?.args?.join(" ") ?? ""}`)
      return new AutostartStatus({ enabled: true, mechanism: "linux-xdg-autostart" })
    }),
  disable: () =>
    Effect.sync(() => {
      calls.push("disable")
      return new AutostartStatus({ enabled: false, mechanism: "linux-xdg-autostart" })
    }),
  events: () =>
    Stream.sync(() => {
      calls.push("events")
      return new AutostartEvent({ phase: "enabled", mechanism: "linux-xdg-autostart" })
    })
})

const recentDocumentsClient = (calls: string[]): RecentDocumentsClientApi => ({
  add: (input) => recordVoid(calls, `add:${input.path.path}`),
  clear: () => recordVoid(calls, "clear"),
  list: () =>
    Effect.sync(() => {
      calls.push("list")
      return new RecentDocumentsListResult({
        documents: [new RecentDocument({ path: new CanonicalPath({ path: "/tmp/report.txt" }) })]
      })
    }),
  events: () =>
    Stream.sync(() => {
      calls.push("events")
      return new RecentDocumentsEvent({
        phase: "document-added",
        path: new CanonicalPath({ path: "/tmp/report.txt" })
      })
    })
})

const nativeFileSystemClient = (calls: string[]): NativeFileSystemClientApi => ({
  open: (input) =>
    Effect.sync(() => {
      calls.push(`open:${input.path.path}:${input.mode ?? "read"}`)
      return nativeFileSystemOpenResult("handle-1")
    }),
  stat: (input) =>
    Effect.sync(() => {
      calls.push(`stat:${input.path.path}`)
      return nativeFileSystemMetadata(input.path.path)
    }),
  watch: (input) =>
    Effect.sync(() => {
      calls.push(`watch:${input.path.path}:${input.recursive ?? false}`)
      return nativeFileSystemWatchResult(input.watchId ?? "watch-1")
    }),
  stopWatching: (input) =>
    Effect.sync(() => {
      calls.push(`stopWatching:${input.watchId}`)
      return new NativeFileSystemStopWatchingResult({ watchId: input.watchId, stopped: true })
    }),
  isSupported: () =>
    Effect.sync(() => {
      calls.push("isSupported")
      return new NativeFileSystemSupportedResult({
        supported: false,
        reason: "host-adapter-unimplemented"
      })
    }),
  events: () =>
    Stream.sync(() => {
      calls.push("events")
      return new NativeFileSystemEvent({
        type: "native-file-system-event",
        timestamp: 1710000000100,
        watchId: "watch-1",
        path: new CanonicalPath({ path: "/tmp/report.txt" }),
        phase: "changed"
      })
    })
})

const nativeFileSystemHandlePayload = (id: string) =>
  ({
    kind: "native-file-system-handle",
    id: resourceId(id),
    generation: 0,
    ownerScope: `native-file-system:${id}`,
    state: "open"
  }) as const

const nativeFileSystemWatchPayload = (id: string) =>
  ({
    kind: "native-file-system-watch",
    id: resourceId(id),
    generation: 0,
    ownerScope: "workspace:workspace-1",
    state: "open"
  }) as const

const nativeFileSystemMetadata = (path: string): NativeFileSystemMetadata =>
  new NativeFileSystemMetadata({
    path: new CanonicalPath({ path }),
    kind: "file"
  })

const nativeFileSystemOpenResult = (id: string): NativeFileSystemOpenResult =>
  new NativeFileSystemOpenResult({
    handle: nativeFileSystemHandlePayload(id),
    metadata: nativeFileSystemMetadata("/tmp/report.txt")
  })

const nativeFileSystemWatchResult = (id: string): NativeFileSystemWatchResult =>
  new NativeFileSystemWatchResult({
    watch: nativeFileSystemWatchPayload(id),
    path: new CanonicalPath({ path: "/tmp" }),
    recursive: true
  })

const webViewClient = (calls: string[]): WebViewClientApi => ({
  create: (input) =>
    Effect.sync(() => {
      calls.push(`create:${input.url}`)
      return webviewHandle
    }),
  loadRoute: (_webview, route) => recordVoid(calls, `loadRoute:${route}`),
  loadUrl: (_webview, url) => recordVoid(calls, `loadUrl:${url}`),
  reload: () => recordVoid(calls, "reload"),
  stop: () => recordVoid(calls, "stop"),
  goBack: () => recordVoid(calls, "goBack"),
  goForward: () => recordVoid(calls, "goForward"),
  getNavigationState: () =>
    Effect.sync(() => {
      calls.push("getNavigationState")
      return { canGoBack: true, canGoForward: false, loading: false }
    }),
  print: () => recordVoid(calls, "print"),
  setZoom: (_webview, zoom) => recordVoid(calls, `setZoom:${zoom}`),
  openDevTools: () => recordVoid(calls, "openDevTools"),
  closeDevTools: () => recordVoid(calls, "closeDevTools"),
  setNavigationPolicy: (_webview, policy) =>
    recordVoid(
      calls,
      `setNavigationPolicy:${policy.allowedOrigins.join(",")}:${policy.onDisallowed}`
    ),
  destroy: () => recordVoid(calls, "destroy"),
  onNavigationBlocked: () =>
    Stream.make(
      new WebViewNavigationBlockedEvent({
        webview: webviewHandle,
        url: "https://blocked.example",
        reason: "origin not allowed"
      })
    ),
  onApiCall: () =>
    Stream.make(
      new WebViewApiCallEvent({
        webview: webviewHandle,
        api: "desktop",
        method: "ping",
        payload: '{"ok":true}'
      })
    ),
  onRuntimeEvent: () =>
    Stream.make(
      new WebViewRuntimeEvent({
        webview: webviewHandle,
        phase: "drag-drop",
        paths: ["/tmp/report.txt"],
        position: { x: 12, y: 24 }
      })
    ),
  onFrameEvent: () =>
    Stream.make(
      new WebViewFrameEvent({
        webview: webviewHandle,
        frame: webviewFrameHandle,
        phase: "created",
        url: "https://example.com/frame"
      })
    )
})

const menuClient = (calls: string[]): MenuClientApi => ({
  setApplicationMenu: (template) =>
    recordVoid(calls, `setApplicationMenu:${template.items.length}`),
  setWindowMenu: (window, template) =>
    recordVoid(calls, `setWindowMenu:${window.id}:${template.items.length}`),
  clear: (input) => recordVoid(calls, `clear:${input?.window?.id ?? "application"}`),
  bindCommand: (itemId, commandId) => recordVoid(calls, `bindCommand:${itemId}:${commandId}`),
  capability: (input) => Effect.succeed({ supported: input.platform !== "linux" }),
  onActivated: () =>
    Stream.make(
      new MenuActivatedEvent({
        itemId: "file.open",
        commandId: "app.file.open",
        windowId: "window-1"
      })
    )
})

const contextMenuClient = (calls: string[]): ContextMenuClientApi => ({
  show: (input) =>
    recordVoid(
      calls,
      `show:${input.window.id}:${input.position.x}:${input.position.y}:${input.template.items.length}`
    ),
  buildFromTemplate: (input) =>
    recordVoid(calls, `buildFromTemplate:${input.template.items.length}`),
  bindCommand: (itemId, commandId) => recordVoid(calls, `bindCommand:${itemId}:${commandId}`),
  onActivated: () =>
    Stream.make(
      new ContextMenuActivatedEvent({
        itemId: "file.open",
        commandId: "app.file.open",
        windowId: "window-1"
      })
    )
})

const trayClient = (calls: string[]): TrayClientApi => ({
  create: (input) =>
    Effect.sync(() => {
      calls.push(
        `create:${input.icon}:${input.tooltip ?? ""}:${input.title ?? ""}:${input.menu?.items.length ?? 0}`
      )
      return trayHandle
    }),
  setIcon: (tray, icon) => recordVoid(calls, `setIcon:${tray.id}:${icon}`),
  setTooltip: (tray, tooltip) => recordVoid(calls, `setTooltip:${tray.id}:${tooltip}`),
  setTitle: (tray, title) => recordVoid(calls, `setTitle:${tray.id}:${title}`),
  setMenu: (tray, menu) => recordVoid(calls, `setMenu:${tray.id}:${menu.items.length}`),
  destroy: (tray) => recordVoid(calls, `destroy:${tray.id}`),
  onActivated: () =>
    Stream.make(new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" })),
  isSupported: () =>
    Effect.sync(() => {
      calls.push("isSupported")
      return new TraySupportedResult({ supported: true })
    })
})

const globalShortcutClient = (calls: string[]): GlobalShortcutClientApi => ({
  register: (accelerator, registrarWindow) =>
    recordVoid(calls, `register:${accelerator}:${registrarWindow.id}`),
  unregister: (accelerator) => recordVoid(calls, `unregister:${accelerator}`),
  unregisterAll: () => recordVoid(calls, "unregisterAll"),
  isRegistered: (accelerator) =>
    Effect.sync(() => {
      calls.push(`isRegistered:${accelerator}`)
      return new GlobalShortcutRegisteredResult({ registered: true })
    }),
  isSupported: () =>
    Effect.sync(() => {
      calls.push("isSupported")
      return new GlobalShortcutSupportedResult({ supported: true })
    }),
  onPressed: () =>
    Stream.make(
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+K",
        registrarWindowId: "window-1"
      })
    )
})

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.empty
})

const registerTestCommand = <Input>(
  commands: CommandRegistryApi,
  options: {
    readonly id: string
    readonly payload: Schema.Schema<Input>
    readonly capability: NormalizedCapability
    readonly ownerScope: string
    readonly handler: (input: Input) => Effect.Effect<void, unknown, never>
  }
) => {
  const tag = options.id
  const Command = Rpc.make(tag, {
    payload: options.payload,
    success: Schema.Void,
    error: Schema.Unknown
  }).pipe(RpcCapability(options.capability))
  const group = RpcGroup.make(Command)

  return commands.registerGroup({
    group,
    ownerScope: options.ownerScope,
    handlers: group.toLayerHandler(tag, options.handler)
  })
}

const makeCommandBindingLayer = (calls: unknown[] = []) =>
  Effect.gen(function* () {
    const resources = yield* makeResourceRegistry()
    const permissions = yield* makePermissionRegistry()
    const commands = yield* makeCommandRegistry(resources, permissions)
    yield* permissions.declare(menuCommandCapability, { source: "test" })
    yield* registerTestCommand(commands, {
      id: "app.file.open",
      payload: Schema.Struct({
        itemId: Schema.String,
        windowId: Schema.optionalKey(Schema.String)
      }),
      capability: menuCommandCapability,
      ownerScope: "app",
      handler: (input) =>
        Effect.sync(() => {
          calls.push(input)
        })
    })

    return Layer.mergeAll(
      Layer.succeed(ResourceRegistry)(resources),
      Layer.succeed(CommandRegistry)(commands)
    )
  })

const dialogClient = (calls: string[]): DialogClientApi => ({
  openFile: (input) =>
    Effect.sync(() => {
      calls.push(
        `openFile:${input?.title ?? ""}:${input?.filters?.map((filter) => filter.name).join(",") ?? ""}:${input?.multiple ?? false}`
      )
      return new DialogOpenResult({ paths: ["/canonical/file-a.txt", "/canonical/file-b.txt"] })
    }),
  openDirectory: (input) =>
    Effect.sync(() => {
      calls.push(`openDirectory:${input?.title ?? ""}`)
      return new DialogOpenResult({ paths: ["/canonical/project"] })
    }),
  saveFile: (input) =>
    Effect.sync(() => {
      calls.push(`saveFile:${input?.defaultPath ?? ""}`)
      return new DialogSaveResult({ path: "/canonical/report.txt" })
    }),
  message: (input) => recordVoid(calls, `message:${input.level}:${input.message}`),
  confirm: (input) =>
    Effect.sync(() => {
      calls.push(`confirm:${input.message}`)
      return new DialogConfirmResult({ confirmed: true })
    })
})

const clipboardClient = (calls: string[]): ClipboardClientApi => ({
  readText: () =>
    Effect.sync(() => {
      calls.push("readText")
      return new ClipboardText({ text: "hello" })
    }),
  writeText: (text) => recordVoid(calls, `writeText:${text}`),
  readHtml: () =>
    Effect.sync(() => {
      calls.push("readHtml")
      return new ClipboardHtml({ html: "<p>hello</p>" })
    }),
  writeHtml: (html) => recordVoid(calls, `writeHtml:${html}`),
  readImage: () =>
    Effect.sync(() => {
      calls.push("readImage")
      return new ClipboardImage({ mime: "image/png", bytes: pngBytes })
    }),
  writeImage: (input) => recordVoid(calls, `writeImage:${input.mime}:${input.bytes.length}`),
  clear: () => recordVoid(calls, "clear"),
  isSupported: (capability) =>
    Effect.sync(() => {
      calls.push(`isSupported:${capability}`)
      return new ClipboardSupportedResult({ supported: true })
    })
})

const notificationClient = (calls: string[]): NotificationClientApi => ({
  show: (input) =>
    Effect.sync(() => {
      calls.push(
        `show:${input.title}:${input.actions?.map((action) => action.id).join(",") ?? ""}:${input.ownerWindow?.id ?? ""}`
      )
      return notificationHandle
    }),
  close: (notification) => recordVoid(calls, `close:${notification.id}`),
  isSupported: () =>
    Effect.sync(() => {
      calls.push("isSupported")
      return new NotificationSupportedResult({ supported: true })
    }),
  requestPermission: () =>
    Effect.sync(() => {
      calls.push("requestPermission")
      return new NotificationPermissionResult({ state: "granted" })
    }),
  getPermissionStatus: () =>
    Effect.sync(() => {
      calls.push("getPermissionStatus")
      return new NotificationPermissionResult({ state: "default" })
    }),
  onClick: () =>
    Stream.make(
      new NotificationClickEvent({ notification: notificationHandle, ownerWindowId: "window-1" })
    ),
  onAction: () =>
    Stream.make(
      new NotificationActionEvent({
        notification: notificationHandle,
        actionId: "open",
        ownerWindowId: "window-1"
      })
    )
})

const pathClient = (calls: string[]): PathClientApi => ({
  appData: () => pathResult(calls, "appData", "/tmp/effect-desktop/app-data"),
  cache: () => pathResult(calls, "cache", "/tmp/effect-desktop/cache"),
  logs: () => pathResult(calls, "logs", "/tmp/effect-desktop/logs"),
  temp: () => pathResult(calls, "temp", "/tmp/effect-desktop/temp"),
  home: () => pathResult(calls, "home", "/Users/test"),
  downloads: () => pathResult(calls, "downloads", "/Users/test/Downloads")
})

const pathResult = (
  calls: string[],
  call: string,
  path: string
): Effect.Effect<CanonicalPath, never, never> =>
  Effect.sync(() => {
    calls.push(call)
    return new CanonicalPath({ path })
  })

const protocolClient = (calls: string[]): ProtocolClientApi => ({
  registerAppProtocol: (input) => recordVoid(calls, `registerAppProtocol:${input.scheme}`),
  serveAsset: (input) => recordVoid(calls, `serveAsset:${input.scheme}:${input.root}`),
  serveRoute: (input) => recordVoid(calls, `serveRoute:${input.scheme}:${input.route}`),
  deny: (input) => recordVoid(calls, `deny:${input.scheme}:${input.path}`)
})

const safeStorageClient = (calls: string[]): SafeStorageClientApi => ({
  set: (key, value) => recordVoid(calls, `set:${key}:${unsafeSecretBytes(value).byteLength}`),
  get: (key) =>
    Effect.sync(() => {
      calls.push(`get:${key}`)
      return makeSafeStorageTestSecret()
    }),
  delete: (key) => recordVoid(calls, `delete:${key}`),
  list: () =>
    Effect.sync(() => {
      calls.push("list")
      return ["token"]
    }),
  isAvailable: () =>
    Effect.sync(() => {
      calls.push("isAvailable")
      return true
    })
})

const updaterClient = (calls: string[]): UpdaterClientApi => ({
  check: (options) =>
    Effect.sync(() => {
      calls.push(`check:${options?.currentVersion ?? ""}`)
      return {
        available: true,
        version: "1.1.0",
        notes: "security update"
      }
    }),
  download: (options) =>
    Effect.sync(() => {
      calls.push(`download:${options?.version ?? ""}`)
      return updaterStatus("downloaded", options?.version ?? "1.1.0")
    }),
  install: (options) =>
    Effect.sync(() => {
      calls.push(`install:${options?.version ?? ""}`)
      return updaterStatus("installing", options?.version ?? "1.1.0")
    }),
  installAndRestart: (options) =>
    Effect.sync(() => {
      calls.push(`installAndRestart:${options?.version ?? ""}`)
      return updaterStatus("installing", options?.version ?? "1.1.0")
    }),
  getStatus: () =>
    Effect.sync(() => {
      calls.push("getStatus")
      return { state: "update-available", version: "1.1.0" }
    }),
  readyForRestart: () => recordVoid(calls, "readyForRestart"),
  onPreparingRestart: () => Stream.make(new UpdaterPreparingRestartEvent({ deadlineMs: 5_000 }))
})

const updaterStatus = (
  state: "downloaded" | "installing",
  version: string
): UpdaterStatusResult => ({ state, version })

const shellClient = (calls: string[]): ShellClientApi => ({
  openExternal: (url) => recordVoid(calls, `openExternal:${url}:`),
  showItemInFolder: (path) => recordVoid(calls, `showItemInFolder:${path}`),
  openPath: (path, options) =>
    recordVoid(calls, `openPath:${path}:${options?.allowExecutable ?? false}`),
  trashItem: (path) => recordVoid(calls, `trashItem:${path}`)
})

const screenClient = (calls: string[]): ScreenClientApi => ({
  getDisplays: () =>
    Effect.sync(() => {
      calls.push("getDisplays")
      return new ScreenDisplaysResult({ displays: [primaryDisplay] })
    }),
  getPrimaryDisplay: () =>
    Effect.sync(() => {
      calls.push("getPrimaryDisplay")
      return primaryDisplay
    }),
  getPointerPoint: () =>
    Effect.sync(() => {
      calls.push("getPointerPoint")
      return new ScreenPoint({ x: 12, y: 34 })
    }),
  onDisplaysChanged: () =>
    Stream.sync(() => {
      calls.push("onDisplaysChanged")
      return new ScreenDisplaysChangedEvent({ displays: [primaryDisplay] })
    }),
  isSupported: (method) =>
    Effect.sync(() => {
      calls.push(`isSupported:${method}`)
      return new ScreenSupportedResult({ supported: true })
    })
})

const systemAppearanceClient = (calls: string[]): SystemAppearanceClientApi => ({
  getAppearance: () =>
    Effect.sync(() => {
      calls.push("getAppearance")
      return new SystemAppearanceResult({ appearance: "dark" })
    }),
  getAccentColor: () =>
    Effect.sync(() => {
      calls.push("getAccentColor")
      return new SystemAppearanceAccentColorResult({ color: accentColor })
    }),
  getReducedMotion: () =>
    Effect.sync(() => {
      calls.push("getReducedMotion")
      return new SystemAppearanceBooleanResult({ enabled: true })
    }),
  getReducedTransparency: () =>
    Effect.sync(() => {
      calls.push("getReducedTransparency")
      return new SystemAppearanceBooleanResult({ enabled: false })
    }),
  onAppearanceChanged: () =>
    Stream.make(
      new SystemAppearanceChangedEvent({
        appearance: "highContrast",
        accentColor,
        reducedMotion: true,
        reducedTransparency: false
      })
    ),
  isSupported: (method) =>
    Effect.sync(() => {
      calls.push(`isSupported:${method}`)
      return new SystemAppearanceSupportedResult({ supported: true })
    })
})

const dockClient = (calls: string[]): DockClientApi => ({
  setBadgeCount: (count) => recordVoid(calls, `setBadgeCount:${count}`),
  setBadgeText: (text) => recordVoid(calls, `setBadgeText:${text ?? ""}`),
  setProgress: (value, options) =>
    recordVoid(calls, `setProgress:${value ?? ""}:${options?.state ?? ""}`),
  requestAttention: (options) =>
    recordVoid(calls, `requestAttention:${options?.critical ?? false}`),
  isSupported: (method) =>
    Effect.sync(() => {
      calls.push(`isSupported:${method}`)
      return new DockSupportedResult({ supported: true })
    })
})

const noopWindowClient: WindowClientApi = {
  create: () => Effect.succeed(windowHandle),
  close: () => Effect.void,
  destroy: () => Effect.void,
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  getCurrent: () => Effect.succeed(windowHandle),
  getById: () => Effect.succeed(windowHandle),
  list: () => Effect.succeed([windowHandle]),
  getParent: () => Effect.succeed(undefined),
  getChildren: () => Effect.succeed([]),
  getBounds: () => Effect.succeed(new WindowBounds({ x: 0, y: 0, width: 640, height: 480 })),
  setBounds: (_window, bounds) => Effect.succeed(new WindowBounds(bounds)),
  setBoundsOnDisplay: (_window, _displayId, bounds) => Effect.succeed(new WindowBounds(bounds)),
  center: () => Effect.succeed(new WindowBounds({ x: 0, y: 0, width: 640, height: 480 })),
  centerOnDisplay: () => Effect.succeed(new WindowBounds({ x: 0, y: 0, width: 640, height: 480 })),
  setTitle: () => Effect.void,
  setResizable: () => Effect.void,
  setDecorations: () => Effect.void,
  setTrafficLights: () => Effect.void,
  setVibrancy: () => Effect.void,
  clearVibrancy: () => Effect.void,
  setShadow: () => Effect.void,
  setTitleBarStyle: () => Effect.void,
  setTitleBarTransparent: () => Effect.void,
  setTransparent: () => Effect.void,
  setAlwaysOnTop: () => Effect.void,
  setSkipTaskbar: () => Effect.void,
  setProgress: () => Effect.void,
  requestAttention: () => Effect.void,
  cancelAttention: () => Effect.void,
  minimize: () => Effect.succeed(defaultWindowState()),
  maximize: () => Effect.succeed(defaultWindowState()),
  restore: () => Effect.succeed(defaultWindowState()),
  setFullscreen: () => Effect.succeed(defaultWindowState()),
  setSimpleFullscreen: () => Effect.succeed(defaultWindowState()),
  getState: () => Effect.succeed(defaultWindowState()),
  events: () => Stream.empty
}

const defaultWindowState = (): WindowState =>
  new WindowState({
    minimized: false,
    maximized: false,
    fullscreen: false,
    simpleFullscreen: false
  })

const handleFor = (id: string): WindowHandle => ({
  kind: "window",
  id: resourceId(id),
  generation: 0,
  ownerScope: windowScope(id),
  state: "open"
})

const windowExchange = (requests: HostProtocolRequestEnvelope[]): HostWindowExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        ...(request.method === WINDOW_CREATE_METHOD
          ? { payload: { windowId: "host-window-1" } }
          : request.method === "Window.getCurrent" || request.method === "Window.getById"
            ? { payload: { windowId: "host-window-1" } }
            : request.method === "Window.list"
              ? { payload: { windows: [{ windowId: "host-window-1" }] } }
              : request.method === WINDOW_GET_PARENT_METHOD
                ? { payload: {} }
                : request.method === WINDOW_GET_CHILDREN_METHOD
                  ? { payload: { windows: [] } }
                  : request.method === WINDOW_GET_BOUNDS_METHOD ||
                      request.method === WINDOW_SET_BOUNDS_METHOD ||
                      request.method === WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD ||
                      request.method === WINDOW_CENTER_METHOD ||
                      request.method === WINDOW_CENTER_ON_DISPLAY_METHOD
                    ? { payload: hostWindowBoundsResponseForRequest(request) }
                    : request.method === WINDOW_GET_STATE_METHOD ||
                        request.method === WINDOW_MINIMIZE_METHOD ||
                        request.method === WINDOW_MAXIMIZE_METHOD ||
                        request.method === WINDOW_RESTORE_METHOD ||
                        request.method === WINDOW_SET_FULLSCREEN_METHOD ||
                        request.method === WINDOW_SET_SIMPLE_FULLSCREEN_METHOD
                      ? {
                          payload: {
                            minimized: false,
                            maximized: true,
                            fullscreen: true,
                            simpleFullscreen: true
                          }
                        }
                      : {})
      })
    )
  }
})

interface HostWindowBoundsPayload {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const hostWindowBoundsResponseForRequest = (
  request: HostProtocolRequestEnvelope
): HostWindowBoundsPayload => {
  if (request.method === WINDOW_SET_BOUNDS_METHOD && hasHostBoundsPayload(request.payload)) {
    return request.payload.bounds
  }
  if (
    request.method === WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD &&
    hasHostDisplayBoundsPayload(request.payload)
  ) {
    return request.payload.bounds
  }
  if (request.method === WINDOW_CENTER_METHOD) {
    return { x: 50, y: 60, width: 640, height: 480 }
  }
  if (request.method === WINDOW_CENTER_ON_DISPLAY_METHOD) {
    return { x: 70, y: 80, width: 640, height: 480 }
  }
  return { x: 10, y: 20, width: 640, height: 480 }
}

const hasHostBoundsPayload = (
  payload: HostProtocolRequestEnvelope["payload"]
): payload is { readonly bounds: HostWindowBoundsPayload } =>
  typeof payload === "object" &&
  payload !== null &&
  "bounds" in payload &&
  typeof payload.bounds === "object" &&
  payload.bounds !== null

const hasHostDisplayBoundsPayload = (
  payload: HostProtocolRequestEnvelope["payload"]
): payload is { readonly bounds: HostWindowBoundsPayload; readonly displayId: string } =>
  hasHostBoundsPayload(payload) && "displayId" in payload

const appExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "App.onOpenFile"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000100,
            traceId: "event-trace",
            method,
            payload: { path: "/tmp/README.md" }
          })
        )
      : Stream.empty
})

const appMetadataExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "AppMetadata.Event"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000100,
            traceId: "event-trace",
            method,
            payload: { phase: "failed", reason: "host-adapter-unimplemented" }
          })
        )
      : Stream.empty
})

const associationExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "Association.Event"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000100,
            traceId: "event-trace",
            method,
            payload: { phase: "failed", reason: "host-adapter-unimplemented" }
          })
        )
      : Stream.empty
})

const autostartExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "Autostart.Event"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000100,
            traceId: "event-trace",
            method,
            payload: { phase: "enabled", mechanism: "linux-xdg-autostart" }
          })
        )
      : Stream.empty
})

const recentDocumentsExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse,
  eventPath = "/tmp/report.txt"
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "RecentDocuments.Event"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000100,
            traceId: "event-trace",
            method,
            payload: { phase: "document-added", path: { path: eventPath } }
          })
        )
      : Stream.empty
})

const nativeFileSystemExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "NativeFileSystem.Event"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000100,
            traceId: "event-trace",
            method,
            payload: {
              type: "native-file-system-event",
              timestamp: 1710000000100,
              watchId: "watch-1",
              path: { path: "/tmp/report.txt" },
              phase: "changed"
            }
          })
        )
      : Stream.empty
})

const webViewExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) => {
    if (method === "WebView.NavigationBlocked") {
      return Stream.make(
        new HostProtocolEventEnvelope({
          kind: "event",
          timestamp: 1710000000200,
          traceId: "event-trace",
          method,
          payload: {
            webview: webviewHandle,
            url: "https://blocked.example",
            reason: "origin not allowed"
          }
        })
      )
    }
    if (method === "WebView.ApiCall") {
      return Stream.make(
        new HostProtocolEventEnvelope({
          kind: "event",
          timestamp: 1710000000201,
          traceId: "event-trace-api",
          method,
          payload: {
            webview: webviewHandle,
            api: "desktop",
            method: "ping",
            payload: '{"ok":true}'
          }
        })
      )
    }
    if (method === WEBVIEW_RUNTIME_EVENT_METHOD) {
      return Stream.make(
        new HostProtocolEventEnvelope({
          kind: "event",
          timestamp: 1710000000202,
          traceId: "event-trace-runtime",
          method,
          payload: {
            webview: webviewHandle,
            phase: "drag-drop",
            paths: ["/tmp/report.txt"],
            position: { x: 12, y: 24 }
          }
        })
      )
    }
    if (method === WEBVIEW_FRAME_EVENT_METHOD) {
      return Stream.make(
        new HostProtocolEventEnvelope({
          kind: "event",
          timestamp: 1710000000203,
          traceId: "event-trace-frame",
          method,
          payload: {
            webview: webviewHandle,
            frame: webviewFrameHandle,
            phase: "created",
            url: "https://example.com/frame"
          }
        })
      )
    }
    return Stream.empty
  }
})

const menuExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "Menu.Activated"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000300,
            traceId: "event-trace",
            method,
            payload: {
              itemId: "file.open",
              commandId: "app.file.open",
              windowId: "window-1"
            }
          })
        )
      : Stream.empty
})

const contextMenuExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "ContextMenu.Activated"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000350,
            traceId: "event-trace",
            method,
            payload: {
              itemId: "file.open",
              commandId: "app.file.open",
              windowId: "window-1"
            }
          })
        )
      : Stream.empty
})

const trayExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "Tray.Activated"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000360,
            traceId: "event-trace",
            method,
            payload: {
              tray: trayHandle,
              ownerWindowId: "window-1"
            }
          })
        )
      : Stream.empty
})

const dialogExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const clipboardExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const notificationExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "Notification.Action"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000400,
            traceId: "event-trace",
            method,
            payload: {
              notification: notificationHandle,
              actionId: "open",
              ownerWindowId: "window-1"
            }
          })
        )
      : method === "Notification.Click"
        ? Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000401,
              traceId: "event-trace",
              method,
              payload: {
                notification: notificationHandle,
                ownerWindowId: "window-1"
              }
            })
          )
        : Stream.empty
})

const pathExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const protocolExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const safeStorageExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const updaterExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const crashReporterExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const shellExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const screenExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "Screen.DisplaysChanged"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000600,
            traceId: "event-trace",
            method,
            payload: { displays: [primaryDisplay] }
          })
        )
      : Stream.empty
})

const systemAppearanceExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "SystemAppearance.AppearanceChanged"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000700,
            traceId: "event-trace",
            method,
            payload: {
              appearance: "highContrast",
              accentColor: null,
              reducedMotion: true,
              reducedTransparency: false
            }
          })
        )
      : Stream.empty
})

const powerMonitorExchange = (): BridgeClientExchange => ({
  request: (request) =>
    request.method === "PowerMonitor.isSupported"
      ? Effect.succeed({ kind: "success", payload: { supported: true } })
      : Effect.die(`unexpected PowerMonitor request: ${request.method}`),
  subscribe: (method) =>
    method === "PowerMonitor.Suspend"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000710,
            traceId: "event-trace",
            method,
            payload: { reason: "sleep" }
          })
        )
      : method === "PowerMonitor.Resume"
        ? Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000711,
              traceId: "event-trace",
              method,
              payload: { reason: "wake" }
            })
          )
        : method === "PowerMonitor.Shutdown"
          ? Stream.make(
              new HostProtocolEventEnvelope({
                kind: "event",
                timestamp: 1710000000712,
                traceId: "event-trace",
                method,
                payload: { reason: "system" }
              })
            )
          : method === "PowerMonitor.LockScreen"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000713,
                  traceId: "event-trace",
                  method,
                  payload: { reason: "locked" }
                })
              )
            : method === "PowerMonitor.UnlockScreen"
              ? Stream.make(
                  new HostProtocolEventEnvelope({
                    kind: "event",
                    timestamp: 1710000000714,
                    traceId: "event-trace",
                    method,
                    payload: { reason: "unlocked" }
                  })
                )
              : method === "PowerMonitor.PowerSourceChanged"
                ? Stream.make(
                    new HostProtocolEventEnvelope({
                      kind: "event",
                      timestamp: 1710000000715,
                      traceId: "event-trace",
                      method,
                      payload: { source: "battery" }
                    })
                  )
                : Stream.empty
})

const dockExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const globalShortcutExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
  subscribe: (method) =>
    method === "GlobalShortcut.Pressed"
      ? Stream.make(
          new HostProtocolEventEnvelope({
            kind: "event",
            timestamp: 1710000000720,
            traceId: "event-trace",
            method,
            payload: {
              accelerator: "CmdOrCtrl+K",
              registrarWindowId: "window-1"
            }
          })
        )
      : Stream.empty
})

const makeWindowRpcExchange = (
  hostExchange: HostWindowExchange,
  registry: ResourceRegistry["Service"],
  options: HostWindowClientOptions = {},
  appEventRouter?: AppEventRouter["Service"]
): BridgeClientExchange => {
  const runtime = makeHostWindowRpcRuntime(
    hostExchange,
    {
      ...options,
      ...(appEventRouter === undefined ? {} : { appEventRouter })
    },
    { originAuth: RendererOriginAuth.unsafeDisabledForTests }
  )
  const registryLayer = Layer.succeed(ResourceRegistry)(registry)
  const permissionsLayer = Layer.effect(
    PermissionRegistry,
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      yield* permissions.declare(
        P.nativeInvoke({ primitive: "Window", methods: expectedWindowCapabilityMethods }),
        { source: "window-rpc-test", effect: "allow" }
      )
      return permissions
    }).pipe(Effect.orDie)
  )
  const request: BridgeClientExchange["request"] = (request) =>
    runScoped(
      runtime.dispatch(request),
      Layer.merge(registryLayer, permissionsLayer)
    ) as ReturnType<BridgeClientExchange["request"]>

  const subscribe: BridgeClientExchange["subscribe"] = (method) => {
    if (method !== WINDOW_EVENT_METHOD || appEventRouter === undefined) {
      return Stream.empty
    }

    return appEventRouter.windowEvents().pipe(
      Stream.map(
        (event) =>
          new HostProtocolEventEnvelope({
            kind: "event",
            method,
            timestamp: 1_710_000_002_500,
            traceId: "window-event-trace",
            payload: event
          })
      )
    )
  }

  return { request, subscribe }
}

const makeWindowTestBridgeClientLayer = (
  exchange: BridgeClientExchange,
  registry: ResourceRegistry["Service"]
): Layer.Layer<WindowClient> =>
  Layer.provide(makeWindowBridgeClientLayer(exchange), Layer.succeed(ResourceRegistry)(registry))

const rpcMethodNames = (
  namespace: string,
  group: { readonly requests: ReadonlyMap<string, unknown> }
): string[] =>
  Array.from(group.requests.keys()).map((tag) =>
    tag.startsWith(`${namespace}.`) ? tag.slice(namespace.length + 1) : tag
  )

const nextId = (ids: readonly string[]) => {
  let index = 0
  return (): string => {
    const value = ids[index]
    if (value === undefined) {
      throw new Error("test exhausted ids")
    }
    index += 1
    return value
  }
}

const nextNumber = (values: readonly number[]) => {
  let index = 0
  return (): number => {
    const value = values[index]
    if (value === undefined) {
      throw new Error("test exhausted numbers")
    }
    index += 1
    return value
  }
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: E) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(predicate(fail.error)).toBe(true)
      return
    }
  }

  throw new Error("expected typed failure")
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag
