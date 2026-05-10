import { expect, test } from "bun:test"
import desktop from "./index.js"

test("desktop plugin has expected shape", () => {
  const plugin = desktop({ entry: "./app.ts" })

  expect(plugin.name).toBe("effect-desktop")
  expect(typeof plugin.resolveId).toBe("function")
  expect(typeof plugin.load).toBe("function")
  expect(typeof plugin.configureServer).toBe("function")
})

test("desktop plugin resolves virtual module id", () => {
  const plugin = desktop({ entry: "./app.ts" })
  const resolveId = plugin.resolveId as (id: string) => string | undefined

  expect(resolveId("virtual:effect-desktop/runtime")).toBe("\0virtual:effect-desktop/runtime")
  expect(resolveId("some-other-module")).toBeUndefined()
})

test("desktop plugin loads virtual module source", () => {
  const plugin = desktop({ entry: "./app.ts" })
  const load = plugin.load as (id: string) => string | undefined

  const source = load("\0virtual:effect-desktop/runtime")
  expect(typeof source).toBe("string")
  expect(source).toContain("Socket")
  expect(source).toContain("layerDevSocket")
  expect(source).toContain("effect-desktop:frame-down")

  expect(load("some-other-id")).toBeUndefined()
})

test("virtual module source contains HMR reconnect handler", () => {
  const plugin = desktop({ entry: "./app.ts" })
  const load = plugin.load as (id: string) => string | undefined

  const source = load("\0virtual:effect-desktop/runtime") ?? ""
  expect(source).toContain("effect-desktop:runtime-restart")
  expect(source).toContain("import.meta.hot")
})
