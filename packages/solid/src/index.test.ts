import { expect, test } from "bun:test"
import { RpcEndpoint } from "@rikalabs/effect-desktop/bridge"
import { Desktop, MissingDesktopRpcsError } from "@rikalabs/effect-desktop/core"
import { Effect, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createRoot } from "solid-js"
import { createComponent, renderToString } from "solid-js/web"

import { MissingDesktopContextError, SolidDesktop, type SolidDesktopRpcClient } from "./index.js"

test("SolidDesktop.from exposes app-scoped primitives from provided groups", () => {
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
  const NotesSolid = SolidDesktop.from(NotesApp)
  const client: SolidDesktopRpcClient = {
    "Notes.List": () => Effect.succeed(["inbox"]),
    "Notes.Create": (input) =>
      Effect.succeed(`note:${(input as { readonly title?: unknown }).title ?? "untitled"}`)
  }

  renderToString(() =>
    createComponent(NotesSolid.DesktopRoot, {
      clients: [[NotesRpcs, client]],
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        const list = notes.list.createQuery()
        const create = notes.create.createMutation()

        expect(list().status).toBe("running")
        expect(create.state().status).toBe("idle")
        return undefined
      }
    })
  )
})

test("SolidDesktop.useDesktop fails loudly without context or an installed client", () => {
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
  const NotesSolid = SolidDesktop.from(NotesApp)

  createRoot((dispose) => {
    expect(() => NotesSolid.useDesktop(NotesRpcs)).toThrow(MissingDesktopContextError)
    dispose()
  })

  renderToString(() =>
    createComponent(NotesSolid.DesktopRoot, {
      get children() {
        expect(() => NotesSolid.useDesktop(NotesRpcs)).toThrow(MissingDesktopRpcsError)
        return undefined
      }
    })
  )
})
