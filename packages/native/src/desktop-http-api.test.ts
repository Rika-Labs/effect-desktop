import { expect, test } from "bun:test"
import { PermissionRegistry, makePermissionRegistry } from "@effect-desktop/core"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"

import { WindowResource } from "./contracts/window.js"
import {
  DesktopHttpApi,
  DesktopHttpApiRoutes,
  DesktopHttpWindowCreateCapability
} from "./desktop-http-api.js"
import { makeWindowServiceLayer, type WindowClientApi } from "./window.js"

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
  getParent: () => Effect.succeed(undefined),
  getChildren: () => Effect.succeed([]),
  getBounds: () => Effect.succeed({ x: 0, y: 0, width: 640, height: 480 }),
  setBounds: () => Effect.void,
  center: () => Effect.void,
  centerOnDisplay: () => Effect.void,
  setTitle: () => Effect.void,
  setResizable: () => Effect.void,
  setDecorations: () => Effect.void,
  setTrafficLights: () => Effect.void,
  setVibrancy: () => Effect.void,
  clearVibrancy: () => Effect.void,
  setShadow: () => Effect.void,
  setTitleBarTransparent: () => Effect.void,
  setAlwaysOnTop: () => Effect.void,
  setSkipTaskbar: () => Effect.void,
  setProgress: () => Effect.void,
  requestAttention: () => Effect.void,
  cancelAttention: () => Effect.void,
  minimize: () => Effect.void,
  maximize: () => Effect.void,
  restore: () => Effect.void,
  setFullscreen: () => Effect.void,
  setSimpleFullscreen: () => Effect.void,
  getState: () =>
    Effect.succeed({
      minimized: false,
      maximized: false,
      fullscreen: false,
      simpleFullscreen: false
    }),
  events: () => Stream.empty
}

const makeHandler = (permissions: Layer.Layer<PermissionRegistry>) =>
  HttpRouter.toWebHandler(
    DesktopHttpApiRoutes.pipe(
      Layer.provide(makeWindowServiceLayer(windowClient)),
      Layer.provide(permissions),
      Layer.provide(HttpServer.layerServices)
    )
  )

test("DesktopHttpApi generated client builds the window create endpoint", () => {
  const urls = HttpApiClient.urlBuilder(DesktopHttpApi, { baseUrl: "http://localhost" })

  expect(urls.window.create()).toBe("http://localhost/window")
})

test("DesktopHttpApi creates windows through schema-backed HTTP", async () => {
  const permissions = Layer.effect(
    PermissionRegistry,
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry({ traceId: () => "trace-http" })
      yield* registry.declare(DesktopHttpWindowCreateCapability).pipe(Effect.orDie)
      return registry
    })
  )
  const { handler, dispose } = makeHandler(permissions)

  try {
    const response = await handler(
      new Request("http://localhost/window", {
        method: "POST",
        body: JSON.stringify({ title: "Main" }),
        headers: { "content-type": "application/json" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      id: "window-1",
      kind: "window",
      state: "open",
      ownerScope: "desktop-http-test",
      generation: 0
    })
  } finally {
    await dispose()
  }
})

test("DesktopHttpPermission rejects undeclared window create permission as typed HTTP error", async () => {
  const permissions = Layer.effect(
    PermissionRegistry,
    makePermissionRegistry({ traceId: () => "trace-http" })
  )
  const { handler, dispose } = makeHandler(permissions)

  try {
    const response = await handler(
      new Request("http://localhost/window", {
        method: "POST",
        body: JSON.stringify({ title: "Main" }),
        headers: { "content-type": "application/json" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      tag: "PermissionDenied",
      capability: "native.invoke",
      operation: "DesktopHttpPermission"
    })
  } finally {
    await dispose()
  }
})
