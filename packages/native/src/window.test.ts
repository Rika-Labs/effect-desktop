import { expect, test } from "bun:test"
import { rpcSupport, type Rpc } from "@orika/bridge"
import { Desktop, makeResourceId } from "@orika/core"
import {
  makeDesktopRendererRpcTestLayer,
  RendererRpcClients
} from "@orika/core/runtime/renderer-rpc-client"
import { Effect, Exit, Layer, Option, Schema, Stream } from "effect"

import { WindowRegistryEvent } from "./contracts/window.js"
import {
  WindowHandlersLive,
  WindowRpcs,
  type WindowClientApi,
  WindowLive,
  WindowClient
} from "./window.js"
import { makeWindowRendererClient, WindowRendererRpcs } from "./window-renderer-client.js"

import type { WindowHandle } from "./contracts/window.js"

test("WindowRegistryEvent terminal flag must match phase", () => {
  for (const payload of [
    {
      type: "window-registry-event",
      phase: "opened",
      windowId: "window-1",
      terminal: true
    },
    {
      type: "window-registry-event",
      phase: "shown",
      windowId: "window-1",
      terminal: true
    },
    {
      type: "window-registry-event",
      phase: "hidden",
      windowId: "window-1",
      terminal: true
    },
    {
      type: "window-registry-event",
      phase: "focused",
      windowId: "window-1",
      terminal: true
    },
    {
      type: "window-registry-event",
      phase: "closeRequested",
      windowId: "window-1",
      terminal: true
    },
    {
      type: "window-registry-event",
      phase: "closed",
      windowId: "window-1",
      terminal: false
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(WindowRegistryEvent)(payload))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    {
      type: "window-registry-event",
      phase: "opened",
      windowId: "window-1",
      terminal: false
    },
    {
      type: "window-registry-event",
      phase: "closed",
      windowId: "window-1",
      terminal: true
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(WindowRegistryEvent)(payload))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("WindowRpcs exposes only host-implemented methods through RpcGroup lowering", () => {
  expect(request("Window.create").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.close").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.destroy").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.show").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.hide").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.focus").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.getChildren").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.getBounds").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setBounds").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setBoundsOnDisplay").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.center").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.centerOnDisplay").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setTitle").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setResizable").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setDecorations").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setTrafficLights").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "traffic-light-placement-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "traffic-light-placement-macos-only" },
      { platform: "linux", status: "unsupported", reason: "traffic-light-placement-macos-only" }
    ]
  })
  expect(request("Window.setVibrancy").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "vibrancy-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "vibrancy-macos-only" },
      { platform: "linux", status: "unsupported", reason: "vibrancy-macos-only" }
    ]
  })
  expect(request("Window.clearVibrancy").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "vibrancy-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "vibrancy-macos-only" },
      { platform: "linux", status: "unsupported", reason: "vibrancy-macos-only" }
    ]
  })
  expect(request("Window.setShadow").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "shadow-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "shadow-macos-only" },
      { platform: "linux", status: "unsupported", reason: "shadow-macos-only" }
    ]
  })
  expect(request("Window.setTitleBarStyle").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "titlebar-style-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "titlebar-style-macos-only" },
      { platform: "linux", status: "unsupported", reason: "titlebar-style-macos-only" }
    ]
  })
  expect(request("Window.setTitleBarTransparent").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "titlebar-transparency-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "titlebar-transparency-macos-only" },
      { platform: "linux", status: "unsupported", reason: "titlebar-transparency-macos-only" }
    ]
  })
  expect(request("Window.setTransparent").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "window-transparency-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "window-transparency-macos-only" },
      { platform: "linux", status: "unsupported", reason: "window-transparency-macos-only" }
    ]
  })
  expect(request("Window.setAlwaysOnTop").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.setSkipTaskbar").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "skip-taskbar-macos-unsupported",
    platforms: [
      { platform: "macos", status: "unsupported", reason: "skip-taskbar-macos-unsupported" },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "supported" }
    ]
  })
  expect(request("Window.setProgress").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.requestAttention").pipe(rpcSupport)).toEqual({ status: "supported" })
  expect(request("Window.cancelAttention").pipe(rpcSupport)).toEqual({ status: "supported" })
  for (const method of [
    "Window.minimize",
    "Window.maximize",
    "Window.restore",
    "Window.setFullscreen",
    "Window.getState"
  ]) {
    expect(request(method).pipe(rpcSupport)).toEqual({ status: "supported" })
  }
  expect(request("Window.setSimpleFullscreen").pipe(rpcSupport)).toMatchObject({
    status: "partial",
    reason: "simple-fullscreen-macos-only",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "simple-fullscreen-macos-only" },
      { platform: "linux", status: "unsupported", reason: "simple-fullscreen-macos-only" }
    ]
  })
})

