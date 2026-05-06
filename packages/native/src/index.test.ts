import { expect, test } from "bun:test"
import {
  HostProtocolNotFoundError,
  HostProtocolResponseEnvelope,
  HostProtocolStaleHandleError,
  Handlers,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  type ApiClientExchange,
  type ApiClientResponse,
  type HostProtocolRequestEnvelope,
  HostProtocolEventEnvelope,
  type HostWindowClientOptions,
  type HostWindowExchange
} from "@effect-desktop/bridge"
import { ResourceRegistry, makeResourceRegistry } from "@effect-desktop/core"
import { Cause, Effect, Exit, Fiber, Layer, Stream } from "effect"

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
  ClipboardText,
  ContextMenu,
  ContextMenuActivatedEvent,
  ContextMenuApi,
  ContextMenuLive,
  ContextMenuMethodNames,
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
  PowerMonitor,
  PowerMonitorApi,
  PowerMonitorLive,
  PowerMonitorMethodNames,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSuspendEvent,
  Screen,
  ScreenApi,
  ScreenBounds,
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenLive,
  ScreenMethodNames,
  ScreenPoint,
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
  Tray,
  TrayActivatedEvent,
  TrayApi,
  TrayLive,
  TrayMethodNames,
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
  makeDialogBridgeClientLayer,
  makeDialogServiceLayer,
  makeDockBridgeClientLayer,
  makeDockServiceLayer,
  makePowerMonitorBridgeClientLayer,
  makePowerMonitorServiceLayer,
  makeScreenBridgeClientLayer,
  makeScreenServiceLayer,
  makeSystemAppearanceBridgeClientLayer,
  makeSystemAppearanceServiceLayer,
  makeUnsupportedClipboardClient,
  makeUnsupportedContextMenuClient,
  makeMenuBridgeClientLayer,
  makeMenuServiceLayer,
  makeNotificationBridgeClientLayer,
  makeNotificationServiceLayer,
  makePathBridgeClientLayer,
  makePathServiceLayer,
  makeShellBridgeClientLayer,
  makeShellServiceLayer,
  makeUnsupportedDialogClient,
  makeUnsupportedMenuClient,
  makeUnsupportedNotificationClient,
  makeUnsupportedPathClient,
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
  firstResponderRoute,
  broadcastRoute,
  targetedRoute,
  windowScope,
  type AppClientApi,
  type ClipboardClientApi,
  type ContextMenuClientApi,
  type DialogClientApi,
  type DockClientApi,
  type MenuClientApi,
  type NotificationClientApi,
  type NotificationHandle,
  type PathClientApi,
  type ScreenClientApi,
  type ShellClientApi,
  type SystemAppearanceClientApi,
  type TrayClientApi,
  type TrayHandle,
  type WebViewClientApi,
  type WebViewHandle,
  type WindowClientApi,
  type WindowHandle
} from "./index.js"

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

const expectedClipboardMethods: Array<(typeof ClipboardMethodNames)[number]> = [
  "readText",
  "writeText",
  "readImage",
  "writeImage",
  "clear"
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

const expectedPowerMonitorMethods: Array<(typeof PowerMonitorMethodNames)[number]> = []

const expectedScreenMethods: Array<(typeof ScreenMethodNames)[number]> = [
  "getDisplays",
  "getPrimaryDisplay",
  "getPointerPoint"
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
  "getReducedTransparency"
]

const expectedTrayMethods: Array<(typeof TrayMethodNames)[number]> = [
  "create",
  "setIcon",
  "setTooltip",
  "setMenu",
  "destroy"
]

const windowHandle: WindowHandle = {
  kind: "window",
  id: "window-1",
  generation: 0,
  ownerScope: "scope-1",
  state: "open"
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
          ? { mime: "image/png", bytes: new Uint8Array([4, 5, 6]) }
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
  expect(result.screenshot).toEqual(
    new WebViewScreenshot({ mime: "image/png", bytes: new Uint8Array([4, 5, 6]) })
  )
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

test("MenuApi declares the Phase 7 Menu method and event surface", () => {
  expect(MenuApi.tag).toBe("Menu")
  expect([...MenuMethodNames]).toEqual(expectedMenuMethods)
  expect(Object.keys(MenuApi.spec)).toEqual(expectedMenuMethods)
  expect(Object.keys(MenuApi.events)).toEqual(["Activated"])
})

test("Menu service delegates through a substitutable MenuClient port", async () => {
  const calls: string[] = []
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const menu = yield* Menu
      yield* menu.setApplicationMenu(menuTemplate)
      yield* menu.setWindowMenu(windowHandle, menuTemplate)
      yield* menu.bindCommand("file.open", "app.file.open")
      const linuxAppMenu = yield* menu.capability("application menu", { platform: "linux" })
      const activated = yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
      yield* menu.clear({ window: windowHandle })
      yield* menu.clear()

      return { activated, linuxAppMenu }
    }).pipe(Effect.provide(makeMenuServiceLayer(menuClient(calls))))
  )

  expect(result.linuxAppMenu).toBe(false)
  expect(Array.from(result.activated)).toEqual([
    new MenuActivatedEvent({
      itemId: "file.open",
      commandId: "app.file.open",
      windowId: "window-1"
    })
  ])
  expect(calls).toEqual([
    "setApplicationMenu:3",
    "setWindowMenu:window-1:3",
    "bindCommand:file.open:app.file.open",
    "clear:window-1",
    "clear:application"
  ])
})

