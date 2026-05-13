import { expect, test } from "bun:test"
import { buildVirtualModuleSource } from "./virtual-module.js"

test("dev socket source uses bounded HMR callback streams", () => {
  const source = buildVirtualModuleSource()

  expect(source).toContain("Stream.callback")
  expect(source).toContain("bufferSize: HMR_BUFFER_SIZE")
  expect(source).toContain('strategy: "sliding"')
  expect(source).not.toContain("Queue.unbounded")
  expect(source).not.toContain("Effect.runFork")
})
