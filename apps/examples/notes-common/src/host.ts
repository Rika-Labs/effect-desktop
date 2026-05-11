import { Desktop } from "@effect-desktop/core"
import { Context, Effect, Layer } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  NotesRpcs,
  makeInitialWorkspace,
  makeNotesStore,
  type CreateNotePayload,
  type DeleteNotePayload,
  type NotesStoreApi,
  type NotesWorkspace,
  type SaveNotePayload
} from "./index.js"

export class NotesStore extends Context.Service<NotesStore, NotesStoreApi>()(
  "@effect-desktop/example-notes-common/NotesStore"
) {}

export const makeNotesStoreLayer = (
  initialWorkspace: NotesWorkspace = makeInitialWorkspace()
): Layer.Layer<NotesStore, never, never> =>
  Layer.effect(NotesStore)(makeNotesStore(initialWorkspace))

export const NotesRpcsLive = NotesRpcs.toLayer({
  "Notes.Load": () =>
    Effect.gen(function* () {
      const store = yield* NotesStore
      return yield* store.load
    }),
  "Notes.Create": (payload: CreateNotePayload) =>
    Effect.gen(function* () {
      const store = yield* NotesStore
      return yield* store.create(payload)
    }),
  "Notes.Save": (payload: SaveNotePayload) =>
    Effect.gen(function* () {
      const store = yield* NotesStore
      return yield* store.save(payload)
    }),
  "Notes.Delete": (payload: DeleteNotePayload) =>
    Effect.gen(function* () {
      const store = yield* NotesStore
      return yield* store.delete(payload)
    })
})

export const makeNotesRpcsLayer = (
  initialWorkspace: NotesWorkspace = makeInitialWorkspace()
): Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof NotesRpcs>>, never, never> =>
  Layer.provide(NotesRpcsLive, makeNotesStoreLayer(initialWorkspace))

export const NotesApp = Desktop.make({
  id: "notes-example",
  windows: {
    main: {
      title: "Notes",
      width: 1120,
      height: 760,
      renderer: "/"
    }
  }
}).pipe(Desktop.provide(Desktop.Rpcs.layer(NotesRpcs, makeNotesRpcsLayer())))

export const NotesLayer = Desktop.toLayer(NotesApp)