test("Menu bridge client validates templates, sends host envelopes, and decodes activation events", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = menuExchange(requests, () => ({ kind: "success", payload: undefined }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const menu = yield* Menu
      yield* menu.setApplicationMenu(menuTemplate)
      yield* menu.setWindowMenu(windowHandle, menuTemplate)
      yield* menu.bindCommand("file.open", "app.file.open")
      const activated = yield* menu.onActivated().pipe(Stream.take(1), Stream.runCollect)
      yield* menu.clear({ window: windowHandle })

      return { activated }
    }).pipe(
      Effect.provide(
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
    ["Menu.setApplicationMenu", { template: menuTemplate }],
    ["Menu.setWindowMenu", { window: windowHandle, template: menuTemplate }],
    ["Menu.bindCommand", { itemId: "file.open", commandId: "app.file.open" }],
    ["Menu.clear", { window: windowHandle }]
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

test("unsupported Menu client reports deferred host methods as Effect values", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const menu = yield* Menu
      const macosAppMenu = yield* menu.capability("application menu", { platform: "macos" })
      const windowsAppMenu = yield* menu.capability("application menu", { platform: "windows" })
      const setExit = yield* Effect.exit(menu.setApplicationMenu(menuTemplate))

      return { macosAppMenu, setExit, windowsAppMenu }
    }).pipe(Effect.provide(makeMenuServiceLayer(makeUnsupportedMenuClient())))
  )

  expect(result.macosAppMenu).toBe(true)
  expect(result.windowsAppMenu).toBe(false)
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
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const contextMenu = yield* ContextMenu
      yield* contextMenu.buildFromTemplate({ template: menuTemplate })
      yield* contextMenu.show({
        window: windowHandle,
        template: menuTemplate,
        position: { x: 12, y: 34 }
      })
      yield* contextMenu.bindCommand("file.open", "app.file.open")
      const activated = yield* contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect)

      return { activated }
    }).pipe(Effect.provide(makeContextMenuServiceLayer(contextMenuClient(calls))))
  )

  expect(Array.from(result.activated)).toEqual([
    new ContextMenuActivatedEvent({
      itemId: "file.open",
      commandId: "app.file.open",
      windowId: "window-1"
    })
  ])
  expect(calls).toEqual([
    "buildFromTemplate:3",
    "show:window-1:12:34:3",
    "bindCommand:file.open:app.file.open"
  ])
})

test("ContextMenu bridge client validates window menu inputs and decodes activation events", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange = contextMenuExchange(requests, () => ({ kind: "success", payload: undefined }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const contextMenu = yield* ContextMenu
      yield* contextMenu.show({
        window: windowHandle,
        template: menuTemplate,
        position: { x: 12, y: 34 }
      })
      yield* contextMenu.bindCommand("file.open", "app.file.open")
      const activated = yield* contextMenu.onActivated().pipe(Stream.take(1), Stream.runCollect)

      return { activated }
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContextMenuLive,
          makeContextMenuBridgeClientLayer(exchange, {
            nextRequestId: nextId(["show-request", "bind-request"]),
            nextTraceId: nextId(["show-trace", "bind-trace"]),
            now: nextNumber([1710000000000, 1710000000001])
          })
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
      { window: windowHandle, template: menuTemplate, position: { x: 12, y: 34 } }
    ],
    ["ContextMenu.bindCommand", { itemId: "file.open", commandId: "app.file.open" }]
  ])
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

