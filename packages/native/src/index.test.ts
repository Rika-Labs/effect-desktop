import { expect, test } from "bun:test"
import {
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  HostProtocolStaleHandleError,
  Handlers,
  RendererOriginAuth,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  type ApiClientExchange,
  type ApiClientResponse,
  type HostProtocolRequestEnvelope,
  HostProtocolEventEnvelope,
  type HostWindowClientOptions,
  type HostWindowExchange
} from "@effect-desktop/bridge"
import {
  AuditEvent,
  CommandRegistryHandlerFailureError,
  CommandRegistry,
  ResourceRegistry,
  makeCommandRegistry,
  makePermissionRegistry,
  makeResourceRegistry,
  type AuditEventsApi,
  type NormalizedCapability
} from "@effect-desktop/core"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Stream } from "effect"

import {
  AppEventRouter,
  App,
  AppApi,
  AppBeforeQuitEvent,
  AppCommandLine,
  AppInfo,
  AppLive,
  AppMethodNames,
  AppOpenFileEvent,
  AppOpenUrlEvent,
  AppSecondInstanceEvent,
  Clipboard,
  ClipboardApi,
  ClipboardImage,
  ClipboardLive,
  ClipboardMethodNames,
  ClipboardSupportedResult,
  ClipboardText,
  ContextMenu,
  ContextMenuActivatedEvent,
  ContextMenuApi,
  ContextMenuBindCommandInput,
  ContextMenuLive,
  ContextMenuMethodNames,
  CrashReporter,
  CrashReporterApi,
  CrashReporterLive,
  CrashReporterMethodNames,
  Dialog,
  DialogApi,
  DialogConfirmResult,
  DialogLive,
  DialogMethodNames,
  DialogOpenResult,
  DialogSaveResult,
  Dock,
  DockApi,
  DockLive,
  DockMethodNames,
  DockSupportedResult,
  GlobalShortcut,
  GlobalShortcutApi,
  GlobalShortcutLive,
  GlobalShortcutMethodNames,
  GlobalShortcutPressedEvent,
  GlobalShortcutRegisteredResult,
  GlobalShortcutSupportedResult,
  Menu,
  MenuActivatedEvent,
  MenuApi,
  MenuLive,
  MenuMethodNames,
  MenuTemplate,
  Notification,
  NotificationActionEvent,
  NotificationApi,
  NotificationClickEvent,
  NotificationLive,
  NotificationMethodNames,
  NotificationPermissionResult,
  NotificationSupportedResult,
  Path,
  PathApi,
  PathLive,
  PathMethodNames,
  CanonicalPath,
  Protocol,
  ProtocolApi,
  ProtocolLive,
  ProtocolMethodNames,
  PowerMonitor,
  PowerMonitorApi,
  PowerMonitorLive,
  PowerMonitorMethodNames,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSuspendEvent,
  SafeStorage,
  SafeStorageApi,
  SafeStorageLive,
  SafeStorageMethodNames,
  SecretValue,
  Screen,
  ScreenApi,
  ScreenBounds,
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenLive,
  ScreenMethodNames,
  ScreenPoint,
  ScreenSupportedResult,
  Shell,
  ShellApi,
  ShellLive,
  ShellMethodNames,
  SystemAppearance,
  SystemAppearanceAccentColorResult,
  SystemAppearanceApi,
  SystemAppearanceBooleanResult,
  SystemAppearanceChangedEvent,
  SystemAppearanceColor,
  SystemAppearanceLive,
  SystemAppearanceMethodNames,
  SystemAppearanceResult,
  SystemAppearanceSupportedResult,
  Tray,
  TrayActivatedEvent,
  TrayApi,
  TrayLive,
  TrayMethodNames,
  TraySupportedResult,
  Updater,
  UpdaterApi,
  UpdaterLive,
  UpdaterMethodNames,
  UpdaterPreparingRestartEvent,
  UpdaterStatusState,
  UpdaterStatusResult,
  WebView,
  WebViewApi,
  WebViewLive,
  WebViewMethodNames,
  WebViewNavigationBlockedEvent,
  WebViewScreenshot,
  Window,
  WindowApi,
  WindowClient,
  WindowLive,
  WindowMethodNames,
  makeHostWindowApiLayer,
  makeAppEventRouter,
  makeAppBridgeClientLayer,
  makeAppServiceLayer,
  makeClipboardBridgeClientLayer,
  makeClipboardServiceLayer,
  makeContextMenuBridgeClientLayer,
  makeContextMenuServiceLayer,
  makeCrashReporterBridgeClientLayer,
  makeCrashReporterMemoryClient,
  makeCrashReporterServiceLayer,
  makeDialogBridgeClientLayer,
  makeDialogServiceLayer,
  makeDockBridgeClientLayer,
  makeDockServiceLayer,
  makeGlobalShortcutAlreadyRegisteredError,
  makeGlobalShortcutBridgeClientLayer,
  makeLinuxDockClient,
  makeLinuxGlobalShortcutClient,
  makeLinuxSafeStorageClient,
  makeGlobalShortcutServiceLayer,
  makePowerMonitorBridgeClientLayer,
  makePowerMonitorServiceLayer,
  makeScreenBridgeClientLayer,
  makeScreenServiceLayer,
  makeSystemAppearanceBridgeClientLayer,
  makeSystemAppearanceServiceLayer,
  makeUpdaterBridgeClientLayer,
  makeUpdaterServiceLayer,
  makeUnsupportedClipboardClient,
  makeUnsupportedContextMenuClient,
  makeMenuBridgeClientLayer,
  makeMenuServiceLayer,
  makeNotificationBridgeClientLayer,
  makeNotificationServiceLayer,
  makePathBridgeClientLayer,
  makePathServiceLayer,
  makeProtocolBridgeClientLayer,
  makeProtocolServiceLayer,
  makeSafeStorageBridgeClientLayer,
  makeSafeStorageServiceLayer,
  makeShellBridgeClientLayer,
  makeShellServiceLayer,
  makeUnsupportedDialogClient,
  makeUnsupportedGlobalShortcutClient,
  makeUnsupportedMenuClient,
  makeUnsupportedNotificationClient,
  makeUnsupportedPathClient,
  makeUnsupportedProtocolClient,
  makeUnsupportedSafeStorageClient,
  makeUnsupportedUpdaterClient,
  makeUnsupportedCrashReporterClient,
  makeUnsupportedDockClient,
  makeUnsupportedPowerMonitorClient,
  makeUnsupportedScreenClient,
  makeUnsupportedShellClient,
  makeUnsupportedSystemAppearanceClient,
  makeTrayBridgeClientLayer,
  makeTrayServiceLayer,
  makeUnsupportedTrayClient,
  makeUnsupportedAppClient,
  makeUnsupportedWebViewClient,
  makeWebViewBridgeClientLayer,
  makeWebViewServiceLayer,
  makeWindowBridgeClientLayer,
  makeWindowServiceLayer,
  makeUnsupportedWindowClient,
  firstResponderRoute,
  broadcastRoute,
  targetedRoute,
  windowScope,
  type AppClientApi,
  type ClipboardClientApi,
  type ContextMenuClientApi,
  type DialogClientApi,
  type DockClientApi,
  type GlobalShortcutClientApi,
  type MenuClientApi,
  type NotificationClientApi,
  type NotificationHandle,
  type PathClientApi,
  type ProtocolClientApi,
  type SafeStorageClientApi,
  type ScreenClientApi,
  type ShellClientApi,
  type SystemAppearanceClientApi,
  type TrayClientApi,
  type TrayHandle,
  type UpdaterClientApi,
  type WebViewClientApi,
  type WebViewHandle,
  type WindowClientApi,
  type WindowCreateOptions,
  type WindowHandle
} from "./index.js"
import { commandBindingWarningError } from "./command-binding-log.js"

const expectedWindowMethods: Array<(typeof WindowMethodNames)[number]> = [
  "create",
  "show",
  "hide",
  "focus",
  "close",
  "setTitle",
  "setSize",
  "setPosition",
  "setBackgroundColor",
  "setVibrancy",
  "setHasShadow",
  "setFullscreen",
  "enterFullScreen",
  "exitFullScreen",
  "onFullScreenChanged",
  "getScaleFactor",
  "onScaleChanged",
  "persistState"
]

const expectedAppMethods: Array<(typeof AppMethodNames)[number]> = [
  "getInfo",
  "getCommandLine",
  "quit",
  "restart",
  "focus",
  "requestSingleInstanceLock",
  "setOpenAtLogin",
  "registerProtocol"
]

const expectedWebViewMethods: Array<(typeof WebViewMethodNames)[number]> = [
  "create",
  "loadRoute",
  "loadUrl",
  "reload",
  "goBack",
  "goForward",
  "captureScreenshot",
  "setNavigationPolicy",
  "capability",
  "destroy"
]

const expectedMenuMethods: Array<(typeof MenuMethodNames)[number]> = [
  "setApplicationMenu",
  "setWindowMenu",
  "clear",
  "bindCommand",
  "capability"
]

const expectedContextMenuMethods: Array<(typeof ContextMenuMethodNames)[number]> = [
  "show",
  "buildFromTemplate",
  "bindCommand"
]

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
  "setMenu",
  "setJumpList",
  "requestAttention",
  "isSupported"
]

const expectedGlobalShortcutMethods: Array<(typeof GlobalShortcutMethodNames)[number]> = [
  "register",
  "unregister",
  "unregisterAll",
  "isRegistered",
  "isSupported"
]

const expectedClipboardMethods: Array<(typeof ClipboardMethodNames)[number]> = [
  "readText",
  "writeText",
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

const expectedSafeStorageMethods: Array<(typeof SafeStorageMethodNames)[number]> = [
  "set",
  "get",
  "delete",
  "list",
  "isAvailable"
]

const expectedUpdaterMethods: Array<(typeof UpdaterMethodNames)[number]> = [
  "check",
  "download",
  "install",
  "installAndRestart",
  "getStatus",
  "readyForRestart"
]

const expectedCrashReporterMethods: Array<(typeof CrashReporterMethodNames)[number]> = [
  "start",
  "recordBreadcrumb",
  "flush",
  "setUploadHandler"
]

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
  "setMenu",
  "destroy",
  "isSupported"
]

const windowHandle: WindowHandle = {
  kind: "window",
  id: "window-1",
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
  id: "webview-1",
  generation: 0,
  ownerScope: "window:window-1",
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

const notificationHandle: NotificationHandle = {
  kind: "notification",
  id: "notification-1",
  generation: 0,
  ownerScope: "window:window-1",
  state: "open"
}

const trayHandle: TrayHandle = {
  kind: "tray",
  id: "tray-1",
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

test("AppApi declares the Phase 7 App method and event surface", () => {
  expect(AppApi.tag).toBe("App")
  expect([...AppMethodNames]).toEqual(expectedAppMethods)
  expect(Object.keys(AppApi.spec)).toEqual(expectedAppMethods)
  expect(Object.keys(AppApi.events)).toEqual([
    "onSecondInstance",
    "onOpenFile",
    "onOpenUrl",
    "onBeforeQuit"
  ])
})

test("App service delegates through a substitutable AppClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* App
      const info = yield* app.getInfo()
      const commandLine = yield* app.getCommandLine()
      yield* app.focus()
      yield* app.quit()
      yield* app.restart({ args: ["--restarted"] })
      yield* app.setOpenAtLogin({ enabled: true, args: ["--hidden"] })
      yield* app.registerProtocol({ scheme: "effect-desktop" })
      const protocolEvents = yield* app.onProtocolUrl().pipe(Stream.take(1), Stream.runCollect)

      return { commandLine, info, protocolEvents }
    }).pipe(Effect.provide(makeAppServiceLayer(appClient(calls))))
  )

  expect(result.info).toEqual(
    new AppInfo({
      id: "dev.effect-desktop.test",
      name: "Effect Desktop Test",
      version: "0.0.0"
    })
  )
  expect(result.commandLine).toEqual(new AppCommandLine({ argv: ["app"], cwd: "/repo" }))
  expect(Array.from(result.protocolEvents)).toEqual([
    new AppOpenUrlEvent({ url: "effect-desktop://open" })
  ])
  expect(calls).toEqual([
    "getInfo",
    "getCommandLine",
    "focus",
    "quit:-1",
    "restart:--restarted",
    "setOpenAtLogin:true:--hidden",
    "registerProtocol:effect-desktop"
  ])
})

test("App bridge client sends typed host envelopes and decodes event streams", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = appExchange(requests, (request) => ({
    kind: "success",
    payload:
      request.method === "App.getInfo"
        ? {
            id: "dev.effect-desktop.test",
            name: "Effect Desktop Test",
            version: "0.0.0"
          }
        : undefined
  }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* App
      const info = yield* app.getInfo()
      yield* app.registerProtocol({ scheme: "effect-desktop" })
      const openFiles = yield* app.onOpenFile().pipe(Stream.take(1), Stream.runCollect)

      return { info, openFiles }
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(exchange, {
            nextRequestId: nextId(["info-request", "protocol-request"]),
            nextTraceId: nextId(["info-trace", "protocol-trace"]),
            now: nextNumber([1710000000000, 1710000000001])
          })
        )
      )
    )
  )

  expect(result.info).toEqual(
    new AppInfo({
      id: "dev.effect-desktop.test",
      name: "Effect Desktop Test",
      version: "0.0.0"
    })
  )
  expect(Array.from(result.openFiles)).toEqual([new AppOpenFileEvent({ path: "README.md" })])
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["App.getInfo", undefined],
    ["App.registerProtocol", { scheme: "effect-desktop" }]
  ])
})

test("App bridge client validates protocol registration scheme before host requests", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* App
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(
            appExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  await Effect.runPromise(client.registerProtocol({ scheme: "effect-desktop" }))

  const invalidSchemes = [
    "",
    "http",
    "https",
    "file",
    "app",
    "chrome",
    "view-source",
    "bad scheme",
    "app://",
    "MyApp",
    "x^@y"
  ]
  for (const scheme of invalidSchemes) {
    const exit = await Effect.runPromiseExit(client.registerProtocol({ scheme }))
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  }

  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["App.registerProtocol", { scheme: "effect-desktop" }]
  ])
})

test("App bridge client rejects malformed App.getInfo and App.getCommandLine output as InvalidOutput", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* App
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(
            appExchange(requests, (request) =>
              request.method === "App.getInfo"
                ? {
                    kind: "success",
                    payload: {
                      id: "",
                      name: "bad^@name",
                      version: "not-semver"
                    }
                  }
                : request.method === "App.getCommandLine"
                  ? { kind: "success", payload: { argv: ["app", "bad\u0000arg"], cwd: "" } }
                  : ({ kind: "success", payload: undefined } as const)
            )
          )
        )
      )
    )
  )

  const infoExit = await Effect.runPromiseExit(client.getInfo())
  const commandLineExit = await Effect.runPromiseExit(client.getCommandLine())

  expectExitFailure(infoExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expectExitFailure(commandLineExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["App.getInfo", undefined],
    ["App.getCommandLine", undefined]
  ])
})

test("App bridge client rejects malformed App lifecycle event payloads as InvalidOutput", async () => {
  const invalidUrlExchange: ApiClientExchange = {
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

  const invalidSecondInstanceExchange: ApiClientExchange = {
    request: () => Effect.succeed({ kind: "success", payload: undefined }),
    subscribe: (method) =>
      method === "App.onSecondInstance"
        ? Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000400,
              traceId: "event-trace",
              method,
              payload: { argv: ["app", "bad\u0000arg"], cwd: "", traceId: "" }
            })
          )
        : Stream.empty
  }

  const invalidBeforeQuitExchange: ApiClientExchange = {
    request: () => Effect.succeed({ kind: "success", payload: undefined }),
    subscribe: (method) =>
      method === "App.onBeforeQuit"
        ? Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              timestamp: 1710000000400,
              traceId: "",
              method,
              payload: { traceId: "" }
            })
          )
        : Stream.empty
  }

  const openUrlExit = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* App
      return yield* Effect.exit(app.onOpenUrl().pipe(Stream.take(1), Stream.runCollect))
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(invalidUrlExchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )
    )
  )

  const secondInstanceExit = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* App
      return yield* Effect.exit(app.onSecondInstance().pipe(Stream.take(1), Stream.runCollect))
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(invalidSecondInstanceExchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )
    )
  )

  const beforeQuitExit = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* App
      return yield* Effect.exit(app.onBeforeQuit().pipe(Stream.take(1), Stream.runCollect))
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(invalidBeforeQuitExchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )
    )
  )

  expectExitFailure(openUrlExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expectExitFailure(secondInstanceExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expectExitFailure(beforeQuitExit, (error) => hasErrorTag(error, "InvalidOutput"))
})

