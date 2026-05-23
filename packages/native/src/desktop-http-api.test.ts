import { expect, test } from "bun:test"
import { PermissionRegistry, makePermissionRegistry } from "@orika/core"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"

import { WindowResource, WindowState } from "./contracts/window.js"
import {
  DesktopHttpApi,
  DesktopHttpApiRoutes,
  DesktopHttpWindowCreateCapability
} from "./desktop-http-api.js"
import { type WindowClientApi, WindowLive, WindowClient } from "./window.js"

const windowHandle = Schema.decodeUnknownSync(WindowResource)({
  id: "window-1",
  kind: "window",
  state: "open",
  ownerScope: "desktop-http-test",
  generation: 0
})

const windowClient: WindowClientApi = {
  create: () => Effect.succeed(windowHandle),
  close: () => Effect.void,
  destroy: () => Effect.void,
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  getCurrent: () => Effect.succeed(windowHandle),
  getById: () => Effect.succeed(windowHandle),
  list: () => Effect.succeed([windowHandle]),
  getParent: () => Effect.sync(() => undefined),
  getChildren: () => Effect.succeed([]),
  getBounds: () => Effect.succeed({ x: 0, y: 0, width: 640, height: 480 }),
  setBounds: (_window, bounds) => Effect.succeed(bounds),
  setBoundsOnDisplay: (_window, _displayId, bounds) => Effect.succeed(bounds),
  center: () => Effect.succeed({ x: 0, y: 0, width: 640, height: 480 }),
  centerOnDisplay: () => Effect.succeed({ x: 0, y: 0, width: 640, height: 480 }),
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

const windowCreateRequest = (): Request =>
  new Request("http://localhost/window", {
    method: "POST",
    body: JSON.stringify({ title: "Main" }),
    headers: { "content-type": "application/json" }
  })

const makeHandler = (permissions: Layer.Layer<PermissionRegistry>) =>
  HttpRouter.toWebHandler(
    DesktopHttpApiRoutes.pipe(
      Layer.provide(Layer.provide(WindowLive, Layer.succeed(WindowClient)(windowClient))),
      Layer.provide(permissions),
      Layer.provide(HttpServer.layerServices)
    )
  )

test("DesktopHttpApi generated client builds the window create endpoint", () => {
  const urls = HttpApiClient.urlBuilder(DesktopHttpApi, { baseUrl: "http://localhost" })

  expect(urls.window.create()).toBe("http://localhost/window")
})

test("DesktopHttpApi creates windows through schema-backed HTTP", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = Layer.effect(
        PermissionRegistry,
        Effect.gen(function* () {
          const registry = yield* makePermissionRegistry({ traceId: () => "trace-http" })
          yield* registry.declare(DesktopHttpWindowCreateCapability).pipe(Effect.orDie)
          return registry
        })
      )
      const { dispose, handler } = makeHandler(permissions)

      try {
        const response = yield* Effect.promise(() => handler(windowCreateRequest()))
        const body = yield* Effect.promise(() => response.json())

        expect(response.status).toBe(200)
        expect(body).toEqual({
          id: "window-1",
          kind: "window",
          state: "open",
          ownerScope: "desktop-http-test",
          generation: 0
        })
      } finally {
        yield* Effect.promise(() => dispose())
      }
    })
  ))

test("DesktopHttpPermission rejects undeclared window create permission as typed HTTP error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = Layer.effect(
        PermissionRegistry,
        makePermissionRegistry({ traceId: () => "trace-http" })
      )
      const { dispose, handler } = makeHandler(permissions)

      try {
        const response = yield* Effect.promise(() => handler(windowCreateRequest()))
        const body = yield* Effect.promise(() => response.json())

        expect(response.status).toBe(403)
        expect(body).toMatchObject({
          tag: "PermissionDenied",
          capability: "native.invoke",
          operation: "DesktopHttpPermission"
        })
      } finally {
        yield* Effect.promise(() => dispose())
      }
    })
  ))