test("unsupported Tray client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const tray = yield* Tray
      return yield* Effect.exit(tray.create({ icon: "app://assets/tray.png" }))
    }).pipe(Effect.provide(makeTrayServiceLayer(makeUnsupportedTrayClient())))
  )

  expectExitFailure(
    exit,
    (error) =>
      hasErrorTag(error, "Unsupported") &&
      typeof error === "object" &&
      error !== null &&
      "operation" in error &&
      error.operation === "Tray.create"
  )
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

test("unsupported Clipboard client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      return yield* Effect.exit(clipboard.readText())
    }).pipe(Effect.provide(makeClipboardServiceLayer(makeUnsupportedClipboardClient())))
  )

  expectExitFailure(
    exit,
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

  const exit = await Effect.runPromiseExit(client.show({ title: "Missing body" } as never))

  expectExitFailure(exit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests).toEqual([])
})

test("unsupported Notification client reports deferred host methods as Effect values", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const notification = yield* Notification
      const supported = yield* notification.isSupported()
      const permission = yield* notification.getPermissionStatus()
      const showExit = yield* Effect.exit(
        notification.show({ title: "Build finished", body: "Open results" })
      )

      return { permission, showExit, supported }
    }).pipe(Effect.provide(makeNotificationServiceLayer(makeUnsupportedNotificationClient())))
  )

  expect(result.supported).toBe(false)
  expect(result.permission).toBe("denied")
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
  const metacharExit = await Effect.runPromiseExit(client.trashItem("/tmp/a;b.txt"))
  await Effect.runPromise(client.openPath("/tmp/install.sh", { allowExecutable: true }))

  expectExitFailure(fileExit, (error) => hasErrorTag(error, "PermissionDenied"))
  expectExitFailure(executableExit, (error) => hasErrorTag(error, "PermissionDenied"))
  expectExitFailure(metacharExit, (error) => hasErrorTag(error, "InvalidArgument"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Shell.openExternal", { url: "https://example.com/docs" }],
    ["Shell.openPath", { path: "/tmp/install.sh", allowExecutable: true }]
  ])
})

test("Shell bridge client accepts app-declared external URL schemes", async () => {
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
  await Effect.runPromise(client.openExternal("myapp://callback", { allowedSchemes: ["myapp"] }))

  expectExitFailure(denied, (error) => hasErrorTag(error, "PermissionDenied"))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Shell.openExternal", { url: "myapp://callback", allowedSchemes: ["myapp"] }]
  ])
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
        pointer: yield* screen.getPointerPoint()
      }
    }).pipe(Effect.provide(makeScreenServiceLayer(screenClient(calls))))
  )

  expect(result.displays).toEqual([primaryDisplay])
  expect(result.primary).toEqual(primaryDisplay)
  expect(result.pointer).toEqual(new ScreenPoint({ x: 12, y: 34 }))
  expect(calls).toEqual(["getDisplays", "getPrimaryDisplay", "getPointerPoint"])
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
          : { x: 12, y: 34 }
  }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const screen = yield* Screen
      return {
        displays: yield* screen.getDisplays(),
        primary: yield* screen.getPrimaryDisplay(),
        pointer: yield* screen.getPointerPoint()
      }
    }).pipe(Effect.provide(Layer.provide(ScreenLive, makeScreenBridgeClientLayer(exchange))))
  )

  expect(result.displays).toEqual([primaryDisplay])
  expect(result.primary).toMatchObject(primaryDisplay)
  expect(result.pointer).toEqual(new ScreenPoint({ x: 12, y: 34 }))
  expect(requests.map((request) => [request.method, request.payload])).toEqual([
    ["Screen.getDisplays", undefined],
    ["Screen.getPrimaryDisplay", undefined],
    ["Screen.getPointerPoint", undefined]
  ])
})

