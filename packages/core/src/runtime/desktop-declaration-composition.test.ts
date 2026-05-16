import { expect, test } from "bun:test"
import { Context, Effect, Layer, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import { Desktop, type DesktopWorkflowLayer } from "../index.js"
import { DesktopRpcRegistry, DesktopRpcRegistryLive } from "./desktop-rpc-registry.js"
import { DesktopWindowRegistry, DesktopWindowRegistryLive } from "./desktop-window-registry.js"
import {
  DesktopWorkflowRegistry,
  DesktopWorkflowRegistryLive
} from "./desktop-workflow-registry.js"

test("Desktop.windows composes window declarations in order", async () => {
  const layer = Desktop.windows(
    Desktop.window("main", { title: "Main" }),
    Desktop.window("preferences", { title: "Preferences" })
  )

  const ids = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(Layer.provideMerge(layer, DesktopWindowRegistryLive))
        const registry = Context.get(context, DesktopWindowRegistry)
        const snapshot = yield* registry.snapshot
        return snapshot.map((registration) => registration.id)
      })
    )
  )

  expect(ids).toEqual(["main", "preferences"])
})

test("Desktop.rpcs composes RPC declarations in order", async () => {
  const Ping = Rpc.make("Composition.Ping", { success: Schema.String })
  const Pong = Rpc.make("Composition.Pong", { success: Schema.String })
  const PingRpcs = RpcGroup.make(Ping)
  const PongRpcs = RpcGroup.make(Pong)

  const layer = Desktop.rpcs(
    Desktop.rpc(
      PingRpcs,
      PingRpcs.toLayer({
        "Composition.Ping": () => Effect.succeed("ping")
      })
    ),
    Desktop.rpc(
      PongRpcs,
      PongRpcs.toLayer({
        "Composition.Pong": () => Effect.succeed("pong")
      })
    )
  )

  const tags = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(Layer.provideMerge(layer, DesktopRpcRegistryLive))
        const registry = Context.get(context, DesktopRpcRegistry)
        const snapshot = yield* registry.snapshot
        return snapshot.flatMap((registration) => [...registration.group.requests.keys()])
      })
    )
  )

  expect(tags).toEqual(["Composition.Ping", "Composition.Pong"])
})

test("Desktop.workflows composes workflow declarations in order", async () => {
  const first: DesktopWorkflowLayer = Layer.empty
  const second: DesktopWorkflowLayer = Layer.empty
  const layer = Desktop.workflows(Desktop.workflow(first), Desktop.workflow(second))

  const snapshot = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(Layer.provideMerge(layer, DesktopWorkflowRegistryLive))
        const registry = Context.get(context, DesktopWorkflowRegistry)
        return yield* registry.snapshot
      })
    )
  )

  expect(snapshot).toEqual([first, second])
})

test("Desktop.providers composes provider declarations", async () => {
  const graph = await Effect.runPromise(
    Desktop.runtimeGraph({
      id: "composition",
      windows: Desktop.window("main", { title: "Composition" }),
      providers: Desktop.providers(
        Desktop.provider(Desktop.Provider.Runtime.node),
        Desktop.provider(Desktop.Provider.WebView.chrome)
      )
    })
  )

  expect(graph.providers).toEqual({ runtime: "node", webview: "chrome" })
})