test("App bridge client rejects empty or NUL-bearing onOpenFile paths as InvalidOutput", async () => {
  const NUL = String.fromCharCode(0)
  const cases: ReadonlyArray<{ readonly payload: unknown }> = [
    { payload: { path: "" } },
    { payload: { path: `/tmp/a${NUL}b` } }
  ]

  for (const { payload } of cases) {
    const exchange: ApiClientExchange = {
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

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const app = yield* App
        return yield* Effect.exit(app.onOpenFile().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(
        Effect.provide(
          Layer.provide(
            AppLive,
            makeAppBridgeClientLayer(exchange, {
              nextRequestId: nextId(["unused"]),
              nextTraceId: nextId(["unused"]),
              now: nextNumber([1710000000000])
            })
          )
        )
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
  }
})

test("App bridge client rejects NUL bytes in restart args as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* App
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(
            appExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const restartExit = await Effect.runPromiseExit(
    client.restart({ args: ["--flag", "value\u0000broken"] })
  )
  expectExitFailure(restartExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("unsupported App client reports typed failures as Effect values", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const app = yield* App
      return yield* app.getInfo()
    }).pipe(Effect.provide(makeAppServiceLayer(makeUnsupportedAppClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "App.getInfo"
  )
})

test("App bridge client rejects non-portable quit exit codes as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* App
    }).pipe(
      Effect.provide(
        Layer.provide(
          AppLive,
          makeAppBridgeClientLayer(
            appExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit256 = await Effect.runPromiseExit(client.quit({ exitCode: 256 }))
  expectExitFailure(exit256, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("WebViewApi declares the Phase 7 WebView method and event surface", () => {
  expect(WebViewApi.tag).toBe("WebView")
  expect([...WebViewMethodNames]).toEqual(expectedWebViewMethods)
  expect(Object.keys(WebViewApi.spec)).toEqual(expectedWebViewMethods)
  expect(Object.keys(WebViewApi.events)).toEqual(["NavigationBlocked"])
})

test("WebView service delegates through a substitutable WebViewClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const webview = yield* WebView
      const created = yield* webview.create()
      yield* webview.loadRoute(created, "/settings")
      yield* webview.loadUrl(created, "https://example.com")
      yield* webview.reload(created)
      yield* webview.goBack(created)
      yield* webview.goForward(created)
      const screenshot = yield* webview.captureScreenshot(created)
      yield* webview.setNavigationPolicy(created, {
        allowedOrigins: ["app://localhost"],
        onDisallowed: "block"
      })
      const linuxAutofill = yield* webview.capability("autofill", { platform: "linux" })
      const blocked = yield* webview.onNavigationBlocked().pipe(Stream.take(1), Stream.runCollect)
      yield* webview.destroy(created)

      return { blocked, created, linuxAutofill, screenshot }
    }).pipe(Effect.provide(makeWebViewServiceLayer(webViewClient(calls))))
  )

  expect(result.created).toMatchObject(webviewHandle)
  expect(result.screenshot.bytes).toEqual(new Uint8Array([1, 2, 3]))
  expect(result.linuxAutofill).toBe(false)
  expect(Array.from(result.blocked)).toEqual([
    new WebViewNavigationBlockedEvent({
      webview: webviewHandle,
      url: "https://blocked.example",
      reason: "origin not allowed"
    })
  ])
  expect(calls).toEqual([
    "create:app://localhost/",
    "loadRoute:/settings",
    "loadUrl:https://example.com",
    "reload",
    "goBack",
    "goForward",
    "captureScreenshot",
    "setNavigationPolicy:app://localhost:block",
    "destroy"
  ])
})

test("WebView bridge client sends typed host envelopes and decodes event streams", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = webViewExchange(requests, (request) => ({
    kind: "success",
    payload:
      request.method === "WebView.create"
        ? webviewHandle
        : request.method === "WebView.captureScreenshot"
          ? { mime: "image/png", bytes: pngBytes }
          : request.method === "WebView.capability"
            ? { supported: true }
            : undefined
  }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const webview = yield* WebView
      const created = yield* webview.create({
        url: "app://localhost/settings",
        originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" }
      })
      yield* webview.loadRoute(created, "/settings")
      yield* webview.setNavigationPolicy(created, {
        allowedOrigins: ["app://localhost", "https://example.com"],
        onDisallowed: "openExternal"
      })
      const screenshot = yield* webview.captureScreenshot(created)
      const canOpenDevtools = yield* webview.capability("devtools open", { platform: "windows" })
      const blocked = yield* webview.onNavigationBlocked().pipe(Stream.take(1), Stream.runCollect)

      return { blocked, canOpenDevtools, created, screenshot }
    }).pipe(
      Effect.provide(
        Layer.provide(
          WebViewLive,
          makeWebViewBridgeClientLayer(exchange, {
            nextRequestId: nextId([
              "create-request",
              "route-request",
              "policy-request",
              "screenshot-request",
              "capability-request"
            ]),
            nextTraceId: nextId([
              "create-trace",
              "route-trace",
              "policy-trace",
              "screenshot-trace",
              "capability-trace"
            ]),
            now: nextNumber([
              1710000000000, 1710000000001, 1710000000002, 1710000000003, 1710000000004
            ])
          })
        )
      )
    )
  )

  expect(result.created).toMatchObject(webviewHandle)
  expect(result.screenshot).toEqual(new WebViewScreenshot({ mime: "image/png", bytes: pngBytes }))
  expect(result.canOpenDevtools).toBe(true)
  expect(Array.from(result.blocked)).toEqual([
    new WebViewNavigationBlockedEvent({
      webview: webviewHandle,
      url: "https://blocked.example",
      reason: "origin not allowed"
    })
  ])
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [
      "WebView.create",
      {
        url: "app://localhost/settings",
        originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" }
      }
    ],
    ["WebView.loadRoute", { webview: webviewHandle, route: "/settings" }],
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
    ["WebView.captureScreenshot", { webview: webviewHandle }],
    ["WebView.capability", { name: "devtools open", platform: "windows" }]
  ])
})

test("WebView bridge client rejects control-byte navigation-blocked reasons", async () => {
  const exchange: ApiClientExchange = {
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
        : Stream.empty,
    resource: {
      dispose: () => Effect.void
    }
  }
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const webview = yield* WebView
      yield* webview.create()
      return yield* webview.onNavigationBlocked().pipe(Stream.take(1), Stream.runCollect)
    }).pipe(
      Effect.provide(
        Layer.provide(
          WebViewLive,
          makeWebViewBridgeClientLayer(exchange, { nextTraceId: () => "trace" })
        )
      )
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
})

test("WebView bridge client rejects unsafe navigation inputs before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = webViewExchange(requests, () => ({
    kind: "success",
    payload: webviewHandle
  }))
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* WebView
    }).pipe(Effect.provide(Layer.provide(WebViewLive, makeWebViewBridgeClientLayer(exchange))))
  )

  const javascriptCreateExit = await Effect.runPromiseExit(
    client.create({
      url: "javascript:alert(1)",
      originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" }
    })
  )
  const fileUrlExit = await Effect.runPromiseExit(
    client.loadUrl(webviewHandle, "file:///etc/passwd")
  )
  const traversalExit = await Effect.runPromiseExit(client.loadRoute(webviewHandle, "../secret"))
  const emptyOriginExit = await Effect.runPromiseExit(
    client.create({
      url: "app://localhost/",
      originPolicy: { allowedOrigins: [""], onDisallowed: "block" }
    })
  )
  const javascriptOriginExit = await Effect.runPromiseExit(
    client.create({
      url: "app://localhost/",
      originPolicy: { allowedOrigins: ["javascript:"], onDisallowed: "block" }
    })
  )
  const policyExit = await Effect.runPromiseExit(
    client.setNavigationPolicy(webviewHandle, {
      allowedOrigins: ["file://"],
      onDisallowed: "block"
    })
  )

  expectExitFailure(javascriptCreateExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(fileUrlExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(traversalExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(emptyOriginExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(javascriptOriginExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(policyExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("WebView bridge client rejects malformed screenshot output bytes as InvalidOutput", async () => {
  const invalidScreenshots: Array<{ readonly mime: string; readonly bytes: Uint8Array }> = [
    { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
    { mime: "image/jpeg", bytes: pngBytes },
    { mime: "image/png", bytes: new Uint8Array() }
  ]
  for (const payload of invalidScreenshots) {
    const requests: HostProtocolRequestEnvelope[] = []
    const exchange = webViewExchange(requests, (request) =>
      request.method === "WebView.captureScreenshot"
        ? { kind: "success", payload }
        : { kind: "success", payload: undefined }
    )

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const webview = yield* WebView
        return yield* webview.captureScreenshot(webviewHandle)
      }).pipe(
        Effect.provide(
          Layer.provide(
            WebViewLive,
            makeWebViewBridgeClientLayer(exchange, {
              nextRequestId: nextId(["capture-screenshot-request"]),
              nextTraceId: nextId(["capture-screenshot-trace"]),
              now: nextNumber([1710000000000])
            })
          )
        )
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(requests).toEqual([
      expect.objectContaining({
        method: "WebView.captureScreenshot",
        payload: { webview: webviewHandle }
      })
    ])
  }
})

test("unsupported WebView client reports deferred host methods as Effect values", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const webview = yield* WebView
      const linuxPdf = yield* webview.capability("PDF embedded viewer", { platform: "linux" })
      const macosProdDevtools = yield* webview.capability("devtools open", { platform: "macos" })
      const macosDevDevtools = yield* webview.capability("devtools open", {
        platform: "macos",
        mode: "dev"
      })
      const createExit = yield* Effect.exit(webview.create())

      return { createExit, linuxPdf, macosDevDevtools, macosProdDevtools }
    }).pipe(Effect.provide(makeWebViewServiceLayer(makeUnsupportedWebViewClient())))
  )

  expect(result.linuxPdf).toBe(false)
  expect(result.macosProdDevtools).toBe(false)
  expect(result.macosDevDevtools).toBe(true)
  expectExitFailure(
    result.createExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "WebView.create"
  )
})

test("WebView capability matrix reports spec-partial features as unsupported", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const webview = yield* WebView
      return {
        linuxPrint: yield* webview.capability("print", { platform: "linux" }),
        linuxPopupBlocking: yield* webview.capability("popup blocking", { platform: "linux" }),
        linuxGetUserMedia: yield* webview.capability("getUserMedia", { platform: "linux" }),
        linuxServiceWorkers: yield* webview.capability("service workers in app:", {
          platform: "linux"
        }),
        macosServiceWorkers: yield* webview.capability("service workers in app:", {
          platform: "macos"
        }),
        windowsPrint: yield* webview.capability("print", { platform: "windows" }),
        linuxPdf: yield* webview.capability("PDF embedded viewer", { platform: "linux" })
      }
    }).pipe(Effect.provide(makeWebViewServiceLayer(makeUnsupportedWebViewClient())))
  )

  expect(result.linuxPrint).toBe(false)
  expect(result.linuxPopupBlocking).toBe(false)
  expect(result.linuxGetUserMedia).toBe(false)
  expect(result.linuxServiceWorkers).toBe(false)
  expect(result.macosServiceWorkers).toBe(false)
  expect(result.windowsPrint).toBe(true)
  expect(result.linuxPdf).toBe(false)
})

test("MenuApi declares the Phase 7 Menu method and event surface", () => {
  expect(MenuApi.tag).toBe("Menu")
  expect([...MenuMethodNames]).toEqual(expectedMenuMethods)
  expect(Object.keys(MenuApi.spec)).toEqual(expectedMenuMethods)
  expect(Object.keys(MenuApi.events)).toEqual(["Activated"])
})

test("Menu service delegates through a substitutable MenuClient port", async () => {
  const calls: string[] = []
  const commandCalls: unknown[] = []
  const commandLayer = await makeCommandBindingLayer(commandCalls)
  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(Layer.mergeAll(makeMenuServiceLayer(menuClient(calls)), commandLayer)))
  )
  await Effect.runPromise(Effect.sleep("10 millis"))

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

test("Menu bridge client validates templates, sends host envelopes, and decodes activation events", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = menuExchange(requests, () => ({ kind: "success", payload: undefined }))
  const commandLayer = await makeCommandBindingLayer()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const menu = yield* Menu
      yield* menu.setApplicationMenu(applicationMenuTemplate)
      yield* menu.setWindowMenu(windowHandle, menuTemplate)
      yield* menu.bindCommand("file.open", "app.file.open")
      const activated = yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
      yield* menu.clear({ window: windowHandle })

      return { activated }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.provide(
            MenuLive,
            makeMenuBridgeClientLayer(exchange, {
              nextRequestId: nextId([
                "app-menu-request",
                "window-menu-request",
                "bind-request",
                "clear-request"
              ]),
              nextTraceId: nextId([
                "app-menu-trace",
                "window-menu-trace",
                "bind-trace",
                "clear-trace"
              ]),
              now: nextNumber([1710000000000, 1710000000001, 1710000000002, 1710000000003])
            })
          ),
          commandLayer
        )
      )
    )
  )

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
    ["Menu.bindCommand", { itemId: "file.open", commandId: "app.file.open" }],
    ["Menu.clear", { window: windowHandle }]
  ])
})

test("Menu bridge client rejects empty activation event identifiers as InvalidOutput", async () => {
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
    const exchange: ApiClientExchange = {
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
    const commandLayer = await makeCommandBindingLayer()

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const menu = yield* Menu
        return yield* Effect.exit(menu.onActivated().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(
        Effect.provide(
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
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
  }
})

test("Menu bridge client decodes activation events with no windowId field", async () => {
  const exchange: ApiClientExchange = {
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
  const commandLayer = await makeCommandBindingLayer()

  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const menu = yield* Menu
      return yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
    }).pipe(
      Effect.provide(
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
    )
  )

  expect(Array.from(events)).toEqual([
    new MenuActivatedEvent({ itemId: "file.open", commandId: "app.file.open" })
  ])
})

test("Menu bridge client returns invalid templates as typed Effect failures", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Menu
    }).pipe(
      Effect.provide(
        Layer.provide(
          MenuLive,
          makeMenuBridgeClientLayer(
            menuExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    client.setApplicationMenu({
      items: [{ type: "item", id: "file.open", commandId: "app.file.open" }]
    } as never)
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("ContextMenu identifier schemas reject control bytes in bind input and activation events", async () => {
  const bindExit = await Effect.runPromiseExit(
    Schema.decodeUnknownEffect(ContextMenuBindCommandInput)({
      itemId: "open\u0000x",
      commandId: "cmd\u0000x"
    })
  )
  const eventExit = await Effect.runPromiseExit(
    Schema.decodeUnknownEffect(ContextMenuActivatedEvent)({
      itemId: "open\u0000x",
      commandId: "cmd\u0000x",
      windowId: "win\u0000x"
    })
  )

  expect(Exit.isFailure(bindExit)).toBe(true)
  expect(Exit.isFailure(eventExit)).toBe(true)
})

test("Menu and ContextMenu schemas reject newline-bearing labels and ids", async () => {
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
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(MenuTemplate)(value) as Effect.Effect<
        MenuTemplate,
        Schema.SchemaError,
        never
      >
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(label).toBeDefined()
  }

  const bindExit = await Effect.runPromiseExit(
    Schema.decodeUnknownEffect(ContextMenuBindCommandInput)({
      itemId: "open\n",
      commandId: "cmd"
    })
  )
  const eventExit = await Effect.runPromiseExit(
    Schema.decodeUnknownEffect(ContextMenuActivatedEvent)({
      itemId: "open",
      commandId: "cmd\n",
      windowId: "win-1"
    })
  )
  expect(Exit.isFailure(bindExit)).toBe(true)
  expect(Exit.isFailure(eventExit)).toBe(true)
})

test("Menu bridge client rejects NUL-bearing accelerators before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Menu
    }).pipe(
      Effect.provide(
        Layer.provide(
          MenuLive,
          makeMenuBridgeClientLayer(
            menuExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const applicationExit = await Effect.runPromiseExit(
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
  const windowExit = await Effect.runPromiseExit(
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

test("Menu bridge client rejects application menu root items before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Menu
    }).pipe(
      Effect.provide(
        Layer.provide(
          MenuLive,
          makeMenuBridgeClientLayer(
            menuExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    client.setApplicationMenu({
      items: [{ type: "item", id: "file.open", label: "Open", commandId: "app.file.open" }]
    })
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("unsupported Menu client reports capabilities as unavailable and methods as Unsupported", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const menu = yield* Menu
      const macosAppMenu = yield* menu.capability("application menu", { platform: "macos" })
      const windowsAppMenu = yield* menu.capability("application menu", { platform: "windows" })
      const linuxAppMenu = yield* menu.capability("application menu", { platform: "linux" })
      const setExit = yield* Effect.exit(menu.setApplicationMenu(menuTemplate))

      return { linuxAppMenu, macosAppMenu, setExit, windowsAppMenu }
    }).pipe(Effect.provide(makeMenuServiceLayer(makeUnsupportedMenuClient())))
  )

  expect(result.macosAppMenu).toBe(false)
  expect(result.windowsAppMenu).toBe(false)
  expect(result.linuxAppMenu).toBe(false)
  expectExitFailure(
    result.setExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Menu.setApplicationMenu"
  )
})

test("ContextMenuApi declares the Phase 8 ContextMenu method and event surface", () => {
  expect(ContextMenuApi.tag).toBe("ContextMenu")
  expect([...ContextMenuMethodNames]).toEqual(expectedContextMenuMethods)
  expect(Object.keys(ContextMenuApi.spec)).toEqual(expectedContextMenuMethods)
  expect(Object.keys(ContextMenuApi.events)).toEqual(["Activated"])
})

test("ContextMenu service delegates through a substitutable ContextMenuClient port", async () => {
  const calls: string[] = []
  const commandCalls: unknown[] = []
  const commandLayer = await makeCommandBindingLayer(commandCalls)
  const result = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        Layer.mergeAll(makeContextMenuServiceLayer(contextMenuClient(calls)), commandLayer)
      )
    )
  )
  await Effect.runPromise(Effect.sleep("10 millis"))

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

test("ContextMenu bridge client validates window menu inputs and decodes activation events", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = contextMenuExchange(requests, () => ({ kind: "success", payload: undefined }))
  const commandLayer = await makeCommandBindingLayer()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const contextMenu = yield* ContextMenu
      yield* contextMenu.show({
        window: windowHandle,
        template: menuTemplate,
        position: { x: 12.5, y: 34.25 }
      })
      yield* contextMenu.bindCommand("file.open", "app.file.open")
      const activated = yield* contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect)

      return { activated }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.provide(
            ContextMenuLive,
            makeContextMenuBridgeClientLayer(exchange, {
              nextRequestId: nextId(["show-request", "bind-request"]),
              nextTraceId: nextId(["show-trace", "bind-trace"]),
              now: nextNumber([1710000000000, 1710000000001])
            })
          ),
          commandLayer
        )
      )
    )
  )

  expect(Array.from(result.activated)).toEqual([
    new ContextMenuActivatedEvent({
      itemId: "file.open",
      commandId: "app.file.open",
      windowId: "window-1"
    })
  ])
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [
      "ContextMenu.show",
      { window: windowHandle, template: menuTemplate, position: { x: 12.5, y: 34.25 } }
    ],
    ["ContextMenu.bindCommand", { itemId: "file.open", commandId: "app.file.open" }]
  ])
})