test("WindowRendererRpcs exposes the renderer-callable Window subset", () => {
  const rendererMethods = Array.from(WindowRendererRpcs.requests.keys()).toSorted()

  expect(rendererMethods).toEqual([
    "Window.close",
    "Window.create",
    "Window.destroy",
    "Window.getCurrent"
  ])

  for (const method of rendererMethods) {
    expect(WindowRpcs.requests.has(method)).toBe(true)
    expect(request(method).pipe(rpcSupport)).toEqual({ status: "supported" })
  }
})

test("Window renderer client constructor derives service from renderer RPC client map", () => {
  const calls: string[] = []
  const window = makeTestWindowHandle("window-main")
  const rpcs = Desktop.rpc(
    WindowRpcs,
    Layer.provide(
      WindowHandlersLive,
      Layer.provide(WindowLive, Layer.succeed(WindowClient)(makeTestWindowClient(window, calls)))
    )
  )

  return Effect.runPromise(
    Effect.gen(function* () {
      const rendererClients = yield* RendererRpcClients
      const client = Option.getOrThrow(makeWindowRendererClient(rendererClients.clients))

      const created = yield* client.create({ title: "Child" })
      const current = yield* client.getCurrent()
      yield* client.close(current)
      yield* client.destroy(created)

      expect(String(created.id)).toBe("window-main")
      expect(String(current.id)).toBe("window-main")
      expect(calls).toEqual([
        "create:Child",
        "getCurrent",
        "close:window-main",
        "destroy:window-main"
      ])
    }).pipe(Effect.provide(makeDesktopRendererRpcTestLayer(rpcs)))
  )
})

const request = (tag: string): Rpc.Any => {
  const rpc = WindowRpcs.requests.get(tag)

  expect(rpc, tag).toBeDefined()
  if (rpc === undefined) {
    throw new Error(`missing rpc ${tag}`)
  }

  return rpc
}

const makeTestWindowHandle = (id: string): WindowHandle => ({
  kind: "window",
  id: makeResourceId(id),
  generation: 0,
  ownerScope: `window:${id}`,
  state: "open"
})

const testWindowBounds = { x: 0, y: 0, width: 100, height: 100 } as const
const testWindowState = {
  fullscreen: false,
  maximized: false,
  minimized: false,
  simpleFullscreen: false
} as const

const makeTestWindowClient = (current: WindowHandle, calls: string[]): WindowClientApi => ({
  create: (input) =>
    Effect.sync(() => {
      calls.push(`create:${input.title ?? ""}`)
      return current
    }),
  close: (window) =>
    Effect.sync(() => {
      calls.push(`close:${window.id}`)
    }),
  destroy: (window) =>
    Effect.sync(() => {
      calls.push(`destroy:${window.id}`)
    }),
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  getCurrent: () =>
    Effect.sync(() => {
      calls.push("getCurrent")
      return current
    }),
  getById: (windowId) => Effect.succeed(makeTestWindowHandle(windowId)),
  list: () => Effect.succeed([current]),
  getParent: () => Effect.succeed(undefined),
  getChildren: () => Effect.succeed([]),
  getBounds: () => Effect.succeed(testWindowBounds),
  setBounds: (_window, bounds) => Effect.succeed(bounds),
  setBoundsOnDisplay: (_window, _displayId, bounds) => Effect.succeed(bounds),
  center: () => Effect.succeed(testWindowBounds),
  centerOnDisplay: () => Effect.succeed(testWindowBounds),
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
  minimize: () => Effect.succeed(testWindowState),
  maximize: () => Effect.succeed(testWindowState),
  restore: () => Effect.succeed(testWindowState),
  setFullscreen: () => Effect.succeed(testWindowState),
  setSimpleFullscreen: () => Effect.succeed(testWindowState),
  getState: () => Effect.succeed(testWindowState),
  events: () => Stream.empty
})
