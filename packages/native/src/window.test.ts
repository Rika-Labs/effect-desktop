import { expect, test } from "bun:test"
import { rpcSupport, type Rpc } from "@effect-desktop/bridge"

import { WindowRpcs } from "./window.js"

test("WindowRpcs exposes only host-implemented methods through RpcGroup lowering", () => {
  expect(rpcSupport(request("Window.create"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.close"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.destroy"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.show"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.hide"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.focus"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.getChildren"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.getBounds"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setBounds"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.center"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.centerOnDisplay"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setTitle"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setResizable"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setDecorations"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setTrafficLights"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.setVibrancy"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.clearVibrancy"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.setShadow"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.setTitleBarStyle"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.setTitleBarTransparent"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.setTransparent"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
    ]
  })
  expect(rpcSupport(request("Window.setAlwaysOnTop"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setSkipTaskbar"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "unsupported" },
      { platform: "windows", status: "supported" },
      { platform: "linux", status: "supported" }
    ]
  })
  expect(rpcSupport(request("Window.setProgress"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.requestAttention"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.cancelAttention"))).toEqual({ status: "supported" })
  for (const method of [
    "Window.minimize",
    "Window.maximize",
    "Window.restore",
    "Window.setFullscreen",
    "Window.getState"
  ]) {
    expect(rpcSupport(request(method))).toMatchObject({
      status: "partial",
      reason: "host-tracked-state-only",
      platforms: [
        { platform: "macos", status: "partial", reason: "host-tracked-state-only" },
        { platform: "windows", status: "partial", reason: "host-tracked-state-only" },
        { platform: "linux", status: "partial", reason: "host-tracked-state-only" }
      ]
    })
  }
  expect(rpcSupport(request("Window.setSimpleFullscreen"))).toMatchObject({
    status: "partial",
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported" },
      { platform: "linux", status: "unsupported" }
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
