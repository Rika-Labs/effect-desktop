import { expect, test } from "bun:test"
import { rpcSupport, type Rpc } from "@effect-desktop/bridge"

import { WindowRpcs } from "./window.js"

test("WindowRpcs exposes only host-implemented methods through RpcGroup lowering", () => {
  expect(rpcSupport(request("Window.create"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.close"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.show"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.hide"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.focus"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.getBounds"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.setBounds"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.center"))).toEqual({ status: "supported" })
  expect(WindowRpcs.requests.has("Window.setVibrancy")).toBe(false)
})

const request = (tag: string): Rpc.Any => {
  const rpc = WindowRpcs.requests.get(tag)

  expect(rpc, tag).toBeDefined()
  if (rpc === undefined) {
    throw new Error(`missing rpc ${tag}`)
  }

  return rpc
}
