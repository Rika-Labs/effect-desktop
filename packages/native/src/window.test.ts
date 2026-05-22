import { expect, test } from "bun:test"
import { rpcSupport, type Rpc } from "@orika/bridge"
import { Effect, Exit, Schema } from "effect"

import { WindowRegistryEvent } from "./contracts/window.js"
import { WindowRpcs } from "./window.js"

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

const request = (tag: string): Rpc.Any => {
  const rpc = WindowRpcs.requests.get(tag)

  expect(rpc, tag).toBeDefined()
  if (rpc === undefined) {
    throw new Error(`missing rpc ${tag}`)
  }

  return rpc
}