test("ContextMenu bridge client rejects invalid popup positions before transport", async () => {
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
    const exchange = contextMenuExchange(requests, () => ({ kind: "success", payload: undefined }))
    const commandLayer = await makeCommandBindingLayer()

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const contextMenu = yield* ContextMenu
        return yield* Effect.exit(
          contextMenu.show({ window: windowHandle, template: menuTemplate, position })
        )
      }).pipe(
        Effect.provide(
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
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
    expect(requests).toEqual([])
  }
})

test("ContextMenu bridge client rejects empty activation event identifiers as InvalidOutput", async () => {
  const cases: ReadonlyArray<{
    readonly payload: { itemId: string; commandId: string; windowId: string }
  }> = [
    { payload: { itemId: "", commandId: "app.file.open", windowId: "window-1" } },
    { payload: { itemId: "file.open", commandId: "", windowId: "window-1" } },
    { payload: { itemId: "file.open", commandId: "app.file.open", windowId: "" } }
  ]

  for (const { payload } of cases) {
    const exchange: ApiClientExchange = {
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
    const commandLayer = await makeCommandBindingLayer()

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const contextMenu = yield* ContextMenu
        return yield* Effect.exit(contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(
        Effect.provide(
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
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
  }
})

test("unsupported ContextMenu client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const contextMenu = yield* ContextMenu
      return yield* Effect.exit(
        contextMenu.show({ window: windowHandle, template: menuTemplate, position: { x: 0, y: 0 } })
      )
    }).pipe(Effect.provide(makeContextMenuServiceLayer(makeUnsupportedContextMenuClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "ContextMenu.show"
  )
})

test("TrayApi declares the Phase 8 Tray method and event surface", () => {
  expect(TrayApi.tag).toBe("Tray")
  expect([...TrayMethodNames]).toEqual(expectedTrayMethods)
  expect(Object.keys(TrayApi.spec)).toEqual(expectedTrayMethods)
  expect(Object.keys(TrayApi.events)).toEqual(["Activated"])
})

test("Tray service delegates through a substitutable TrayClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const tray = yield* Tray
      const created = yield* tray.create({
        icon: "app://assets/tray.png",
        tooltip: "Effect Desktop",
        menu: menuTemplate
      })
      yield* tray.setIcon(created, "app://assets/tray-active.png")
      yield* tray.setTooltip(created, "Running")
      yield* tray.setMenu(created, menuTemplate)
      const activated = yield* tray.onActivated().pipe(Stream.take(1), Stream.runCollect)
      yield* tray.destroy(created)

      return { activated, created }
    }).pipe(Effect.provide(makeTrayServiceLayer(trayClient(calls))))
  )

  expect(result.created).toEqual(trayHandle)
  expect(Array.from(result.activated)).toEqual([
    new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" })
  ])
  expect(calls).toEqual([
    "create:app://assets/tray.png:Effect Desktop:3",
    "setIcon:tray-1:app://assets/tray-active.png",
    "setTooltip:tray-1:Running",
    "setMenu:tray-1:3",
    "destroy:tray-1"
  ])
})

test("Tray bridge client sends typed host envelopes and decodes activation events", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = trayExchange(requests, (request) => ({
    kind: "success",
    payload: request.method === "Tray.create" ? trayHandle : undefined
  }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const tray = yield* Tray
      const created = yield* tray.create({
        icon: "app://assets/tray.png",
        tooltip: "Effect Desktop",
        menu: menuTemplate
      })
      yield* tray.setIcon(created, "app://assets/tray-active.png")
      yield* tray.setTooltip(created, "Running")
      yield* tray.setMenu(created, menuTemplate)
      const activated = yield* tray.onActivated().pipe(Stream.take(1), Stream.runCollect)
      yield* tray.destroy(created)

      return { activated, created }
    }).pipe(
      Effect.provide(
        Layer.provide(
          TrayLive,
          makeTrayBridgeClientLayer(exchange, {
            nextRequestId: nextId([
              "create-request",
              "set-icon-request",
              "set-tooltip-request",
              "set-menu-request",
              "destroy-request"
            ]),
            nextTraceId: nextId([
              "create-trace",
              "set-icon-trace",
              "set-tooltip-trace",
              "set-menu-trace",
              "destroy-trace"
            ]),
            now: nextNumber([
              1710000000000, 1710000000001, 1710000000002, 1710000000003, 1710000000004
            ])
          })
        )
      )
    )
  )

  expect(result.created).toMatchObject(trayHandle)
  expect(Array.from(result.activated)).toEqual([
    new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" })
  ])
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    [
      "Tray.create",
      { icon: "app://assets/tray.png", tooltip: "Effect Desktop", menu: menuTemplate }
    ],
    ["Tray.setIcon", { tray: trayHandle, icon: "app://assets/tray-active.png" }],
    ["Tray.setTooltip", { tray: trayHandle, tooltip: "Running" }],
    ["Tray.setMenu", { tray: trayHandle, menu: menuTemplate }],
    ["Tray.destroy", { tray: trayHandle }]
  ])
})

test("Tray bridge client rejects empty activation event identifiers as InvalidOutput", async () => {
  const cases: ReadonlyArray<{ readonly payload: unknown }> = [
    { payload: { tray: { ...trayHandle, id: "" }, ownerWindowId: "window-1" } },
    { payload: { tray: { ...trayHandle, kind: "" }, ownerWindowId: "window-1" } },
    { payload: { tray: { ...trayHandle, ownerScope: "" }, ownerWindowId: "window-1" } },
    { payload: { tray: trayHandle, ownerWindowId: "" } }
  ]

  for (const { payload } of cases) {
    const exchange: ApiClientExchange = {
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
          : Stream.empty,
      resource: { dispose: () => Effect.void }
    }

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const tray = yield* Tray
        return yield* Effect.exit(tray.onActivated().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(
        Effect.provide(
          Layer.provide(
            TrayLive,
            makeTrayBridgeClientLayer(exchange, {
              nextRequestId: nextId(["unused"]),
              nextTraceId: nextId(["unused"]),
              now: nextNumber([1710000000000])
            })
          )
        )
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
  }
})

test("Tray bridge client decodes activation events with no ownerWindowId field", async () => {
  const exchange: ApiClientExchange = {
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
        : Stream.empty,
    resource: { dispose: () => Effect.void }
  }

  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const tray = yield* Tray
      return yield* tray.onActivated().pipe(Stream.take(1), Stream.runCollect)
    }).pipe(
      Effect.provide(
        Layer.provide(
          TrayLive,
          makeTrayBridgeClientLayer(exchange, {
            nextRequestId: nextId(["unused"]),
            nextTraceId: nextId(["unused"]),
            now: nextNumber([1710000000000])
          })
        )
      )
    )
  )

  expect(Array.from(events)).toEqual([new TrayActivatedEvent({ tray: trayHandle })])
})

test("unsupported Tray client reports deferred host methods as Effect values", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const tray = yield* Tray
      const supported = yield* tray.isSupported()
      const createExit = yield* Effect.exit(tray.create({ icon: "app://assets/tray.png" }))
      return { createExit, supported }
    }).pipe(Effect.provide(makeTrayServiceLayer(makeUnsupportedTrayClient())))
  )

  expect(result.supported).toBe(false)
  expectExitFailure(
    result.createExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Tray.create"
  )
})

test("Tray bridge client rejects invalid icon and tooltip metadata before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Tray
    }).pipe(
      Effect.provide(
        Layer.provide(
          TrayLive,
          makeTrayBridgeClientLayer(
            trayExchange(requests, () => ({ kind: "success", payload: trayHandle }))
          )
        )
      )
    )
  )

  const emptyIconExit = await Effect.runPromiseExit(client.create({ icon: "" }))
  const fileIconExit = await Effect.runPromiseExit(client.setIcon(trayHandle, "file:///etc/passwd"))
  const emptyTooltipExit = await Effect.runPromiseExit(client.setTooltip(trayHandle, ""))
  const nulTooltipExit = await Effect.runPromiseExit(
    client.create({ icon: "app://assets/tray.png", tooltip: "tip\u0000text" })
  )

  expectExitFailure(emptyIconExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(fileIconExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(emptyTooltipExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(nulTooltipExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Tray bridge client rejects stale destroy handles before host transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Tray
    }).pipe(
      Effect.provide(
        Layer.provide(
          TrayLive,
          makeTrayBridgeClientLayer(
            trayExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    client.destroy({ ...trayHandle, state: "closed" } as unknown as TrayHandle)
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("DialogApi declares the Phase 7 Dialog method surface", () => {
  expect(DialogApi.tag).toBe("Dialog")
  expect([...DialogMethodNames]).toEqual(expectedDialogMethods)
  expect(Object.keys(DialogApi.spec)).toEqual(expectedDialogMethods)
  expect(Object.keys(DialogApi.events)).toEqual([])
})

test("Dialog service delegates through a substitutable DialogClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeDialogServiceLayer(dialogClient(calls))))
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

test("Dialog bridge client sends typed host envelopes and decodes outputs", async () => {
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

  const result = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(exchange, {
            nextRequestId: nextId([
              "open-file-request",
              "open-directory-request",
              "save-file-request",
              "message-request",
              "confirm-request"
            ]),
            nextTraceId: nextId([
              "open-file-trace",
              "open-directory-trace",
              "save-file-trace",
              "message-trace",
              "confirm-trace"
            ]),
            now: nextNumber([
              1710000000000, 1710000000001, 1710000000002, 1710000000003, 1710000000004
            ])
          })
        )
      )
    )
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

test("Dialog bridge client returns invalid input as typed Effect failures", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dialog
    }).pipe(
      Effect.provide(
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    client.message({ level: "fatal", message: "bad" } as never)
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("unsupported Dialog client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const dialog = yield* Dialog
      return yield* Effect.exit(dialog.openFile())
    }).pipe(Effect.provide(makeDialogServiceLayer(makeUnsupportedDialogClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Dialog.openFile"
  )
})

test("ClipboardApi declares the Phase 7 Clipboard method surface", () => {
  expect(ClipboardApi.tag).toBe("Clipboard")
  expect([...ClipboardMethodNames]).toEqual(expectedClipboardMethods)
  expect(Object.keys(ClipboardApi.spec)).toEqual(expectedClipboardMethods)
  expect(Object.keys(ClipboardApi.events)).toEqual([])
})

test("Clipboard service delegates through a substitutable ClipboardClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeText("hello")
      const text = yield* clipboard.readText()
      yield* clipboard.writeImage({ mime: "image/png", bytes: pngBytes })
      const image = yield* clipboard.readImage()
      yield* clipboard.clear()

      return { image, text }
    }).pipe(Effect.provide(makeClipboardServiceLayer(clipboardClient(calls))))
  )

  expect(result.text).toBe("hello")
  expect(result.image).toEqual(new ClipboardImage({ mime: "image/png", bytes: pngBytes }))
  expect(calls).toEqual([
    "writeText:hello",
    "readText",
    "writeImage:image/png:9",
    "readImage",
    "clear"
  ])
})

test("Clipboard bridge client sends typed host envelopes and decodes outputs", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = clipboardExchange(requests, (request) => ({
    kind: "success",
    payload:
      request.method === "Clipboard.readText"
        ? { text: "from host" }
        : request.method === "Clipboard.readImage"
          ? { mime: "image/jpeg", bytes: jpegBytes }
          : undefined
  }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.writeText("to host")
      const text = yield* clipboard.readText()
      yield* clipboard.writeImage({ mime: "image/jpeg", bytes: jpegBytes })
      const image = yield* clipboard.readImage()
      yield* clipboard.clear()

      return { image, text }
    }).pipe(
      Effect.provide(
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(exchange, {
            nextRequestId: nextId([
              "write-text-request",
              "read-text-request",
              "write-image-request",
              "read-image-request",
              "clear-request"
            ]),
            nextTraceId: nextId([
              "write-text-trace",
              "read-text-trace",
              "write-image-trace",
              "read-image-trace",
              "clear-trace"
            ]),
            now: nextNumber([
              1710000000000, 1710000000001, 1710000000002, 1710000000003, 1710000000004
            ])
          })
        )
      )
    )
  )

  expect(result.text).toBe("from host")
  expect(result.image).toEqual(new ClipboardImage({ mime: "image/jpeg", bytes: jpegBytes }))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Clipboard.writeText", { text: "to host" }],
    ["Clipboard.readText", undefined],
    ["Clipboard.writeImage", { mime: "image/jpeg", bytes: jpegBytes }],
    ["Clipboard.readImage", undefined],
    ["Clipboard.clear", undefined]
  ])
})

test("Clipboard bridge client rejects mismatched image mime before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Clipboard
    }).pipe(
      Effect.provide(
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(
            clipboardExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(
    client.writeImage({ mime: "image/png", bytes: jpegBytes })
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Clipboard bridge client rejects malformed image headers from host as InvalidOutput", async () => {
  const invalidOutputs: Array<{ readonly mime: string; readonly bytes: Uint8Array }> = [
    { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
    { mime: "image/jpeg", bytes: pngBytes }
  ]

  for (const payload of invalidOutputs) {
    const requests: HostProtocolRequestEnvelope[] = []
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Clipboard
      }).pipe(
        Effect.provide(
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
      )
    )

    const exit = await Effect.runPromiseExit(client.readImage())

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(requests).toEqual([expect.objectContaining({ method: "Clipboard.readImage" })])
  }
})

test("Clipboard bridge client rejects NUL bytes in writeText as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Clipboard
    }).pipe(
      Effect.provide(
        Layer.provide(
          ClipboardLive,
          makeClipboardBridgeClientLayer(
            clipboardExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(client.writeText("hello\u0000world"))
  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])

  await Effect.runPromise(client.writeText("valid text"))
  expect(requests.length).toBe(1)
})

test("unsupported Clipboard client reports deferred host methods as Effect values", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      const textSupported = yield* clipboard.isSupported("text")
      const imageSupported = yield* clipboard.isSupported("image")
      const readExit = yield* Effect.exit(clipboard.readText())
      return { imageSupported, readExit, textSupported }
    }).pipe(Effect.provide(makeClipboardServiceLayer(makeUnsupportedClipboardClient())))
  )

  expect(result.textSupported).toBe(false)
  expect(result.imageSupported).toBe(false)
  expectExitFailure(
    result.readExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Clipboard.readText"
  )
})

test("NotificationApi declares the Phase 7 Notification method and event surface", () => {
  expect(NotificationApi.tag).toBe("Notification")
  expect([...NotificationMethodNames]).toEqual(expectedNotificationMethods)
  expect(Object.keys(NotificationApi.spec)).toEqual(expectedNotificationMethods)
  expect(Object.keys(NotificationApi.events)).toEqual(["Click", "Action"])
})

test("Notification service delegates through a substitutable NotificationClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(makeNotificationServiceLayer(notificationClient(calls))))
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

test("Notification bridge client sends typed host envelopes and decodes events", async () => {
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

  const result = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        Layer.provide(
          NotificationLive,
          makeNotificationBridgeClientLayer(exchange, {
            nextRequestId: nextId([
              "supported-request",
              "status-request",
              "permission-request",
              "show-request",
              "close-request"
            ]),
            nextTraceId: nextId([
              "supported-trace",
              "status-trace",
              "permission-trace",
              "show-trace",
              "close-trace"
            ]),
            now: nextNumber([
              1710000000000, 1710000000001, 1710000000002, 1710000000003, 1710000000004
            ])
          })
        )
      )
    )
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
    ["Notification.isSupported", undefined],
    ["Notification.getPermissionStatus", undefined],
    ["Notification.requestPermission", undefined],
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

test("Notification bridge client returns invalid input as typed Effect failures", async () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly input: Record<string, string> }> = [
    { label: "missing body", input: { title: "Missing body" } },
    { label: "control char in title", input: { title: "Build\nfinished", body: "Open results" } },
    { label: "control char in body", input: { title: "Build finished", body: "Open\nresults" } },
    { label: "DEL in title", input: { title: "Build finished\u007f", body: "Open results" } }
  ]

  for (const { label, input } of cases) {
    const requests: HostProtocolRequestEnvelope[] = []
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Notification
      }).pipe(
        Effect.provide(
          Layer.provide(
            NotificationLive,
            makeNotificationBridgeClientLayer(
              notificationExchange(requests, () => ({ kind: "success", payload: undefined }))
            )
          )
        )
      )
    )

    const exit = await Effect.runPromiseExit(client.show(input as never))

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
    expect(label).toBeDefined()
    expect(requests).toEqual([])
  }
})

