import { expect, test } from "bun:test"
import { rpcSupport, type Rpc } from "@effect-desktop/bridge"

import { WindowRpcs } from "./window.js"

test("WindowRpcs exposes host implementation support metadata through RpcGroup lowering", () => {
  expect(rpcSupport(request("Window.create"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.close"))).toEqual({ status: "supported" })
  expect(rpcSupport(request("Window.show"))).toEqual({
    status: "unsupported",
    reason: "host Window adapter does not implement this method yet"
  })
  expect(rpcSupport(request("Window.setVibrancy"))).toEqual({
    status: "unsupported",
    reason: "host Window adapter does not implement this method yet"
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
