import { expect, test } from "bun:test"
import { RpcEndpoint } from "@effect-desktop/bridge"
import { Desktop, MissingDesktopRpcsError } from "@effect-desktop/core"
import { Deferred, Effect, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createApp, effectScope } from "vue"

import { MissingDesktopContextError, VueDesktop, type VueDesktopRpcClient } from "./index.js"

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
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.List": () => Effect.succeed(["inbox"]),
          "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const client: VueDesktopRpcClient = {
    "Notes.List": () => Effect.succeed(["inbox"]),
    "Notes.Create": (input) =>
      Effect.succeed(`note:${(input as { readonly title?: unknown }).title ?? "untitled"}`)
  }
  const app = NotesVue.createApp(Root, { clients: [[NotesRpcs, client]] })

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

test("VueDesktop query effects are interrupted when the scope is disposed", async () => {
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const Slow = Rpc.make("Notes.Slow", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Slow)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Slow": () => Effect.succeed("unused")
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))
  const client: VueDesktopRpcClient = {
    "Notes.Slow": () =>
      Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
  }
  const app = NotesVue.createApp(Root, { clients: [[NotesRpcs, client]] })

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

test("VueDesktop.useDesktop fails loudly without provide/inject context or an installed client", () => {
  const Ping = Rpc.make("Notes.Ping")
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Ping": () => Effect.void
        })
      )
    )
  )
  const NotesVue = VueDesktop.from(Desktop.manifest(NotesApp))

  const bareApp = createApp(Root)
  bareApp.config.warnHandler = () => undefined
  bareApp.runWithContext(() => {
    expect(() => NotesVue.useDesktop(NotesRpcs)).toThrow(MissingDesktopContextError)
  })
  const app = NotesVue.createApp(Root)
  app.runWithContext(() => {
    expect(() => NotesVue.useDesktop(NotesRpcs)).toThrow(MissingDesktopRpcsError)
  })
})