test("Notification bridge client rejects invalid action ids and labels before transport", async () => {
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
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Notification
      }).pipe(
        Effect.provide(
          Layer.provide(
            NotificationLive,
            makeNotificationBridgeClientLayer(
              notificationExchange(requests, () => ({ kind: "success", payload: undefined }))
            )
          )
        )
      )
    )

    const exit = await Effect.runPromiseExit(
      client.show({ title: "Heads up", body: "Click", actions: [action] })
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
    expect(label).toBeDefined()
    expect(requests).toEqual([])
  }
})

test("Notification action stream rejects malformed actionId payloads as InvalidOutput", async () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly actionId: unknown }> = [
    { label: "empty", actionId: "" },
    { label: "control", actionId: "open\nx" }
  ]

  for (const { label, actionId } of cases) {
    const exchange: ApiClientExchange = {
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
          : Stream.empty,
      resource: { dispose: () => Effect.void }
    }

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const notification = yield* Notification
        return yield* Effect.exit(notification.onAction().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(
        Effect.provide(Layer.provide(NotificationLive, makeNotificationBridgeClientLayer(exchange)))
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(label).toBeDefined()
  }
})

test("Notification interaction streams reject blank ownerWindowId payloads as InvalidOutput", async () => {
  const cases: ReadonlyArray<{ readonly method: "Notification.Click" | "Notification.Action" }> = [
    { method: "Notification.Click" },
    { method: "Notification.Action" }
  ]

  for (const { method } of cases) {
    const exchange: ApiClientExchange = {
      request: () => Effect.succeed({ kind: "success" as const, payload: undefined }),
      subscribe: (eventMethod) =>
        eventMethod === method
          ? Stream.make(
              new HostProtocolEventEnvelope({
                kind: "event",
                timestamp: 1710000000421,
                traceId: "event-trace",
                method: eventMethod,
                payload: {
                  notification: notificationHandle,
                  ...(method === "Notification.Action" ? { actionId: "open" } : {}),
                  ownerWindowId: ""
                }
              })
            )
          : Stream.empty,
      resource: { dispose: () => Effect.void }
    }

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const notification = yield* Notification
        return yield* Effect.exit(
          method === "Notification.Click"
            ? notification.onClick().pipe(Stream.take(1), Stream.runCollect)
            : notification.onAction().pipe(Stream.take(1), Stream.runCollect)
        )
      }).pipe(
        Effect.provide(Layer.provide(NotificationLive, makeNotificationBridgeClientLayer(exchange)))
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
  }
})

test("unsupported Notification client reports deferred host methods as Effect values", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const notification = yield* Notification
      const supported = yield* notification.isSupported()
      const requestPermissionExit = yield* Effect.exit(notification.requestPermission())
      const statusExit = yield* Effect.exit(notification.getPermissionStatus())
      const showExit = yield* Effect.exit(
        notification.show({ title: "Build finished", body: "Open results" })
      )

      return { requestPermissionExit, showExit, statusExit, supported }
    }).pipe(Effect.provide(makeNotificationServiceLayer(makeUnsupportedNotificationClient())))
  )

  expect(result.supported).toBe(false)
  expectExitFailure(
    result.requestPermissionExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Notification.requestPermission"
  )
  expectExitFailure(
    result.statusExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Notification.getPermissionStatus"
  )
  expectExitFailure(
    result.showExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Notification.show"
  )
})

test("PathApi declares the Phase 7 Path method surface", () => {
  expect(PathApi.tag).toBe("Path")
  expect([...PathMethodNames]).toEqual(expectedPathMethods)
  expect(Object.keys(PathApi.spec)).toEqual(expectedPathMethods)
  expect(Object.keys(PathApi.events)).toEqual([])
})

test("Path service delegates through a substitutable PathClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(makePathServiceLayer(pathClient(calls))))
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

test("Path bridge client sends typed host envelopes and decodes canonical paths", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = pathExchange(requests, (request) => ({
    kind: "success",
    payload: { path: `/host/${request.method.replace("Path.", "")}` }
  }))

  const result = await Effect.runPromise(
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
    }).pipe(
      Effect.provide(
        Layer.provide(
          PathLive,
          makePathBridgeClientLayer(exchange, {
            nextRequestId: nextId([
              "app-data-request",
              "cache-request",
              "logs-request",
              "temp-request",
              "home-request",
              "downloads-request"
            ]),
            nextTraceId: nextId([
              "app-data-trace",
              "cache-trace",
              "logs-trace",
              "temp-trace",
              "home-trace",
              "downloads-trace"
            ]),
            now: nextNumber([
              1710000000000, 1710000000001, 1710000000002, 1710000000003, 1710000000004,
              1710000000005
            ])
          })
        )
      )
    )
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
    ["Path.appData", undefined],
    ["Path.cache", undefined],
    ["Path.logs", undefined],
    ["Path.temp", undefined],
    ["Path.home", undefined],
    ["Path.downloads", undefined]
  ])
})

test("unsupported Path client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* Path
      return yield* Effect.exit(path.appData())
    }).pipe(Effect.provide(makePathServiceLayer(makeUnsupportedPathClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Path.appData"
  )
})

test("Path bridge client rejects NUL-bearing host output as InvalidOutput", async () => {
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

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* Path
        return yield* Effect.exit(path[name]())
      }).pipe(
        Effect.provide(
          Layer.provide(
            PathLive,
            makePathBridgeClientLayer(exchange, {
              nextRequestId: nextId([`${name}-request`]),
              nextTraceId: nextId([`${name}-trace`]),
              now: nextNumber([1710000000000])
            })
          )
        )
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

test("ProtocolApi declares the Phase 8 Protocol method surface", () => {
  expect(ProtocolApi.tag).toBe("Protocol")
  expect([...ProtocolMethodNames]).toEqual(expectedProtocolMethods)
  expect(Object.keys(ProtocolApi.spec)).toEqual(expectedProtocolMethods)
  expect(Object.keys(ProtocolApi.events)).toEqual([])
})

test("Protocol service delegates through a substitutable ProtocolClient port", async () => {
  const calls: string[] = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* Protocol
      yield* protocol.registerAppProtocol({ scheme: "myapp" })
      yield* protocol.serveAsset({ scheme: "assets", root: "/app/assets" })
      yield* protocol.serveRoute({ scheme: "myapp", route: "/settings" })
      yield* protocol.deny({ scheme: "assets", path: "/private" })
    }).pipe(Effect.provide(makeProtocolServiceLayer(protocolClient(calls))))
  )

  expect(calls).toEqual([
    "registerAppProtocol:myapp",
    "serveAsset:assets:/app/assets",
    "serveRoute:myapp:/settings",
    "deny:assets:/private"
  ])
})

test("Protocol bridge client validates custom schemes and path boundaries", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Protocol
    }).pipe(
      Effect.provide(
        Layer.provide(
          ProtocolLive,
          makeProtocolBridgeClientLayer(
            protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  await Effect.runPromise(client.registerAppProtocol({ scheme: "myapp" }))
  await Effect.runPromise(client.serveAsset({ scheme: "assets", root: "/app/assets" }))
  await Effect.runPromise(client.serveRoute({ scheme: "myapp", route: "/settings" }))
  await Effect.runPromise(client.deny({ scheme: "assets", path: "/private" }))
  const reservedSchemeExit = await Effect.runPromiseExit(
    client.registerAppProtocol({ scheme: "app" })
  )
  const uppercaseSchemeExit = await Effect.runPromiseExit(
    client.registerAppProtocol({ scheme: "MyApp" })
  )
  const traversalExit = await Effect.runPromiseExit(
    client.serveRoute({ scheme: "myapp", route: "/../secret" })
  )
  const relativeDenyExit = await Effect.runPromiseExit(
    client.deny({ scheme: "assets", path: "private" })
  )

  expectExitFailure(reservedSchemeExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(uppercaseSchemeExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(traversalExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(relativeDenyExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Protocol.registerAppProtocol", { scheme: "myapp" }],
    ["Protocol.serveAsset", { scheme: "assets", root: "/app/assets" }],
    ["Protocol.serveRoute", { scheme: "myapp", route: "/settings" }],
    ["Protocol.deny", { scheme: "assets", path: "/private" }]
  ])
})

test("Protocol bridge client rejects control characters in paths as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Protocol
    }).pipe(
      Effect.provide(
        Layer.provide(
          ProtocolLive,
          makeProtocolBridgeClientLayer(
            protocolExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const newlineExit = await Effect.runPromiseExit(
    client.serveRoute({ scheme: "myapp", route: "/settings\nadmin" })
  )
  const denyExit = await Effect.runPromiseExit(
    client.deny({ scheme: "assets", path: "/private\ntoken" })
  )

  expectExitFailure(newlineExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(denyExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("unsupported Protocol client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* Protocol
      return yield* Effect.exit(protocol.registerAppProtocol({ scheme: "myapp" }))
    }).pipe(Effect.provide(makeProtocolServiceLayer(makeUnsupportedProtocolClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Protocol.registerAppProtocol"
  )
})

test("SafeStorageApi declares the Phase 8 SafeStorage method surface", () => {
  expect(SafeStorageApi.tag).toBe("SafeStorage")
  expect([...SafeStorageMethodNames]).toEqual(expectedSafeStorageMethods)
  expect(Object.keys(SafeStorageApi.spec)).toEqual(expectedSafeStorageMethods)
  expect(Object.keys(SafeStorageApi.events)).toEqual([])
})

test("SecretValue redacts string and JSON formatting while exposing explicit byte copies", async () => {
  const secret = SecretValue.fromUtf8("refresh-token")
  const bytes = secret.unsafeBytes()
  bytes.fill(0)

  expect(String(secret)).toBe("[REDACTED]")
  expect(JSON.stringify({ token: secret })).toBe('{"token":"[REDACTED]"}')
  expect(new TextDecoder().decode(secret.unsafeBytes())).toBe("refresh-token")
  await Effect.runPromise(secret.dispose())
  expect(Array.from(secret.unsafeBytes())).toEqual(
    Array.from({ length: "refresh-token".length }, () => 0)
  )
})

test("SecretValue rejects non-byte fromBytes input", () => {
  expect(() => SecretValue.fromBytes("refresh-token" as never)).toThrow(TypeError)
  const bytes = new Uint8Array([1, 2, 3])
  const secret = SecretValue.fromBytes(bytes)
  bytes.fill(0)
  expect(Array.from(secret.unsafeBytes())).toEqual([1, 2, 3])
})

test("SafeStorage service delegates through a substitutable SafeStorageClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      yield* storage.set("token", SecretValue.fromUtf8("refresh-token"))
      const secret = yield* storage.get("token")
      const keys = yield* storage.list()
      const available = yield* storage.isAvailable()
      yield* storage.delete("token")
      return { available, keys, secret }
    }).pipe(Effect.provide(makeSafeStorageServiceLayer(safeStorageClient(calls))))
  )

  expect(result.available).toBe(true)
  expect(result.keys).toEqual(["token"])
  expect(String(result.secret)).toBe("[REDACTED]")
  expect(new TextDecoder().decode(result.secret.unsafeBytes())).toBe("refresh-token")
  expect(calls).toEqual(["set:token:13", "get:token", "list", "isAvailable", "delete:token"])
})

test("SafeStorage bridge client validates keys and redacts decoded values", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = safeStorageExchange(requests, (request) => ({
    kind: "success",
    payload:
      request.method === "SafeStorage.get"
        ? { value: new TextEncoder().encode("refresh-token") }
        : request.method === "SafeStorage.list"
          ? { keys: ["token"] }
          : request.method === "SafeStorage.isAvailable"
            ? { available: true }
            : undefined
  }))
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* SafeStorage
    }).pipe(
      Effect.provide(Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange)))
    )
  )

  await Effect.runPromise(client.set("token", SecretValue.fromUtf8("refresh-token")))
  const secret = await Effect.runPromise(client.get("token"))
  const keys = await Effect.runPromise(client.list())
  const available = await Effect.runPromise(client.isAvailable())
  await Effect.runPromise(client.delete("token"))
  const emptyKeyExit = await Effect.runPromiseExit(
    client.set("", SecretValue.fromUtf8("refresh-token"))
  )

  expect(String(secret)).toBe("[REDACTED]")
  expect(JSON.stringify({ token: secret })).not.toContain("refresh-token")
  expect(new TextDecoder().decode(secret.unsafeBytes())).toBe("refresh-token")
  expect(keys).toEqual(["token"])
  expect(available).toBe(true)
  expectExitFailure(emptyKeyExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["SafeStorage.set", { key: "token", value: new TextEncoder().encode("refresh-token") }],
    ["SafeStorage.get", { key: "token" }],
    ["SafeStorage.list", undefined],
    ["SafeStorage.isAvailable", undefined],
    ["SafeStorage.delete", { key: "token" }]
  ])
})

test("SafeStorage bridge client rejects control-byte keys as InvalidArgument", async () => {
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
    const exchange = safeStorageExchange(requests, () => ({ kind: "success", payload: undefined }))
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* SafeStorage
      }).pipe(
        Effect.provide(Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange)))
      )
    )

    const setExit = await Effect.runPromiseExit(
      client.set(key, SecretValue.fromUtf8("refresh-token"))
    )
    const getExit = await Effect.runPromiseExit(client.get(key))
    const deleteExit = await Effect.runPromiseExit(client.delete(key))

    expect(label).toBeDefined()
    expectExitFailure(setExit, (error) => hasErrorTag(error, "InvalidArgument"))
    expectExitFailure(getExit, (error) => hasErrorTag(error, "InvalidArgument"))
    expectExitFailure(deleteExit, (error) => hasErrorTag(error, "InvalidArgument"))
    expect(requests).toEqual([])
  }
})

test("SafeStorage bridge client rejects invalid keys in list output as InvalidOutput", async () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly keys: ReadonlyArray<string> }> = [
    { label: "empty", keys: [""] },
    { label: "nul", keys: ["a\u0000O"] }
  ]

  for (const { label, keys } of cases) {
    const exchange = safeStorageExchange([], () => ({
      kind: "success",
      payload: { keys }
    }))
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* SafeStorage
      }).pipe(
        Effect.provide(Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange)))
      )
    )

    const exit = await Effect.runPromiseExit(client.list())
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(label).toBeDefined()
  }
})

test("SafeStorage bridge client decodes valid printable keys in list output", async () => {
  const exchange = safeStorageExchange([], () => ({
    kind: "success",
    payload: { keys: ["token", "session"] }
  }))
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* SafeStorage
    }).pipe(
      Effect.provide(Layer.provide(SafeStorageLive, makeSafeStorageBridgeClientLayer(exchange)))
    )
  )

  const keys = await Effect.runPromise(client.list())
  expect(keys).toEqual(["token", "session"])
})

test("unsupported SafeStorage client reports availability and typed command failures", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      const available = yield* storage.isAvailable()
      const listExit = yield* Effect.exit(storage.list())
      const setExit = yield* Effect.exit(storage.set("token", SecretValue.fromUtf8("secret")))
      const getExit = yield* Effect.exit(storage.get("token"))
      return { available, getExit, listExit, setExit }
    }).pipe(Effect.provide(makeSafeStorageServiceLayer(makeUnsupportedSafeStorageClient())))
  )

  expect(result.available).toBe(false)
  expectExitFailure(
    result.listExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "SafeStorage.list"
  )
  expectExitFailure(result.setExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.getExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("Linux SafeStorage client reports unimplemented adapter as unavailable with unsupported operations", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* SafeStorage
      const available = yield* storage.isAvailable()
      const setExit = yield* Effect.exit(storage.set("token", SecretValue.fromUtf8("secret")))
      const getExit = yield* Effect.exit(storage.get("token"))
      const deleteExit = yield* Effect.exit(storage.delete("token"))
      const keys = yield* storage.list()
      return { available, deleteExit, getExit, keys, setExit }
    }).pipe(Effect.provide(makeSafeStorageServiceLayer(makeLinuxSafeStorageClient())))
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

test("UpdaterApi declares the Phase 8 Updater method surface", () => {
  expect(UpdaterApi.tag).toBe("Updater")
  expect([...UpdaterMethodNames]).toEqual(expectedUpdaterMethods)
  expect(Object.keys(UpdaterApi.spec)).toEqual(expectedUpdaterMethods)
  expect(Object.keys(UpdaterApi.events)).toEqual(["PreparingRestart"])
})

test("Updater service delegates through a substitutable UpdaterClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const updater = yield* Updater
      const check = yield* updater.check({ currentVersion: "1.0.0" })
      const downloaded = yield* updater.download({ version: "1.1.0" })
      const installed = yield* updater.install({ version: "1.1.0" })
      const restarted = yield* updater.installAndRestart({ version: "1.1.0" })
      const status = yield* updater.getStatus()
      return { check, downloaded, installed, restarted, status }
    }).pipe(Effect.provide(makeUpdaterServiceLayer(updaterClient(calls))))
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