test("unsupported Screen client reports deferred host methods as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* Effect.exit(screen.getDisplays())
    }).pipe(Effect.provide(makeScreenServiceLayer(makeUnsupportedScreenClient())))
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "Unsupported"))
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
        changed: yield* appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect)
      }
    }).pipe(Effect.provide(makeSystemAppearanceServiceLayer(systemAppearanceClient(calls))))
  )

  expect(result.mode).toBe("dark")
  expect(result.accent).toEqual(accentColor)
  expect(result.motion).toBe(true)
  expect(result.transparency).toBe(false)
  expect(Array.from(result.changed)).toEqual([
    new SystemAppearanceChangedEvent({ appearance: "highContrast" })
  ])
  expect(calls).toEqual([
    "getAppearance",
    "getAccentColor",
    "getReducedMotion",
    "getReducedTransparency"
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
        changed: yield* appearance.onAppearanceChanged().pipe(Stream.take(1), Stream.runCollect)
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
  expect(Array.from(result.changed)).toEqual([
    new SystemAppearanceChangedEvent({ appearance: "highContrast" })
  ])
  expect(requests.map((request) => request.method)).toEqual([
    "SystemAppearance.getAppearance",
    "SystemAppearance.getAccentColor",
    "SystemAppearance.getReducedMotion",
    "SystemAppearance.getReducedTransparency"
  ])
})

test("unsupported SystemAppearance client returns typed values and failing event stream", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const mode = yield* appearance.getAppearance()
      const accent = yield* appearance.getAccentColor()
      const eventExit = yield* appearance.onAppearanceChanged().pipe(Stream.runHead, Effect.exit)
      return { accent, eventExit, mode }
    }).pipe(
      Effect.provide(makeSystemAppearanceServiceLayer(makeUnsupportedSystemAppearanceClient()))
    )
  )

  expect(result.mode).toBe("light")
  expect(result.accent).toBeNull()
  expectExitFailure(result.eventExit, (error) => hasErrorTag(error, "Unsupported"))
})

test("PowerMonitorApi declares the Phase 8 event-only surface", () => {
  expect(PowerMonitorApi.tag).toBe("PowerMonitor")
  expect([...PowerMonitorMethodNames]).toEqual(expectedPowerMonitorMethods)
  expect(Object.keys(PowerMonitorApi.spec)).toEqual([])
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
        source: yield* power.onPowerSourceChanged().pipe(Stream.take(1), Stream.runCollect)
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
})

test("unsupported PowerMonitor client reports deferred event streams as Effect values", async () => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const power = yield* PowerMonitor
      return yield* power.onSuspend().pipe(Stream.runHead, Effect.exit)
    }).pipe(Effect.provide(makePowerMonitorServiceLayer(makeUnsupportedPowerMonitorClient())))
  )

  expectExitFailure(exit, (error) => hasErrorTag(error, "Unsupported"))
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
    ["Dock.setBadgeText", { text: null }],
    ["Dock.setProgress", { value: null }],
    ["Dock.setMenu", { menu: null }],
    ["Dock.setJumpList", { items: [{ id: "open", title: "Open", commandId: "app.open" }] }],
    ["Dock.requestAttention", {}],
    ["Dock.isSupported", { method: "setJumpList" }]
  ])
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
      persistState: true
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
        height: 240
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
    Stream.make(new TrayActivatedEvent({ tray: trayHandle, ownerWindowId: "window-1" }))
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
  readImage: () =>
    Effect.sync(() => {
      calls.push("readImage")
      return new ClipboardImage({ mime: "image/png", bytes: pngBytes })
    }),
  writeImage: (input) => recordVoid(calls, `writeImage:${input.mime}:${input.bytes.length}`),
  clear: () => recordVoid(calls, "clear")
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

const shellClient = (calls: string[]): ShellClientApi => ({
  openExternal: (url, options) =>
    recordVoid(calls, `openExternal:${url}:${options?.allowedSchemes?.join(",") ?? ""}`),
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
    Stream.make(new SystemAppearanceChangedEvent({ appearance: "highContrast" }))
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
  request: () => Effect.die("PowerMonitor has no request methods"),
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

const makeWindowApiExchange = (
  hostExchange: HostWindowExchange,
  registry: ResourceRegistry["Service"],
  options: HostWindowClientOptions = {},
  appEventRouter?: AppEventRouter["Service"]
): ApiClientExchange => {
  const runtime = Handlers(
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
