import { expect, test } from "bun:test"
import { rpcSupport, type Rpc } from "@effect-desktop/bridge"

import { WindowApi } from "./window.js"

test("WindowApi exposes host implementation support metadata through RpcGroup lowering", () => {
  const group = WindowApi.toRpcGroup()

  expect(rpcSupport(request(group, "Window.create"))).toEqual({ status: "supported" })
  expect(rpcSupport(request(group, "Window.close"))).toEqual({ status: "supported" })
  expect(rpcSupport(request(group, "Window.show"))).toEqual({
    status: "unsupported",
    reason: "host Window adapter does not implement this method yet"
  })
  expect(rpcSupport(request(group, "Window.setVibrancy"))).toEqual({
    status: "unsupported",
    reason: "host Window adapter does not implement this method yet"
  })
})

const request = (group: ReturnType<typeof WindowApi.toRpcGroup>, tag: string): Rpc.Any => {
  const rpc = group.requests.get(tag)

  expect(rpc, tag).toBeDefined()
  if (rpc === undefined) {
    throw new Error(`missing rpc ${tag}`)
  }

  return rpc
}