test("Updater bridge client sends typed host envelopes and decodes status values", async () => {
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
  const updater = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(Effect.provide(Layer.provide(UpdaterLive, makeUpdaterBridgeClientLayer(exchange))))
  )

  const check = await Effect.runPromise(updater.check({ currentVersion: "1.0.0" }))
  const downloaded = await Effect.runPromise(updater.download({ version: "1.1.0" }))
  const status = await Effect.runPromise(updater.getStatus())

  expect(check.available).toBe(true)
  expect(check.version).toBe("1.1.0")
  expect(downloaded.state).toBe("downloaded")
  expect(status.state).toBe("update-available")
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Updater.check", { currentVersion: "1.0.0" }],
    ["Updater.download", { version: "1.1.0" }],
    ["Updater.getStatus", undefined]
  ])
})

test("unsupported Updater client keeps consume-only status but defers install flow", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const updater = yield* Updater
      const checkExit = yield* Effect.exit(updater.check())
      const statusExit = yield* Effect.exit(updater.getStatus())
      const downloadExit = yield* Effect.exit(updater.download())
      const restartExit = yield* Effect.exit(updater.installAndRestart())
      const readyExit = yield* Effect.exit(updater.readyForRestart())
      const prepareExit = yield* updater.onPreparingRestart().pipe(Stream.runHead, Effect.exit)
      return { checkExit, downloadExit, prepareExit, readyExit, restartExit, statusExit }
    }).pipe(Effect.provide(makeUpdaterServiceLayer(makeUnsupportedUpdaterClient())))
  )

  expectExitFailure(
    result.checkExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Updater.check"
  )
  expectExitFailure(
    result.statusExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Updater.getStatus"
  )
  expectExitFailure(result.downloadExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.restartExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.readyExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.prepareExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("Updater service exposes the restart readiness handshake", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const updater = yield* Updater
      const restartStatus = yield* updater.installAndRestart({ version: "1.1.0" })
      const events = yield* updater.onPreparingRestart().pipe(Stream.take(1), Stream.runCollect)
      yield* updater.readyForRestart()
      return { events, restartStatus }
    }).pipe(Effect.provide(makeUpdaterServiceLayer(updaterClient(calls))))
  )

  expect(result.restartStatus.state).toBe("installing")
  expect(Array.from(result.events)).toEqual([
    new UpdaterPreparingRestartEvent({ deadlineMs: 5_000 })
  ])
  expect(calls).toEqual(["installAndRestart:1.1.0", "readyForRestart"])
})

test("CrashReporterApi declares the Phase 8 CrashReporter method surface", () => {
  expect(CrashReporterApi.tag).toBe("CrashReporter")
  expect([...CrashReporterMethodNames]).toEqual(expectedCrashReporterMethods)
  expect(Object.keys(CrashReporterApi.spec)).toEqual(expectedCrashReporterMethods)
  expect(Object.keys(CrashReporterApi.events)).toEqual([])
})

test("CrashReporter memory client requires start and flushes breadcrumbs to an Effect handler", async () => {
  const uploaded: Array<ReadonlyArray<{ category: string; message: string }>> = []
  const client = await Effect.runPromise(makeCrashReporterMemoryClient())
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const reporter = yield* CrashReporter
      const notStartedExit = yield* Effect.exit(
        reporter.recordBreadcrumb({ category: "user", message: "clicked save" })
      )
      yield* reporter.start({
        uploadHandler: (breadcrumbs) =>
          Effect.sync(() => {
            uploaded.push(
              breadcrumbs.map((breadcrumb) => ({
                category: breadcrumb.category,
                message: breadcrumb.message
              }))
            )
          })
      })
      yield* reporter.recordBreadcrumb({ category: "user", message: "clicked save" })
      const flush = yield* reporter.flush()
      return { flush, notStartedExit }
    }).pipe(Effect.provide(makeCrashReporterServiceLayer(client)))
  )

  expectExitFailure(result.notStartedExit, (error) => hasErrorTag(error, "InvalidState"))
  expect(result.flush.flushed).toBe(1)
  expect(uploaded).toEqual([[{ category: "user", message: "clicked save" }]])
})

test("CrashReporter memory client preserves breadcrumbs recorded during flush", async () => {
  const client = await Effect.runPromise(makeCrashReporterMemoryClient())
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.start({
        uploadHandler: () =>
          client.recordBreadcrumb({ category: "system", message: "recorded during flush" })
      })
      yield* client.recordBreadcrumb({ category: "user", message: "clicked save" })
      const firstFlush = yield* client.flush()
      const secondFlush = yield* client.flush()
      return { firstFlush, secondFlush }
    })
  )

  expect(result.firstFlush.flushed).toBe(1)
  expect(result.secondFlush.flushed).toBe(1)
})

test("CrashReporter redacts structured breadcrumb details", async () => {
  const client = await Effect.runPromise(makeCrashReporterMemoryClient())
  const uploaded: unknown[] = []

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* client.start({
        uploadHandler: (breadcrumbs) =>
          Effect.sync(() => {
            uploaded.push(...breadcrumbs)
          })
      })
      yield* client.recordBreadcrumb({
        category: "auth",
        message: "token refresh",
        details: {
          authorization: "Bearer abc",
          nested: { refresh_token: "refresh-token", safe: "visible" }
        }
      })
      yield* client.flush()
    })
  )

  expect(uploaded).toEqual([
    {
      category: "auth",
      message: "token refresh",
      details: {
        authorization: "[REDACTED]",
        nested: { refresh_token: "[REDACTED]", safe: "visible" }
      },
      timestamp: expect.any(Number)
    }
  ])
})

test("CrashReporter rejects control bytes in breadcrumb categories", async () => {
  const client = await Effect.runPromise(makeCrashReporterMemoryClient())
  await Effect.runPromise(client.start())

  const exits = await Effect.runPromise(
    Effect.gen(function* () {
      const collected: Array<Exit.Exit<unknown, unknown>> = []
      for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
        collected.push(
          yield* Effect.exit(
            client.recordBreadcrumb({
              category: `user${String.fromCharCode(codePoint)}forged`,
              message: "ok"
            })
          )
        )
      }
      collected.push(
        yield* Effect.exit(
          client.recordBreadcrumb({
            category: `user${String.fromCharCode(127)}forged`,
            message: "ok"
          })
        )
      )
      return collected
    })
  )
  for (const exit of exits) {
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  }
  await Effect.runPromise(client.recordBreadcrumb({ category: "user", message: "ok" }))
  const flushed = await Effect.runPromise(client.flush())
  expect(flushed.flushed).toBe(1)
})

test("CrashReporter rejects cyclic breadcrumb details", async () => {
  const client = await Effect.runPromise(makeCrashReporterMemoryClient())
  await Effect.runPromise(client.start())
  const cyclicDetails: { self: unknown } = { self: null }
  cyclicDetails.self = cyclicDetails

  const exit = await Effect.runPromiseExit(
    client.recordBreadcrumb({
      category: "system",
      message: "cyclic details",
      details: cyclicDetails
    })
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  const flushed = await Effect.runPromise(client.flush())
  expect(flushed.flushed).toBe(0)
})

test("CrashReporter bridge client records breadcrumbs and defers upload handlers", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = crashReporterExchange(requests, (request) => ({
    kind: "success",
    payload: request.method === "CrashReporter.flush" ? { flushed: 0 } : undefined
  }))
  const reporter = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* CrashReporter
    }).pipe(
      Effect.provide(Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)))
    )
  )

  await Effect.runPromise(reporter.start())
  await Effect.runPromise(
    reporter.recordBreadcrumb({
      category: "user",
      message: "clicked save",
      details: { authorization: "Bearer abc" }
    })
  )
  const flush = await Effect.runPromise(reporter.flush())
  const startHandlerExit = await Effect.runPromiseExit(
    reporter.start({ uploadHandler: () => Effect.void })
  )
  const handlerExit = await Effect.runPromiseExit(reporter.setUploadHandler(() => Effect.void))

  expect(flush.flushed).toBe(0)
  expectExitFailure(startHandlerExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(handlerExit, (error) => hasErrorTag(error, "Unsupported"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["CrashReporter.start", {}],
    [
      "CrashReporter.recordBreadcrumb",
      {
        category: "user",
        message: "clicked save",
        details: { authorization: "[REDACTED]" }
      }
    ],
    ["CrashReporter.flush", undefined]
  ])
})

test("CrashReporter bridge client rejects cyclic breadcrumb details before host transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = crashReporterExchange(requests, (request) => ({
    kind: "success",
    payload: request.method === "CrashReporter.flush" ? { flushed: 0 } : undefined
  }))
  const reporter = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* CrashReporter
    }).pipe(
      Effect.provide(Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange)))
    )
  )

  await Effect.runPromise(reporter.start())
  const cyclicDetails: { self: unknown } = { self: null }
  cyclicDetails.self = cyclicDetails

  const exit = await Effect.runPromiseExit(
    reporter.recordBreadcrumb({
      category: "system",
      message: "cyclic details",
      details: cyclicDetails
    })
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests.map((request) => request.method)).toEqual(["CrashReporter.start"])
})

test("CrashReporter bridge client rejects invalid flush counts as InvalidOutput", async () => {
  const cases = [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]

  for (const flushed of cases) {
    const requests: HostProtocolRequestEnvelope[] = []
    const exchange = crashReporterExchange(requests, (request) => ({
      kind: "success",
      payload: request.method === "CrashReporter.flush" ? { flushed } : undefined
    }))
    const reporter = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* CrashReporter
      }).pipe(
        Effect.provide(
          Layer.provide(CrashReporterLive, makeCrashReporterBridgeClientLayer(exchange))
        )
      )
    )

    const exit = await Effect.runPromiseExit(reporter.flush())

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(requests.map((request) => request.method)).toEqual(["CrashReporter.flush"])
  }
})

test("unsupported CrashReporter client reports every command as a typed Effect failure", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const reporter = yield* CrashReporter
      const startExit = yield* Effect.exit(reporter.start())
      const breadcrumbExit = yield* Effect.exit(
        reporter.recordBreadcrumb({ category: "user", message: "clicked save" })
      )
      const flushExit = yield* Effect.exit(reporter.flush())
      const handlerExit = yield* Effect.exit(reporter.setUploadHandler(() => Effect.void))
      return { breadcrumbExit, flushExit, handlerExit, startExit }
    }).pipe(Effect.provide(makeCrashReporterServiceLayer(makeUnsupportedCrashReporterClient())))
  )

  expectExitFailure(result.startExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.breadcrumbExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.flushExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.handlerExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("ShellApi declares the Phase 8 Shell method surface", () => {
  expect(ShellApi.tag).toBe("Shell")
  expect([...ShellMethodNames]).toEqual(expectedShellMethods)
  expect(Object.keys(ShellApi.spec)).toEqual(expectedShellMethods)
  expect(Object.keys(ShellApi.events)).toEqual([])
})

test("Shell service delegates through a substitutable ShellClient port", async () => {
  const calls: string[] = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const shell = yield* Shell
      yield* shell.openExternal("https://example.com/docs")
      yield* shell.showItemInFolder("/tmp/report.txt")
      yield* shell.openPath("/tmp/report.txt")
      yield* shell.trashItem("/tmp/old-report.txt")
    }).pipe(Effect.provide(makeShellServiceLayer(shellClient(calls))))
  )

  expect(calls).toEqual([
    "openExternal:https://example.com/docs:",
    "showItemInFolder:/tmp/report.txt",
    "openPath:/tmp/report.txt:false",
    "trashItem:/tmp/old-report.txt"
  ])
})

test("Shell bridge client validates schemes and path argv before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Shell
    }).pipe(
      Effect.provide(
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  await Effect.runPromise(client.openExternal("https://example.com/docs"))
  const fileExit = await Effect.runPromiseExit(client.openExternal("file:///etc/passwd"))
  const executableExit = await Effect.runPromiseExit(client.openPath("/tmp/install.sh"))
  const cmdExecutableExit = await Effect.runPromiseExit(client.openPath("C:\\Temp\\install.cmd"))
  const metacharExit = await Effect.runPromiseExit(client.trashItem("/tmp/a;b.txt"))
  await Effect.runPromise(client.openPath("/tmp/install.sh", { allowExecutable: true }))
  await Effect.runPromise(client.openPath("C:\\Temp\\install.cmd", { allowExecutable: true }))

  expectExitFailure(fileExit, (error) => hasErrorTag(error, "PermissionDenied"))
  expectExitFailure(executableExit, (error) => hasErrorTag(error, "PermissionDenied"))
  expectExitFailure(cmdExecutableExit, (error) => hasErrorTag(error, "PermissionDenied"))
  expectExitFailure(metacharExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Shell.openExternal", { url: "https://example.com/docs" }],
    ["Shell.openPath", { path: "/tmp/install.sh", allowExecutable: true }],
    ["Shell.openPath", { path: "C:\\Temp\\install.cmd", allowExecutable: true }]
  ])
})

test("Shell bridge client validates external URL schemes", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Shell
    }).pipe(
      Effect.provide(
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const denied = await Effect.runPromiseExit(client.openExternal("myapp://callback"))
  const javascriptDenied = await Effect.runPromiseExit(
    client.openExternal("javascript:alert(1)", { allowedSchemes: ["javascript"] } as never)
  )

  expectExitFailure(denied, (error) => hasErrorTag(error, "PermissionDenied"))
  expectExitFailure(javascriptDenied, (error) => hasErrorTag(error, "PermissionDenied"))
  expect(requests).toEqual([])
})

test("Shell bridge client rejects control characters in external URLs before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Shell
    }).pipe(
      Effect.provide(
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  for (const url of [
    "https://example.com/ok\nHeader: x",
    "https://example.com/\r",
    `https://example.com/${String.fromCharCode(0)}`
  ]) {
    const exit = await Effect.runPromiseExit(client.openExternal(url))
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  }

  expect(requests).toEqual([])
})

test("unsupported Shell client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const shell = yield* Shell
      return yield* Effect.exit(shell.openExternal("https://example.com"))
    }).pipe(Effect.provide(makeShellServiceLayer(makeUnsupportedShellClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Shell.openExternal"
  )
})

test("ScreenApi declares the Phase 8 Screen method surface", () => {
  expect(ScreenApi.tag).toBe("Screen")
  expect([...ScreenMethodNames]).toEqual(expectedScreenMethods)
  expect(Object.keys(ScreenApi.spec)).toEqual(expectedScreenMethods)
  expect(Object.keys(ScreenApi.events)).toEqual([])
})

test("Screen service delegates through a substitutable ScreenClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const screen = yield* Screen
      return {
        displays: yield* screen.getDisplays(),
        primary: yield* screen.getPrimaryDisplay(),
        pointer: yield* screen.getPointerPoint(),
        pointerSupported: yield* screen.isSupported("getPointerPoint")
      }
    }).pipe(Effect.provide(makeScreenServiceLayer(screenClient(calls))))
  )

  expect(result.displays).toEqual([primaryDisplay])
  expect(result.primary).toEqual(primaryDisplay)
  expect(result.pointer).toEqual(new ScreenPoint({ x: 12, y: 34 }))
  expect(result.pointerSupported).toBe(true)
  expect(calls).toEqual([
    "getDisplays",
    "getPrimaryDisplay",
    "getPointerPoint",
    "isSupported:getPointerPoint"
  ])
})

test("Screen bridge client sends typed host envelopes and decodes values", async () => {
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

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const screen = yield* Screen
      return {
        displays: yield* screen.getDisplays(),
        primary: yield* screen.getPrimaryDisplay(),
        pointer: yield* screen.getPointerPoint(),
        pointerSupported: yield* screen.isSupported("getPointerPoint")
      }
    }).pipe(Effect.provide(Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))))
  )

  expect(result.displays).toEqual([primaryDisplay])
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

test("Screen bridge client rejects empty display lists as InvalidOutput", async () => {
  const exchange = screenExchange([], () => ({ kind: "success", payload: { displays: [] } }))
  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* screen.getDisplays()
    }).pipe(Effect.provide(Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))))
  )

  expectExitFailure(result, (error) => hasErrorTag(error, "InvalidOutput"))
})

test("Screen bridge client rejects invalid primary display topologies as InvalidOutput", async () => {
  const multiplePrimary = {
    displays: [
      { ...primaryDisplay, id: "secondary-1", primary: true },
      { ...primaryDisplay, id: "secondary-2", primary: true }
    ]
  }
  const exchange = screenExchange([], (request) => ({
    kind: "success",
    payload: request.method === "Screen.getDisplays" ? multiplePrimary : primaryDisplay
  }))
  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* screen.getDisplays()
    }).pipe(Effect.provide(Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))))
  )

  expectExitFailure(result, (error) => hasErrorTag(error, "InvalidOutput"))
})

test("unsupported Screen client exposes support checks and typed method failures", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const screen = yield* Screen
      const supported = yield* screen.isSupported("getPointerPoint")
      const exit = yield* Effect.exit(screen.getDisplays())
      return { exit, supported }
    }).pipe(Effect.provide(makeScreenServiceLayer(makeUnsupportedScreenClient())))
  )

  expect(result.supported).toBe(false)
  expectExitFailure(result.exit, (error) => hasErrorTag(error, "Unsupported"))
})

