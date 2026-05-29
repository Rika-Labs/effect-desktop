import { expect, test } from "bun:test"
import desktop from "./index.js"

test("desktop plugin has expected shape", () => {
  const plugin = desktop({ entry: "./app.ts" })

  expect(plugin.name).toBe("effect-desktop")
  expect(typeof plugin.resolveId).toBe("function")
  expect(typeof plugin.load).toBe("function")
  expect(typeof plugin.configureServer).toBe("function")
  expect(typeof plugin.handleHotUpdate).toBe("function")
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

test("desktop plugin emits runtime chunk for legacy Vite build contexts", () => {
  const emitted: unknown[] = []
  const plugin = desktop({ entry: "src/runtime.ts" })
  const configResolved = plugin.configResolved as (config: { readonly root: string }) => void
  const buildStart = plugin.buildStart as (this: {
    readonly emitFile: (file: unknown) => void
  }) => void

  configResolved({ root: "/workspace/app" })
  buildStart.call({
    emitFile: (file) => {
      emitted.push(file)
    }
  })

  expect(emitted).toHaveLength(1)
  const chunk = emitted[0] as { readonly type: string; readonly id: string; readonly name: string }
  expect(chunk.type).toBe("chunk")
  expect(chunk.name).toBe("runtime")
  expect(chunk.id.replaceAll("\\", "/").endsWith("/workspace/app/src/runtime.ts")).toBe(true)
})

test("desktop plugin skips runtime chunk for non-client Vite environments", () => {
  const emitted: unknown[] = []
  const plugin = desktop({ entry: "src/runtime.ts" })
  const buildStart = plugin.buildStart as (this: {
    readonly environment: { readonly name: string }
    readonly emitFile: (file: unknown) => void
  }) => void

  buildStart.call({
    environment: { name: "ssr" },
    emitFile: (file) => {
      emitted.push(file)
    }
  })

  expect(emitted).toEqual([])
})
