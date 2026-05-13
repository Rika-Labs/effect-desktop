import { expect, test } from "bun:test"
import { RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Desktop, MissingDesktopRpcClientError } from "@effect-desktop/core"
import { Deferred, Effect, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createApp, effectScope } from "vue"

import { MissingDesktopContextError, VueDesktop } from "./index.js"

const Root = {
  setup() {
    return () => null
  }
}

test("VueDesktop.from exposes app-scoped composables from provided groups", () => {
  const ListNotes = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const CreateNote = Rpc.make("Notes.Create", {
    payload: { title: Schema.String },
    success: Schema.String
  })
  const NotesRpcs = RpcGroup.make(ListNotes, CreateNote)
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.List": () => Effect.succeed(["inbox"]),
      "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]
  const app = NotesVue.createApp(Root, { rpcLayers })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      const list = notes.list.useQuery()
      const create = notes.create.useMutation()

      expect(list.value.status).toBe("running")
      expect(create.state.value.status).toBe("idle")
    })
    scope.stop()
  })
})

test("VueDesktop.useDesktop keeps reserved endpoint names as own properties", () => {
  const Reserved = Rpc.make("Notes.__proto__", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Reserved)
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.__proto__": () => Effect.succeed("ok")
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]
  const app = NotesVue.createApp(Root, { rpcLayers })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs) as unknown as Record<string, unknown>
      expect(Object.getPrototypeOf(notes)).toBeNull()
      expect(Object.prototype.hasOwnProperty.call(notes, "__proto__")).toBe(true)
    })
    scope.stop()
  })
})

test("VueDesktop query effects are interrupted when the scope is disposed", async () => {
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const Slow = Rpc.make("Notes.Slow", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Slow)
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Slow": () =>
        Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]
  const app = NotesVue.createApp(Root, { rpcLayers })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      notes.slow.useQuery()
    })
    scope.stop()
  })

  await Effect.runPromise(Deferred.await(interrupted))
})

test("VueDesktop stream composables emit values, close, fail, and interrupt on disposal", async () => {
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const Failing = Rpc.make("Notes.Failing", {
    success: Schema.String,
    error: Schema.Unknown,
    stream: true
  })
  const Slow = Rpc.make("Notes.SlowTail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const NotesRpcs = RpcGroup.make(Tail, Failing, Slow)
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Tail": () => Stream.make("a", "b"),
      "Notes.Failing": () => Stream.fail("boom"),
      "Notes.SlowTail": () =>
        Stream.never.pipe(Stream.ensuring(Deferred.succeed(interrupted, undefined)))
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]
  const app = NotesVue.createApp(Root, { rpcLayers })
  app.config.warnHandler = () => undefined

  let tail:
    | { readonly value: { readonly status: string; readonly data: readonly unknown[] } }
    | undefined
  let failing: { readonly value: { readonly status: string } } | undefined
  const scope = effectScope()
  app.runWithContext(() => {
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      tail = notes.tail.useStream()
      failing = notes.failing.useStream()
      const slow = notes.slowTail.useStream()

      expect(tail?.value.status).toBe("running")
      expect(slow.value.status).toBe("running")
    })
  })
  await waitFor(() => tail?.value.status === "closed")
  expect(tail?.value.data).toEqual(["a", "b"])
  await waitFor(() => failing?.value.status === "failure")
  scope.stop()
  await Effect.runPromise(Deferred.await(interrupted))
})

test("VueDesktop.useDesktop fails loudly without provide/inject context or an installed client", () => {
  const Ping = Rpc.make("Notes.Ping")
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Ping": () => Effect.void
        })
      )
    ]
  })
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))

  const bareApp = createApp(Root)
  bareApp.config.warnHandler = () => undefined
  bareApp.runWithContext(() => {
    expect(() => NotesVue.useDesktop(NotesRpcs)).toThrow(MissingDesktopContextError)
  })
  expect(() => NotesVue.createApp(Root)).toThrow(MissingDesktopRpcClientError)
})

test("VueDesktop.useDesktop exposes RpcSupport metadata on generated endpoints", () => {
  type SupportedQueryEndpoint = {
    readonly useQuery: unknown
    readonly support: { readonly status: string }
    readonly isSupported: boolean
  }
  const Unsupported = Rpc.make("Notes.Unsupported", { success: Schema.String }).pipe(
    RpcEndpoint.query,
    RpcSupport.unsupported("host method is unavailable")
  )
  const NotesRpcs = RpcGroup.make(Unsupported)
  const NotesLayer = Desktop.Rpcs.layer(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Unsupported": () => Effect.succeed("unused")
    })
  )
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    },
    rpcs: [NotesLayer]
  })
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const rpcLayers = [NotesLayer]
  const app = NotesVue.createApp(Root, { rpcLayers })
  app.config.warnHandler = () => undefined

  app.runWithContext(() => {
    const scope = effectScope()
    scope.run(() => {
      const notes = NotesVue.useDesktop(NotesRpcs)
      const endpoint: SupportedQueryEndpoint = notes.unsupported

      expect(endpoint.isSupported).toBe(false)
      expect(endpoint.support.status).toBe("unsupported")
    })
    scope.stop()
  })
})

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}