test("SystemAppearanceApi declares the Phase 8 SystemAppearance method and event surface", () => {
  expect(SystemAppearanceApi.tag).toBe("SystemAppearance")
  expect([...SystemAppearanceMethodNames]).toEqual(expectedSystemAppearanceMethods)
  expect(Object.keys(SystemAppearanceApi.spec)).toEqual(expectedSystemAppearanceMethods)
  expect(Object.keys(SystemAppearanceApi.events)).toEqual(["AppearanceChanged"])
})

test("SystemAppearance service maps result wrappers to public values", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      return {
        mode: yield* appearance.getAppearance(),
        accent: yield* appearance.getAccentColor(),
        motion: yield* appearance.getReducedMotion(),
        transparency: yield* appearance.getReducedTransparency(),
        changed: yield* appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect),
        accentSupported: yield* appearance.isSupported("getAccentColor"),
        changeSupported: yield* appearance.isSupported("onAppearanceChanged")
      }
    }).pipe(Effect.provide(makeSystemAppearanceServiceLayer(systemAppearanceClient(calls))))
  )

  expect(result.mode).toBe("dark")
  expect(result.accent).toEqual(accentColor)
  expect(result.motion).toBe(true)
  expect(result.transparency).toBe(false)
  expect(result.accentSupported).toBe(true)
  expect(result.changeSupported).toBe(true)
  expect(Array.from(result.changed)).toEqual([
    new SystemAppearanceChangedEvent({ appearance: "highContrast" })
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

test("SystemAppearance bridge client decodes nullable accent color and events", async () => {
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

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      return {
        mode: yield* appearance.getAppearance(),
        accent: yield* appearance.getAccentColor(),
        motion: yield* appearance.getReducedMotion(),
        transparency: yield* appearance.getReducedTransparency(),
        changed: yield* appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect),
        accentSupported: yield* appearance.isSupported("getAccentColor")
      }
    }).pipe(
      Effect.provide(
        Layer.provide(SystemAppearanceLive, makeSystemAppearanceBridgeClientLayer(exchange))
      )
    )
  )

  expect(result.mode).toBe("dark")
  expect(result.accent).toBeNull()
  expect(result.motion).toBe(true)
  expect(result.transparency).toBe(false)
  expect(result.accentSupported).toBe(true)
  expect(Array.from(result.changed)).toEqual([
    new SystemAppearanceChangedEvent({ appearance: "highContrast" })
  ])
  expect(requests.map((request) => request.method)).toEqual([
    "SystemAppearance.getAppearance",
    "SystemAppearance.getAccentColor",
    "SystemAppearance.getReducedMotion",
    "SystemAppearance.getReducedTransparency",
    "SystemAppearance.isSupported"
  ])
})

test("unsupported SystemAppearance client fails reads and event stream as Unsupported", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const modeExit = yield* Effect.exit(appearance.getAppearance())
      const accentExit = yield* Effect.exit(appearance.getAccentColor())
      const motionExit = yield* Effect.exit(appearance.getReducedMotion())
      const transparencyExit = yield* Effect.exit(appearance.getReducedTransparency())
      const accentSupported = yield* appearance.isSupported("getAccentColor")
      const changeSupported = yield* appearance.isSupported("onAppearanceChanged")
      const eventExit = yield* appearance.onAppearanceChanged().pipe(Stream.runHead, Effect.exit)
      return {
        accentExit,
        accentSupported,
        changeSupported,
        eventExit,
        modeExit,
        motionExit,
        transparencyExit
      }
    }).pipe(
      Effect.provide(makeSystemAppearanceServiceLayer(makeUnsupportedSystemAppearanceClient()))
    )
  )

  expectExitFailure(result.modeExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.accentExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.motionExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.transparencyExit, (error) => hasErrorTag(error, "Unsupported"))
  expect(result.accentSupported).toBe(false)
  expect(result.changeSupported).toBe(false)
  expectExitFailure(result.eventExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("PowerMonitorApi declares the Phase 8 event-only surface", () => {
  expect(PowerMonitorApi.tag).toBe("PowerMonitor")
  expect([...PowerMonitorMethodNames]).toEqual(expectedPowerMonitorMethods)
  expect(Object.keys(PowerMonitorApi.spec)).toEqual(expectedPowerMonitorMethods)
  expect(Object.keys(PowerMonitorApi.events)).toEqual([
    "Suspend",
    "Resume",
    "Shutdown",
    "PowerSourceChanged"
  ])
})

test("PowerMonitor bridge client decodes power event streams", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const power = yield* PowerMonitor
      return {
        suspend: yield* power.onSuspend().pipe(Stream.take(1), Stream.runCollect),
        resume: yield* power.onResume().pipe(Stream.take(1), Stream.runCollect),
        shutdown: yield* power.onShutdown().pipe(Stream.take(1), Stream.runCollect),
        source: yield* power.onPowerSourceChanged().pipe(Stream.take(1), Stream.runCollect),
        sourceSupported: yield* power.isSupported("onPowerSourceChanged")
      }
    }).pipe(
      Effect.provide(
        Layer.provide(PowerMonitorLive, makePowerMonitorBridgeClientLayer(powerMonitorExchange()))
      )
    )
  )

  expect(Array.from(result.suspend)).toEqual([new PowerMonitorSuspendEvent({ reason: "sleep" })])
  expect(Array.from(result.resume)).toEqual([new PowerMonitorResumeEvent({ reason: "wake" })])
  expect(Array.from(result.shutdown)).toEqual([new PowerMonitorShutdownEvent({ reason: "system" })])
  expect(Array.from(result.source)).toEqual([
    new PowerMonitorSourceChangedEvent({ source: "battery" })
  ])
  expect(result.sourceSupported).toBe(true)
})

test("unsupported PowerMonitor client exposes support checks and typed event stream failures", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const power = yield* PowerMonitor
      const supported = yield* power.isSupported("onPowerSourceChanged")
      const exit = yield* power.onSuspend().pipe(Stream.runHead, Effect.exit)
      return { exit, supported }
    }).pipe(Effect.provide(makePowerMonitorServiceLayer(makeUnsupportedPowerMonitorClient())))
  )

  expect(result.supported).toBe(false)
  expectExitFailure(result.exit, (error) => hasErrorTag(error, "Unsupported"))
})

test("DockApi declares the Phase 8 Dock method surface", () => {
  expect(DockApi.tag).toBe("Dock")
  expect([...DockMethodNames]).toEqual(expectedDockMethods)
  expect(Object.keys(DockApi.spec)).toEqual(expectedDockMethods)
  expect(Object.keys(DockApi.events)).toEqual([])
})

test("Dock service delegates through a substitutable DockClient port", async () => {
  const calls: string[] = []
  const supported = await Effect.runPromise(
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setBadgeCount(5)
      yield* dock.setBadgeText("5")
      yield* dock.setProgress(0.5, { state: "normal" })
      yield* dock.setMenu(menuTemplate)
      yield* dock.setJumpList([{ id: "open", title: "Open", commandId: "app.open" }])
      yield* dock.requestAttention({ critical: true })
      return yield* dock.isSupported("setBadgeText")
    }).pipe(Effect.provide(makeDockServiceLayer(dockClient(calls))))
  )

  expect(supported).toBe(true)
  expect(calls).toEqual([
    "setBadgeCount:5",
    "setBadgeText:5",
    "setProgress:0.5:normal",
    "setMenu:3",
    "setJumpList:open",
    "requestAttention:true",
    "isSupported:setBadgeText"
  ])
})

test("Dock bridge client sends typed host envelopes and maps support result", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = dockExchange(requests, (request) => ({
    kind: "success",
    payload: request.method === "Dock.isSupported" ? { supported: true } : undefined
  }))

  const supported = await Effect.runPromise(
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setBadgeCount(5)
      yield* dock.setBadgeText("1")
      yield* dock.setBadgeText(null)
      yield* dock.setProgress(null)
      yield* dock.setMenu(null)
      yield* dock.setJumpList([{ id: "open", title: "Open", commandId: "app.open" }])
      yield* dock.requestAttention()
      return yield* dock.isSupported("setJumpList")
    }).pipe(Effect.provide(Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))))
  )

  expect(supported).toBe(true)
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Dock.setBadgeCount", { count: 5 }],
    ["Dock.setBadgeText", { text: "1" }],
    ["Dock.setBadgeText", { text: null }],
    ["Dock.setProgress", { value: null }],
    ["Dock.setMenu", { menu: null }],
    ["Dock.setJumpList", { items: [{ id: "open", title: "Open", commandId: "app.open" }] }],
    ["Dock.requestAttention", {}],
    ["Dock.isSupported", { method: "setJumpList" }]
  ])
})

test("Dock bridge client rejects invalid badge text before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = dockExchange(requests, () => ({
    kind: "success",
    payload: undefined
  }))

  const dock = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dock
    }).pipe(Effect.provide(Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))))
  )

  const nulExit = await Effect.runPromiseExit(dock.setBadgeText("bad\u0000text"))
  const newlineExit = await Effect.runPromiseExit(dock.setBadgeText("line\nbreak"))
  const tabExit = await Effect.runPromiseExit(dock.setBadgeText("badge\ttext"))
  const emptyExit = await Effect.runPromiseExit(dock.setBadgeText(""))

  for (const exit of [nulExit, newlineExit, tabExit, emptyExit]) {
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  }
  expect(requests).toEqual([])
})

test("Dock bridge client rejects invalid numeric state before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = dockExchange(requests, () => ({
    kind: "success",
    payload: undefined
  }))

  const dock = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dock
    }).pipe(Effect.provide(Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))))
  )

  const negativeBadgeExit = await Effect.runPromiseExit(dock.setBadgeCount(-1))
  const fractionalBadgeExit = await Effect.runPromiseExit(dock.setBadgeCount(1.5))
  const belowZeroProgressExit = await Effect.runPromiseExit(dock.setProgress(-0.5))
  const aboveOneProgressExit = await Effect.runPromiseExit(dock.setProgress(1.5))
  const invalidProgressExit = await Effect.runPromiseExit(dock.setProgress(Number.NaN))

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

test("Dock bridge client rejects malformed jump-list items before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = dockExchange(requests, () => ({
    kind: "success",
    payload: undefined
  }))
  const invalidItems: Array<
    Array<{
      readonly id: string
      readonly title: string
      readonly commandId: string
    }>
  > = [
    [{ id: "", title: "Open", commandId: "app.open" }],
    [{ id: "open", title: "", commandId: "app.open" }],
    [{ id: "open", title: "Open", commandId: "" }],
    [{ id: "open", title: "Open", commandId: "bad\u0000" }]
  ]

  const dock = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dock
    }).pipe(Effect.provide(Layer.provide(DockLive, makeDockBridgeClientLayer(exchange))))
  )

  for (const items of invalidItems) {
    const exit = await Effect.runPromiseExit(dock.setJumpList(items))
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  }
  expect(requests).toEqual([])
})

test("unsupported Dock client exposes support checks and typed command failures", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const dock = yield* Dock
      const supported = yield* dock.isSupported("setBadgeText")
      const exit = yield* Effect.exit(dock.setBadgeText("hi"))
      return { exit, supported }
    }).pipe(Effect.provide(makeDockServiceLayer(makeUnsupportedDockClient())))
  )

  expect(result.supported).toBe(false)
  expectExitFailure(result.exit, (error) => hasErrorTag(error, "Unsupported"))
})

test("Linux Dock client reports unimplemented partial methods as unsupported", async () => {
  const result = await Effect.runPromise(
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
      const menuExit = yield* Effect.exit(dock.setMenu(null))
      return {
        attentionExit,
        attentionSupported,
        badgeCountExit,
        badgeCountSupported,
        badgeTextSupported,
        menuExit,
        menuSupported,
        progressExit,
        progressSupported,
        textExit
      }
    }).pipe(Effect.provide(makeDockServiceLayer(makeLinuxDockClient())))
  )

  expect(result.badgeCountSupported).toBe(false)
  expect(result.progressSupported).toBe(false)
  expect(result.attentionSupported).toBe(false)
  expect(result.badgeTextSupported).toBe(false)
  expect(result.menuSupported).toBe(false)
  expectExitFailure(result.badgeCountExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.progressExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(result.attentionExit, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(
    result.textExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "no portable badge text on Linux"
  )
  expectExitFailure(result.menuExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("GlobalShortcutApi declares the Phase 8 GlobalShortcut method and event surface", () => {
  expect(GlobalShortcutApi.tag).toBe("GlobalShortcut")
  expect([...GlobalShortcutMethodNames]).toEqual(expectedGlobalShortcutMethods)
  expect(Object.keys(GlobalShortcutApi.spec)).toEqual(expectedGlobalShortcutMethods)
  expect(Object.keys(GlobalShortcutApi.events)).toEqual(["Pressed"])
})

test("GlobalShortcut service delegates through a substitutable GlobalShortcutClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      const supported = yield* shortcuts.isSupported()
      yield* shortcuts.register("CmdOrCtrl+K", windowHandle)
      const registered = yield* shortcuts.isRegistered("CmdOrCtrl+K")
      const pressed = yield* shortcuts.onPressed().pipe(Stream.take(1), Stream.runCollect)
      yield* shortcuts.unregister("CmdOrCtrl+K")
      yield* shortcuts.unregisterAll()

      return { pressed, registered, supported }
    }).pipe(Effect.provide(makeGlobalShortcutServiceLayer(globalShortcutClient(calls))))
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

test("GlobalShortcut bridge client sends typed host envelopes and decodes pressed events", async () => {
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

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      const supported = yield* shortcuts.isSupported()
      yield* shortcuts.register("CmdOrCtrl+K", windowHandle)
      const registered = yield* shortcuts.isRegistered("CmdOrCtrl+K")
      const pressed = yield* shortcuts.onPressed().pipe(Stream.take(1), Stream.runCollect)
      yield* shortcuts.unregister("CmdOrCtrl+K")
      yield* shortcuts.unregisterAll()

      return { pressed, registered, supported }
    }).pipe(
      Effect.provide(
        Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
      )
    )
  )

  expect(result.supported).toEqual(new GlobalShortcutSupportedResult({ supported: true }))
  expect(result.registered).toBe(true)
  expect(Array.from(result.pressed)).toEqual([
    new GlobalShortcutPressedEvent({
      accelerator: "CmdOrCtrl+K",
      registrarWindowId: "window-1"
    })
  ])
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["GlobalShortcut.isSupported", undefined],
    ["GlobalShortcut.register", { accelerator: "CmdOrCtrl+K", registrarWindow: windowHandle }],
    ["GlobalShortcut.isRegistered", { accelerator: "CmdOrCtrl+K" }],
    ["GlobalShortcut.unregister", { accelerator: "CmdOrCtrl+K" }],
    ["GlobalShortcut.unregisterAll", undefined]
  ])
})

test("GlobalShortcut bridge client rejects inconsistent isSupported output as InvalidOutput", async () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly payload: unknown }> = [
    {
      label: "true with reason",
      payload: { supported: true, reason: "wayland-no-global-shortcut" }
    },
    { label: "false without reason", payload: { supported: false } }
  ]

  for (const { label, payload } of cases) {
    const exchange = globalShortcutExchange([], () => ({ kind: "success", payload }))
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* GlobalShortcut
      }).pipe(
        Effect.provide(
          Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
        )
      )
    )

    const exit = await Effect.runPromiseExit(client.isSupported())
    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(label).toBeDefined()
  }
})

test("GlobalShortcut bridge client decodes valid isSupported outputs", async () => {
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
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const shortcuts = yield* GlobalShortcut
        return yield* shortcuts.isSupported()
      }).pipe(
        Effect.provide(
          Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
        )
      )
    )

    expect(result).toEqual(expected)
  }
})

test("GlobalShortcut bridge client rejects invalid pressed event identifiers as InvalidOutput", async () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly payload: unknown }> = [
    { label: "empty accelerator", payload: { accelerator: "", registrarWindowId: "window-1" } },
    { label: "empty windowId", payload: { accelerator: "CmdOrCtrl+K", registrarWindowId: "" } },
    {
      label: "nul accelerator",
      payload: { accelerator: "Cmd\u0000K", registrarWindowId: "window-1" }
    }
  ]

  for (const { label, payload } of cases) {
    const exchange: ApiClientExchange = {
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
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const shortcuts = yield* GlobalShortcut
        return yield* Effect.exit(shortcuts.onPressed().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(
        Effect.provide(
          Layer.provide(GlobalShortcutLive, makeGlobalShortcutBridgeClientLayer(exchange))
        )
      )
    )

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
    expect(label).toBeDefined()
  }
})

