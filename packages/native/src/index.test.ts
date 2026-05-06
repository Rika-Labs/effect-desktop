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
  Menu,
  MenuActivatedEvent,
  MenuApi,
  MenuLive,
  MenuMethodNames,
  MenuTemplate,
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
  makeMenuBridgeClientLayer,
  makeMenuServiceLayer,
  makeUnsupportedMenuClient,
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
  type MenuClientApi,
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
