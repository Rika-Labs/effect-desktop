import { expect, test } from "bun:test"
import { RpcEndpoint } from "@effect-desktop/bridge"
import { Desktop, DuplicateDesktopRpcNameError, MissingDesktopRpcsError } from "@effect-desktop/core"
import { Deferred, Effect, Schema } from "effect"
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
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

test("SolidDesktop.useDesktop rejects colliding endpoint names", () => {
  const ProjectList = Rpc.make("Projects.List", { success: Schema.Array(Schema.String) })
  const TaskList = Rpc.make("Tasks.List", { success: Schema.Array(Schema.String) })
  const CollidingRpcs = RpcGroup.make(ProjectList, TaskList)
  const CollidingApp = Desktop.make({
    windows: {
      main: {
        title: "Lists"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        CollidingRpcs,
        CollidingRpcs.toLayer({
          "Projects.List": () => Effect.succeed(["project"]),
          "Tasks.List": () => Effect.succeed(["task"])
        })
      )
    )
  )
  const CollidingSolid = SolidDesktop.from(Desktop.manifest(CollidingApp))
  const client: SolidDesktopRpcClient = {
    "Projects.List": () => Effect.succeed(["project"]),
    "Tasks.List": () => Effect.succeed(["task"])
  }

  renderToString(() =>
    createComponent(CollidingSolid.DesktopRoot, {
      clients: [[CollidingRpcs, client]],
      get children() {
        expect(() => CollidingSolid.useDesktop(CollidingRpcs)).toThrow(
          DuplicateDesktopRpcNameError
        )
        return undefined
      }
    })
  )
})

test("SolidDesktop query effects are interrupted when the owner is disposed", async () => {
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))
  const client: SolidDesktopRpcClient = {
    "Notes.Slow": () =>
      Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
  }

  const dispose = createRoot((disposeRoot) => {
    createComponent(NotesSolid.DesktopRoot, {
      clients: [[NotesRpcs, client]],
      get children() {
        const notes = NotesSolid.useDesktop(NotesRpcs)
        notes.slow.createQuery()
        return undefined
      }
    })
    return disposeRoot
  })

  dispose()

  await Effect.runPromise(Deferred.await(interrupted))
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
  const NotesSolid = SolidDesktop.from(Desktop.manifest(NotesApp))

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