test("GlobalShortcut bridge client rejects empty and NUL-bearing accelerators as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* GlobalShortcut
    }).pipe(
      Effect.provide(
        Layer.provide(
          GlobalShortcutLive,
          makeGlobalShortcutBridgeClientLayer(
            globalShortcutExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const registerEmptyExit = await Effect.runPromiseExit(client.register("", windowHandle))
  const isRegisteredEmptyExit = await Effect.runPromiseExit(client.isRegistered(""))
  const unregisterNulExit = await Effect.runPromiseExit(client.unregister("Cmd\u0000K"))
  const registerNulExit = await Effect.runPromiseExit(client.register("Cmd\u0000K", windowHandle))

  expectExitFailure(registerEmptyExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(isRegisteredEmptyExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(unregisterNulExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(registerNulExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("GlobalShortcut bindCommand invokes CommandRegistry for matching registrar events, keeps listening after command failure, and unregisters on scope close", async () => {
  const calls: string[] = []
  const rows: AuditEvent[] = []
  const pressed = await Effect.runPromise(Queue.unbounded<GlobalShortcutPressedEvent>())
  const invoked = await Effect.runPromise(Deferred.make<void>())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(
    makePermissionRegistry({ audit: memoryAudit(rows), traceId: () => "trace-1" })
  )
  const commands = await Effect.runPromise(
    makeCommandRegistry(resources, permissions, { audit: memoryAudit(rows) })
  )
  await Effect.runPromise(permissions.declare(globalShortcutCommandCapability, { source: "test" }))
  let handlerCalls = 0
  await Effect.runPromise(
    commands.register({
      id: "openProject",
      inputSchema: Schema.Void,
      outputSchema: Schema.Void,
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
  )

  const handle = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      return yield* shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer({
            ...globalShortcutClient(calls),
            onPressed: () => Stream.fromQueue(pressed)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )
    )
  )

  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+P",
        registrarWindowId: windowHandle.id
      })
    )
  )
  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+K",
        registrarWindowId: "window-2"
      })
    )
  )
  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+K",
        registrarWindowId: windowHandle.id
      })
    )
  )
  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+K",
        registrarWindowId: windowHandle.id
      })
    )
  )
  await Effect.runPromise(Deferred.await(invoked))
  await Effect.runPromise(resources.closeScope(windowHandle.ownerScope))
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Effect.sleep("10 millis")
    })
  )

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

  expect(commandBindingWarningError(handlerFailure)).toEqual({
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

test("GlobalShortcut bindCommand invokes CommandRegistry for matching registrar events and unregisters on scope close", async () => {
  const calls: string[] = []
  const rows: AuditEvent[] = []
  const pressed = await Effect.runPromise(Queue.unbounded<GlobalShortcutPressedEvent>())
  const invoked = await Effect.runPromise(Deferred.make<void>())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(
    makePermissionRegistry({ audit: memoryAudit(rows), traceId: () => "trace-1" })
  )
  const commands = await Effect.runPromise(
    makeCommandRegistry(resources, permissions, { audit: memoryAudit(rows) })
  )
  await Effect.runPromise(permissions.declare(globalShortcutCommandCapability, { source: "test" }))
  let handlerCalls = 0
  await Effect.runPromise(
    commands.register({
      id: "openProject",
      inputSchema: Schema.Void,
      outputSchema: Schema.Void,
      capability: globalShortcutCommandCapability,
      ownerScope: windowHandle.ownerScope,
      handler: () =>
        Effect.sync(() => {
          handlerCalls += 1
        }).pipe(Effect.tap(() => Deferred.succeed(invoked, undefined)))
    })
  )

  const handle = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      return yield* shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer({
            ...globalShortcutClient(calls),
            onPressed: () => Stream.fromQueue(pressed)
          }),
          Layer.succeed(ResourceRegistry)(resources),
          Layer.succeed(CommandRegistry)(commands)
        )
      )
    )
  )

  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+P",
        registrarWindowId: windowHandle.id
      })
    )
  )
  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+K",
        registrarWindowId: "window-2"
      })
    )
  )
  await Effect.runPromise(
    Queue.offer(
      pressed,
      new GlobalShortcutPressedEvent({
        accelerator: "CmdOrCtrl+K",
        registrarWindowId: windowHandle.id
      })
    )
  )
  await Effect.runPromise(Deferred.await(invoked))
  await Effect.runPromise(resources.closeScope(windowHandle.ownerScope))
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Queue.offer(
        pressed,
        new GlobalShortcutPressedEvent({
          accelerator: "CmdOrCtrl+K",
          registrarWindowId: windowHandle.id
        })
      )
      yield* Effect.sleep("10 millis")
    })
  )

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

test("GlobalShortcut conflicts and unsupported behavior are typed Effect values", async () => {
  const bindingResources = await Effect.runPromise(makeResourceRegistry())
  const bindingPermissions = await Effect.runPromise(makePermissionRegistry())
  const bindingCommands = await Effect.runPromise(
    makeCommandRegistry(bindingResources, bindingPermissions)
  )
  const bindingCoreLayer = Layer.mergeAll(
    Layer.succeed(ResourceRegistry)(bindingResources),
    Layer.succeed(CommandRegistry)(bindingCommands)
  )
  const conflictExit = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      return yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
    }).pipe(
      Effect.provide(
        makeGlobalShortcutServiceLayer({
          ...globalShortcutClient([]),
          register: (accelerator) =>
            Effect.fail(makeGlobalShortcutAlreadyRegisteredError(accelerator))
        })
      )
    )
  )
  const bindConflictExit = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      return yield* Effect.exit(shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle))
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer({
            ...globalShortcutClient([]),
            register: (accelerator) =>
              Effect.fail(makeGlobalShortcutAlreadyRegisteredError(accelerator))
          }),
          bindingCoreLayer
        )
      )
    )
  )
  const unsupported = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      const supported = yield* shortcuts.isSupported()
      const registerExit = yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
      const isRegisteredExit = yield* Effect.exit(shortcuts.isRegistered("CmdOrCtrl+K"))
      const bindExit = yield* Effect.exit(
        shortcuts.bindCommand("CmdOrCtrl+K", "openProject", windowHandle)
      )
      const pressedExit = yield* shortcuts.onPressed().pipe(Stream.runHead, Effect.exit)
      return { bindExit, isRegisteredExit, pressedExit, registerExit, supported }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeGlobalShortcutServiceLayer(makeUnsupportedGlobalShortcutClient()),
          bindingCoreLayer
        )
      )
    )
  )

  expectExitFailure(conflictExit, (error) => hasErrorTag(error, "AlreadyExists"))
  expectExitFailure(bindConflictExit, (error) => hasErrorTag(error, "AlreadyExists"))
  expect(unsupported.supported).toEqual(
    new GlobalShortcutSupportedResult({
      supported: false,
      reason: "host-adapter-unimplemented"
    })
  )
  expectExitFailure(
    unsupported.registerExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "host-adapter-unimplemented"
  )
  expectExitFailure(
    unsupported.isRegisteredExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "GlobalShortcut.isRegistered"
  )
  expectExitFailure(
    unsupported.bindExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "host-adapter-unimplemented"
  )
  expectExitFailure(unsupported.pressedExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("Linux GlobalShortcut client reports Wayland unsupported as a typed value", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      const supported = yield* shortcuts.isSupported()
      const registerExit = yield* Effect.exit(shortcuts.register("CmdOrCtrl+K", windowHandle))
      const x11Supported = yield* makeLinuxGlobalShortcutClient("x11").isSupported()
      return { registerExit, supported, x11Supported }
    }).pipe(
      Effect.provide(makeGlobalShortcutServiceLayer(makeLinuxGlobalShortcutClient("wayland")))
    )
  )

  expect(result.supported).toEqual(
    new GlobalShortcutSupportedResult({
      supported: false,
      reason: "wayland-no-global-shortcut"
    })
  )
  expect(result.x11Supported).toEqual(new GlobalShortcutSupportedResult({ supported: true }))
  expectExitFailure(
    result.registerExit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "wayland-no-global-shortcut"
  )
})

test("WindowApi declares the Phase 5 Window method surface", () => {
  expect(WindowApi.tag).toBe("Window")
  expect([...WindowMethodNames]).toEqual(expectedWindowMethods)
  expect(Object.keys(WindowApi.spec)).toEqual(expectedWindowMethods)
  expect(WindowApi.spec.create.output).toMatchObject({
    _tag: "ApiResourceSpec",
    kind: "window",
    state: "open"
  })
})

test("Window service delegates through a substitutable WindowClient port", async () => {
  const calls: string[] = []
  const client: WindowClientApi = {
    create: (input) =>
      Effect.sync(() => {
        calls.push(`create:${input?.title ?? ""}`)
        return windowHandle
      }),
    show: () => recordVoid(calls, "show"),
    hide: () => recordVoid(calls, "hide"),
    focus: () => recordVoid(calls, "focus"),
    close: () => recordVoid(calls, "close"),
    setTitle: (_window, title) => recordVoid(calls, `setTitle:${title}`),
    setSize: (_window, size) => recordVoid(calls, `setSize:${size.width}x${size.height}`),
    setPosition: (_window, position) =>
      recordVoid(calls, `setPosition:${position.x},${position.y}`),
    setBackgroundColor: (_window, color) => recordVoid(calls, `setBackgroundColor:${color}`),
    setVibrancy: (_window, material) => recordVoid(calls, `setVibrancy:${material}`),
    setHasShadow: (_window, hasShadow) => recordVoid(calls, `setHasShadow:${hasShadow}`),
    setFullscreen: (_window, fullscreen) => recordVoid(calls, `setFullscreen:${fullscreen}`),
    enterFullScreen: () => recordVoid(calls, "enterFullScreen"),
    exitFullScreen: () => recordVoid(calls, "exitFullScreen"),
    onFullScreenChanged: () => Stream.empty,
    getScaleFactor: () => Effect.succeed({ scaleFactor: 2 }),
    onScaleChanged: () => Stream.empty,
    persistState: () => recordVoid(calls, "persistState")
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const window = yield* Window
      const created = yield* window.create({ title: "Main" })
      yield* window.setTitle(created, "Renamed")
      yield* window.setSize(created, { width: 800, height: 600 })
      const scale = yield* window.getScaleFactor(created)
      yield* window.close(created)

      return { created, scale }
    }).pipe(Effect.provide(makeWindowServiceLayer(client)))
  )

  expect(result.created).toEqual(windowHandle)
  expect(result.scale.scaleFactor).toBe(2)
  expect(calls).toEqual(["create:Main", "setTitle:Renamed", "setSize:800x600", "close"])
})

test("Window service can be composed from a separately provided WindowClient", async () => {
  const calls: string[] = []
  const client: WindowClientApi = {
    ...noopWindowClient,
    create: (input) =>
      Effect.sync(() => {
        calls.push(`create:${Object.keys(input).length}`)
        return windowHandle
      })
  }

  const created = await Effect.runPromise(
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.create()
    }).pipe(Effect.provide(Layer.provide(WindowLive, Layer.succeed(WindowClient)(client))))
  )

  expect(created.id).toBe("window-1")
  expect(calls).toEqual(["create:0"])
})

test("makeUnsupportedWindowClient returns Unsupported for all methods", async () => {
  const client = makeUnsupportedWindowClient()
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const createError = yield* client.create({}).pipe(Effect.flip)
      const showError = yield* client.show(windowHandle).pipe(Effect.flip)
      return { createError, showError }
    })
  )
  expect(result.createError._tag).toBe("Unsupported")
  expect(result.showError._tag).toBe("Unsupported")
})

test("host WindowClient adapter opens and closes through host envelopes with registry lifetime", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const registry = await Effect.runPromise(makeResourceRegistry())
  const apiExchange = makeWindowApiExchange(windowExchange(requests), registry, {
    nextRequestId: nextId(["create-request", "destroy-request"]),
    nextTraceId: nextId(["create-trace", "destroy-trace"]),
    now: nextNumber([1710000000000, 1710000000001])
  })
  const program = Effect.gen(function* () {
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
    yield* window.close(created)
    const afterClose = yield* registry.list()

    return { created, duringLifetime, afterClose }
  }).pipe(Effect.provide(Layer.provide(WindowLive, makeWindowBridgeClientLayer(apiExchange))))

  const result = await Effect.runPromise(program)

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
      WINDOW_DESTROY_METHOD,
      {
        windowId: "host-window-1"
      }
    ]
  ])
})

test("Window.create rejects persistState until the persistence backend is implemented", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const registry = await Effect.runPromise(makeResourceRegistry())
  const apiExchange = makeWindowApiExchange(windowExchange(requests), registry)
  const program = Effect.gen(function* () {
    const window = yield* Window
    return yield* Effect.exit(window.create({ persistState: true }))
  }).pipe(Effect.provide(Layer.provide(WindowLive, makeWindowBridgeClientLayer(apiExchange))))

  const exit = await Effect.runPromise(program)

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Window.create persistState"
  )
  expect(requests).toEqual([])
})

test("AppEventRouter sends firstResponder events to the focused window only", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter()
      yield* router.windowOpened(handleFor("window-1"))
      yield* router.windowOpened(handleFor("window-2"))
      yield* router.windowFocused("window-2")
      const first = yield* router
        .subscribe<{ readonly path: string }>("window-1", "onOpenFile")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      const second = yield* router
        .subscribe<{ readonly path: string }>("window-2", "onOpenFile")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "README.md" },
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
      payload: { path: "README.md" },
      windowId: "window-2",
      ownerScope: "window:window-2"
    }
  ])
})

test("AppEventRouter buffers one firstResponder event per kind until a window opens", async () => {
  const result = await Effect.runPromise(
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
        .subscribe<{ readonly path: string }>("window-1", "onOpenFile")
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

  expect(Array.from(result.events).map((event) => event.payload.path)).toEqual(["newer.txt"])
  expect(Array.from(result.audit).map((event) => event._tag)).toEqual(["EventBufferEvicted"])
})

test("AppEventRouter rejects empty window identifiers", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter()
      return yield* router.windowOpened(handleFor(""))
    })
  )

  expect(Exit.isFailure(exit)).toBe(true)
})

test("AppEventRouter targetedRoute rejects control-byte window identifiers", () => {
  expect(() => {
    targetedRoute(`window-${String.fromCharCode(0)}route`)
  }).toThrow(RangeError)
})

test("AppEventRouter rejects control-byte route metadata on publish", async () => {
  const exit = await Effect.runPromiseExit(
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

  expect(Exit.isFailure(exit)).toBe(true)
})

test("AppEventRouter drops oldest buffered subscription events when subscription queue is full", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter({ subscriptionQueueCapacity: 1 })
      yield* router.windowOpened(handleFor("window-1"))
      const events = yield* router
        .subscribe<{ readonly path: string }>("window-1", "onOpenFile")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "first.txt" },
        route: targetedRoute("window-1")
      })
      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "second.txt" },
        route: targetedRoute("window-1")
      })
      yield* router.publish({
        event: "onOpenFile",
        payload: { path: "third.txt" },
        route: targetedRoute("window-1")
      })

      return yield* Fiber.join(events)
    })
  )

  expect(Array.from(result).map((event) => event.payload.path)).toEqual(["third.txt"])
})

