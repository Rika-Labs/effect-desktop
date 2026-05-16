import { describe, expect, it } from "bun:test"
import { Context, Effect, Layer } from "effect"

import { Desktop } from "../index.js"
import {
  DesktopWindowRegistry,
  DesktopWindowRegistryLive,
  isSafeWindowId
} from "./desktop-window-registry.js"

const snapshotWindows = (
  layer: Layer.Layer<never, never, DesktopWindowRegistry>
): Promise<ReadonlyArray<{ readonly id: string; readonly title: string }>> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(Layer.provideMerge(layer, DesktopWindowRegistryLive))
        const registry = Context.get(ctx, DesktopWindowRegistry)
        const snap = yield* registry.snapshot
        return snap.map((registration) => ({
          id: registration.id,
          title: registration.spec.title
        }))
      })
    )
  )

describe("DesktopWindowRegistry", () => {
  it("registers a single window via Desktop.window", async () => {
    const layer = Desktop.window("main", { title: "Notes", width: 720, height: 520 })
    const snap = await snapshotWindows(layer)
    expect(snap).toEqual([{ id: "main", title: "Notes" }])
  })

  it("composes multiple windows via Layer.mergeAll in declared order", async () => {
    const layer = Layer.mergeAll(
      Desktop.window("main", { title: "Main" }),
      Desktop.window("preferences", { title: "Preferences" }),
      Desktop.window("compose", { title: "Compose" })
    )
    const snap = await snapshotWindows(layer)
    expect(snap.map((w) => w.id)).toEqual(["main", "preferences", "compose"])
    expect(snap.map((w) => w.title)).toEqual(["Main", "Preferences", "Compose"])
  })

  it("preserves the optional services Layer on the registration", async () => {
    const services = Layer.empty
    const layer = Desktop.window("main", { title: "Main" }, services)
    const registrations = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ctx = yield* Layer.build(Layer.provideMerge(layer, DesktopWindowRegistryLive))
          const registry = Context.get(ctx, DesktopWindowRegistry)
          return yield* registry.snapshot
        })
      )
    )
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.services).toBe(services)
  })

  it("leaves services undefined when omitted", async () => {
    const layer = Desktop.window("main", { title: "Main" })
    const registrations = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ctx = yield* Layer.build(Layer.provideMerge(layer, DesktopWindowRegistryLive))
          const registry = Context.get(ctx, DesktopWindowRegistry)
          return yield* registry.snapshot
        })
      )
    )
    expect(registrations[0]?.services).toBeUndefined()
  })

  it("throws synchronously on a reserved window id", () => {
    expect(() => Desktop.window("__proto__", { title: "Bad" })).toThrow(/reserved/i)
    expect(() => Desktop.window("constructor", { title: "Bad" })).toThrow(/reserved/i)
    expect(() => Desktop.window("prototype", { title: "Bad" })).toThrow(/reserved/i)
    expect(() => Desktop.window("", { title: "Bad" })).toThrow(/reserved/i)
  })

  it("isSafeWindowId rejects empty and reserved ids", () => {
    expect(isSafeWindowId("main")).toBe(true)
    expect(isSafeWindowId("compose")).toBe(true)
    expect(isSafeWindowId("")).toBe(false)
    expect(isSafeWindowId("__proto__")).toBe(false)
    expect(isSafeWindowId("constructor")).toBe(false)
    expect(isSafeWindowId("prototype")).toBe(false)
  })
})