test("AppEventRouter keeps newest audit event when audit queue is full", async () => {
  const audits = await Effect.runPromise(
    Effect.gen(function* () {
      const router = yield* makeAppEventRouter({ auditQueueCapacity: 1 })
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

test("AppEventRouter broadcasts in creation order and short-circuits on refusal", async () => {
  const seen: string[] = []
  const decision = await Effect.runPromise(
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

test("AppEventRouter drops targeted events for closed targets with an audit row", async () => {
  const audit = await Effect.runPromise(
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

test("host WindowClient adapter declares per-window scopes and closes scoped resources", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const router = await Effect.runPromise(makeAppEventRouter())
  const apiExchange = makeWindowApiExchange(windowExchange([]), registry, {}, router)
  const program = Effect.gen(function* () {
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
  }).pipe(Effect.provide(Layer.provide(WindowLive, makeWindowBridgeClientLayer(apiExchange))))

  const result = await Effect.runPromise(program)

  expect(result.child.ownerScope).toBe("window:host-window-1")
  expect(result.afterClose.entries).toEqual([])
})

test("host WindowClient adapter returns typed failures for invalid input and bad handles", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const apiExchange = makeWindowApiExchange(windowExchange([]), registry)
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* WindowClient
    }).pipe(Effect.provide(makeWindowBridgeClientLayer(apiExchange)))
  )

  const invalidCreateExit = await Effect.runPromiseExit(client.create({ width: 0 }))
  const unknownExit = await Effect.runPromiseExit(client.close(windowHandle))
  const created = await Effect.runPromise(client.create({}))
  const staleExit = await Effect.runPromiseExit(
    client.close({
      ...created,
      generation: created.generation + 1
    })
  )
  await Effect.runPromise(client.close(created))
  const repeatedCloseExit = await Effect.runPromiseExit(client.close(created))

  expectExitFailure(invalidCreateExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(
    unknownExit,
    (error) => error instanceof HostProtocolNotFoundError && error.operation === "Window.close"
  )
  expectExitFailure(
    staleExit,
    (error) => error instanceof HostProtocolStaleHandleError && error.operation === "Window.close"
  )
  expectExitFailure(
    repeatedCloseExit,
    (error) => error instanceof HostProtocolStaleHandleError && error.operation === "Window.close"
  )
})

test("host WindowClient adapter reports unimplemented public methods as Unsupported", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const apiExchange = makeWindowApiExchange(windowExchange([]), registry)
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* WindowClient
    }).pipe(Effect.provide(makeWindowBridgeClientLayer(apiExchange)))
  )

  const created = await Effect.runPromise(client.create({}))
  const exits = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        show: yield* Effect.exit(client.show(created)),
        hide: yield* Effect.exit(client.hide(created)),
        focus: yield* Effect.exit(client.focus(created)),
        setVibrancy: yield* Effect.exit(client.setVibrancy(created, "appearance-based")),
        persistState: yield* Effect.exit(client.persistState(created))
      }
    })
  )

  expectExitFailure(
    exits.show,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Window.show"
  )
  expectExitFailure(exits.hide, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(exits.focus, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(exits.setVibrancy, (error) => hasErrorTag(error, "Unsupported"))
  expectExitFailure(exits.persistState, (error) => hasErrorTag(error, "Unsupported"))
})

test("Window bridge client rejects invalid chrome inputs before crossing the host boundary", async () => {
  const invalidInputs: ReadonlyArray<unknown> = [
    { title: "" },
    { vibrancy: "not-a-material" },
    { trafficLights: { x: -10, y: 0 } },
    { trafficLights: { x: 0, y: -20 } }
  ]

  for (const input of invalidInputs) {
    const requests: HostProtocolRequestEnvelope[] = []
    const registry = await Effect.runPromise(makeResourceRegistry())
    const apiExchange = makeWindowApiExchange(windowExchange(requests), registry)
    const program = Effect.gen(function* () {
      const window = yield* Window
      return yield* Effect.exit(window.create(input as WindowCreateOptions))
    }).pipe(Effect.provide(Layer.provide(WindowLive, makeWindowBridgeClientLayer(apiExchange))))

    const exit = await Effect.runPromise(program)

    expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
    expect(requests).toEqual([])
  }
})

test("Shell bridge client rejects empty path strings as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Shell
    }).pipe(
      Effect.provide(
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const showExit = await Effect.runPromiseExit(client.showItemInFolder(""))
  const openExit = await Effect.runPromiseExit(client.openPath(""))
  const trashExit = await Effect.runPromiseExit(client.trashItem(""))

  expectExitFailure(showExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(trashExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Shell bridge client rejects NUL bytes in path inputs as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Shell
    }).pipe(
      Effect.provide(
        Layer.provide(
          ShellLive,
          makeShellBridgeClientLayer(
            shellExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const showExit = await Effect.runPromiseExit(client.showItemInFolder("/tmp/a\u0000b"))
  const openExit = await Effect.runPromiseExit(client.openPath("/tmp/a\u0000b.txt"))
  const trashExit = await Effect.runPromiseExit(client.trashItem("/tmp/a\u0000b"))

  expectExitFailure(showExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(trashExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Path bridge client rejects empty canonical path strings from host as InvalidOutput", async () => {
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Path
    }).pipe(
      Effect.provide(
        Layer.provide(
          PathLive,
          makePathBridgeClientLayer(
            pathExchange([], () => ({ kind: "success", payload: { path: "" } }))
          )
        )
      )
    )
  )

  const exit = await Effect.runPromiseExit(client.appData())
  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
})

test("Updater bridge client rejects empty version strings as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(
      Effect.provide(
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const checkExit = await Effect.runPromiseExit(client.check({ currentVersion: "" }))
  const downloadExit = await Effect.runPromiseExit(client.download({ version: "" }))
  const installExit = await Effect.runPromiseExit(client.install({ version: "" }))

  expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(downloadExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(installExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Updater bridge client rejects check responses missing version when available", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(
      Effect.provide(
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: { available: true } }))
          )
        )
      )
    )
  )

  const checkExit = await Effect.runPromiseExit(client.check({ currentVersion: "1.0.0" }))

  expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expect(requests).toEqual([
    expect.objectContaining({ method: "Updater.check", payload: { currentVersion: "1.0.0" } })
  ])
})

test("Updater bridge client requires version for update-bearing status states", async () => {
  const updateStates: ReadonlyArray<UpdaterStatusState> = [
    "update-available",
    "downloading",
    "downloaded",
    "installing"
  ]
  for (const state of updateStates) {
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Updater
      }).pipe(
        Effect.provide(
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
      )
    )

    const statusExit = await Effect.runPromiseExit(client.getStatus())

    expectExitFailure(statusExit, (error) => hasErrorTag(error, "InvalidOutput"))
  }
})

test("Updater bridge client rejects out-of-bounds progress values from host as InvalidOutput", async () => {
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(
      Effect.provide(
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
    )
  )

  const exit = await Effect.runPromiseExit(client.getStatus())
  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidOutput"))
})

test("Updater bridge client rejects control-byte versions as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(
      Effect.provide(
        Layer.provide(
          UpdaterLive,
          makeUpdaterBridgeClientLayer(
            updaterExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const versions = ["1.0.0\u0000dev", "1.0.0\n", "1.0.0\u007f"]

  for (const version of versions) {
    const checkExit = await Effect.runPromiseExit(client.check({ currentVersion: version }))
    const downloadExit = await Effect.runPromiseExit(client.download({ version }))
    const installExit = await Effect.runPromiseExit(client.install({ version }))

    expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidArgument"))
    expectExitFailure(downloadExit, (error) => hasErrorTag(error, "InvalidArgument"))
    expectExitFailure(installExit, (error) => hasErrorTag(error, "InvalidArgument"))
  }
  expect(requests).toEqual([])
})

test("Updater bridge client rejects control-byte versions from host output", async () => {
  const checkRequests: HostProtocolRequestEnvelope[] = []
  const checkClient = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(
      Effect.provide(
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
    )
  )
  const statusRequests: HostProtocolRequestEnvelope[] = []
  const statusClient = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Updater
    }).pipe(
      Effect.provide(
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
    )
  )

  const checkExit = await Effect.runPromiseExit(checkClient.check({ currentVersion: "1.0.0" }))
  const statusExit = await Effect.runPromiseExit(statusClient.getStatus())

  expectExitFailure(checkExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expectExitFailure(statusExit, (error) => hasErrorTag(error, "InvalidOutput"))
  expect(checkRequests).toHaveLength(1)
  expect(statusRequests).toHaveLength(1)
})

test("Dialog bridge client rejects empty message strings as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dialog
    }).pipe(
      Effect.provide(
        Layer.provide(
          DialogLive,
          makeDialogBridgeClientLayer(
            dialogExchange(requests, () => ({ kind: "success", payload: undefined }))
          )
        )
      )
    )
  )

  const messageExit = await Effect.runPromiseExit(client.message({ level: "info", message: "" }))
  const confirmExit = await Effect.runPromiseExit(client.confirm({ message: "" }))

  expectExitFailure(messageExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(confirmExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Dialog bridge client rejects NUL bytes in defaultPath as InvalidArgument", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dialog
    }).pipe(
      Effect.provide(
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
    )
  )

  const openFileExit = await Effect.runPromiseExit(
    client.openFile({ defaultPath: "/tmp/a\u0000b" })
  )
  const openDirExit = await Effect.runPromiseExit(
    client.openDirectory({ defaultPath: "/tmp/a\u0000b" })
  )
  const saveFileExit = await Effect.runPromiseExit(
    client.saveFile({ defaultPath: "/tmp/a\u0000b" })
  )

  expectExitFailure(openFileExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openDirExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(saveFileExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Dialog bridge client rejects malformed file filters before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dialog
    }).pipe(
      Effect.provide(
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
    )
  )

  const openFileExit = await Effect.runPromiseExit(
    client.openFile({ filters: [{ name: "", extensions: ["txt"] }] })
  )
  const openFileBadNameExit = await Effect.runPromiseExit(
    client.openFile({ filters: [{ name: "Docs", extensions: [""] }] })
  )
  const openFileBadExtensionExit = await Effect.runPromiseExit(
    client.openFile({ filters: [{ name: "Docs", extensions: ["*.txt"] }] })
  )
  const openFileControlExtensionExit = await Effect.runPromiseExit(
    client.openFile({ filters: [{ name: "Docs", extensions: ["txt\n"] }] })
  )
  const openFileNulExtensionExit = await Effect.runPromiseExit(
    client.openFile({ filters: [{ name: "Docs", extensions: [`txt${String.fromCharCode(0)}x`] }] })
  )

  expectExitFailure(openFileExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openFileBadNameExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openFileBadExtensionExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openFileControlExtensionExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expectExitFailure(openFileNulExtensionExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("Dialog bridge client rejects malformed host output paths as InvalidOutput", async () => {
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

      const client = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* Dialog
        }).pipe(Effect.provide(Layer.provide(DialogLive, makeDialogBridgeClientLayer(exchange))))
      )

      const exit =
        method === "saveFile"
          ? await Effect.runPromiseExit(client.saveFile({ defaultPath: "/tmp/seed.txt" }))
          : method === "openFile"
            ? await Effect.runPromiseExit(client.openFile({ defaultPath: "/tmp/seed.txt" }))
            : await Effect.runPromiseExit(client.openDirectory({ defaultPath: "/tmp/seed.txt" }))

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

test("Dialog bridge client rejects invalid native UI text before transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Dialog
    }).pipe(
      Effect.provide(
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
    )
  )

  const openFileTitleExit = await Effect.runPromiseExit(client.openFile({ title: "bad\u0000" }))
  const openDirectoryTitleExit = await Effect.runPromiseExit(
    client.openDirectory({ title: "bad\n" })
  )
  const saveFileTitleExit = await Effect.runPromiseExit(client.saveFile({ title: "" }))
  const messageTitleExit = await Effect.runPromiseExit(
    client.message({ level: "info", title: "bad\u0000", message: "hello" })
  )
  const messageTextExit = await Effect.runPromiseExit(
    client.message({ level: "info", message: "hello\nworld" })
  )
  const messageDetailExit = await Effect.runPromiseExit(
    client.message({ level: "info", message: "hello", detail: "bad\u007f" })
  )
  const confirmTitleExit = await Effect.runPromiseExit(
    client.confirm({ title: "bad\u0000", message: "go" })
  )
  const confirmMessageExit = await Effect.runPromiseExit(client.confirm({ message: "go\t" }))
  const confirmLabelExit = await Effect.runPromiseExit(
    client.confirm({ message: "go", confirmLabel: "yes\n" })
  )
  const cancelLabelExit = await Effect.runPromiseExit(
    client.confirm({ message: "go", cancelLabel: "" })
  )

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

const recordVoid = (calls: string[], call: string): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    calls.push(call)
  })

const appClient = (calls: string[]): AppClientApi => ({
  getInfo: () =>
    Effect.sync(() => {
      calls.push("getInfo")
      return new AppInfo({
        id: "dev.effect-desktop.test",
        name: "Effect Desktop Test",
        version: "0.0.0"
      })
    }),
  getCommandLine: () =>
    Effect.sync(() => {
      calls.push("getCommandLine")
      return new AppCommandLine({ argv: ["app"], cwd: "/repo" })
    }),
  quit: (input: { readonly exitCode?: number }) =>
    recordVoid(calls, `quit:${input.exitCode ?? -1}`),
  restart: (input: { readonly args?: readonly string[] }) =>
    recordVoid(calls, `restart:${input.args?.join(" ") ?? ""}`),
  focus: () => recordVoid(calls, "focus"),
  requestSingleInstanceLock: () => Effect.succeed({ acquired: true }),
  setOpenAtLogin: (input: { readonly enabled: boolean; readonly args?: readonly string[] }) =>
    recordVoid(calls, `setOpenAtLogin:${input.enabled}:${input.args?.join(" ") ?? ""}`),
  registerProtocol: (input: { readonly scheme: string }) =>
    recordVoid(calls, `registerProtocol:${input.scheme}`),
  onSecondInstance: () =>
    Stream.make(
      new AppSecondInstanceEvent({ argv: ["app", "--second"], cwd: "/repo", traceId: "trace" })
    ),
  onOpenFile: () => Stream.make(new AppOpenFileEvent({ path: "README.md" })),
  onOpenUrl: () => Stream.make(new AppOpenUrlEvent({ url: "effect-desktop://open" })),
  onBeforeQuit: () => Stream.make(new AppBeforeQuitEvent({ traceId: "trace" }))
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
  goBack: () => recordVoid(calls, "goBack"),
  goForward: () => recordVoid(calls, "goForward"),
  captureScreenshot: () =>
    Effect.sync(() => {
      calls.push("captureScreenshot")
      return new WebViewScreenshot({ mime: "image/png", bytes: new Uint8Array([1, 2, 3]) })
    }),
  setNavigationPolicy: (_webview, policy) =>
    recordVoid(
      calls,
      `setNavigationPolicy:${policy.allowedOrigins.join(",")}:${policy.onDisallowed}`
    ),
  capability: (input) => Effect.succeed({ supported: input.platform !== "linux" }),
  destroy: () => recordVoid(calls, "destroy"),
  onNavigationBlocked: () =>
    Stream.make(
      new WebViewNavigationBlockedEvent({
        webview: webviewHandle,
        url: "https://blocked.example",
        reason: "origin not allowed"
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
      calls.push(`create:${input.icon}:${input.tooltip ?? ""}:${input.menu?.items.length ?? 0}`)
      return trayHandle
    }),
  setIcon: (tray, icon) => recordVoid(calls, `setIcon:${tray.id}:${icon}`),
  setTooltip: (tray, tooltip) => recordVoid(calls, `setTooltip:${tray.id}:${tooltip}`),
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
    })
})

const makeCommandBindingLayer = async (calls: unknown[] = []) => {
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const commands = await Effect.runPromise(makeCommandRegistry(resources, permissions))
  await Effect.runPromise(permissions.declare(menuCommandCapability, { source: "test" }))
  await Effect.runPromise(
    commands.register({
      id: "app.file.open",
      inputSchema: Schema.Struct({
        itemId: Schema.String,
        windowId: Schema.optionalKey(Schema.String)
      }),
      outputSchema: Schema.Void,
      capability: menuCommandCapability,
      ownerScope: "app",
      handler: (input) =>
        Effect.sync(() => {
          calls.push(input)
        })
    })
  )

  return Layer.mergeAll(
    Layer.succeed(ResourceRegistry)(resources),
    Layer.succeed(CommandRegistry)(commands)
  )
}

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
  set: (key, value) => recordVoid(calls, `set:${key}:${value.unsafeBytes().byteLength}`),
  get: (key) =>
    Effect.sync(() => {
      calls.push(`get:${key}`)
      return SecretValue.fromUtf8("refresh-token")
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
    Stream.make(new SystemAppearanceChangedEvent({ appearance: "highContrast" })),
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
  setMenu: (menu) => recordVoid(calls, `setMenu:${menu?.items.length ?? 0}`),
  setJumpList: (items) =>
    recordVoid(calls, `setJumpList:${items.map((item) => item.id).join(",")}`),
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
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  close: () => Effect.void,
  setTitle: () => Effect.void,
  setSize: () => Effect.void,
  setPosition: () => Effect.void,
  setBackgroundColor: () => Effect.void,
  setVibrancy: () => Effect.void,
  setHasShadow: () => Effect.void,
  setFullscreen: () => Effect.void,
  enterFullScreen: () => Effect.void,
  exitFullScreen: () => Effect.void,
  onFullScreenChanged: () => Stream.empty,
  getScaleFactor: () => Effect.succeed({ scaleFactor: 1 }),
  onScaleChanged: () => Stream.empty,
  persistState: () => Effect.void
}

const handleFor = (id: string): WindowHandle => ({
  kind: "window",
  id,
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
          : {})
      })
    )
  }
})

const appExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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
            payload: { path: "README.md" }
          })
        )
      : Stream.empty
})

const webViewExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  },
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
              reason: "origin not allowed"
            }
          })
        )
      : Stream.empty,
  resource: {
    dispose: () => Effect.void
  }
})

const menuExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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
      : Stream.empty,
  resource: {
    dispose: () => Effect.void
  }
})

const dialogExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const clipboardExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const notificationExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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
        : Stream.empty,
  resource: {
    dispose: () => Effect.void
  }
})

const pathExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const protocolExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const safeStorageExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const updaterExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const crashReporterExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const shellExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const screenExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const systemAppearanceExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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
            payload: { appearance: "highContrast" }
          })
        )
      : Stream.empty
})

const powerMonitorExchange = (): ApiClientExchange => ({
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
          : method === "PowerMonitor.PowerSourceChanged"
            ? Stream.make(
                new HostProtocolEventEnvelope({
                  kind: "event",
                  timestamp: 1710000000713,
                  traceId: "event-trace",
                  method,
                  payload: { source: "battery" }
                })
              )
            : Stream.empty
})

const dockExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const globalShortcutExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => ApiClientResponse
): ApiClientExchange => ({
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

const makeWindowApiExchange = (
  hostExchange: HostWindowExchange,
  registry: ResourceRegistry["Service"],
  options: HostWindowClientOptions = {},
  appEventRouter?: AppEventRouter["Service"]
): ApiClientExchange => {
  const runtime = Handlers.withOptions(
    { originAuth: RendererOriginAuth.unsafeDisabledForTests },
    makeHostWindowApiLayer(hostExchange, {
      ...options,
      ...(appEventRouter === undefined ? {} : { appEventRouter })
    })
  )
  const registryLayer = Layer.succeed(ResourceRegistry)(registry)
  const request: ApiClientExchange["request"] = (request) =>
    runtime.dispatch(request).pipe(Effect.provide(registryLayer)) as ReturnType<
      ApiClientExchange["request"]
    >

  return {
    request,
    resource: {
      dispose: () => Effect.void
    }
  }
}

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

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: E) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(predicate(fail.error as E)).toBe(true)
      return
    }
  }

  throw new Error("expected typed failure")
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag
