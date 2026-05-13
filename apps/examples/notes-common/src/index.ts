import { RpcEndpoint } from "@effect-desktop/bridge"
import { type AnyDesktopRpcLayer, type DesktopAppManifest } from "@effect-desktop/core/renderer"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const NoteId = Schema.String
export type NoteId = typeof NoteId.Type

export const Note = Schema.Struct({
  id: NoteId,
  title: Schema.String,
  body: Schema.String,
  updatedAt: Schema.String
})
export type Note = typeof Note.Type

export const NotesWorkspace = Schema.Struct({
  notes: Schema.Array(Note),
  selectedId: Schema.NullOr(NoteId)
})
export type NotesWorkspace = typeof NotesWorkspace.Type

export const CreateNotePayload = Schema.Struct({
  title: Schema.String,
  body: Schema.String
})
export type CreateNotePayload = typeof CreateNotePayload.Type

export const SaveNotePayload = Schema.Struct({
  id: NoteId,
  title: Schema.String,
  body: Schema.String
})
export type SaveNotePayload = typeof SaveNotePayload.Type

export const DeleteNotePayload = Schema.Struct({
  id: NoteId
})
export type DeleteNotePayload = typeof DeleteNotePayload.Type

export const LoadNotes = Rpc.make("Notes.Load", {
  success: NotesWorkspace
}).pipe(RpcEndpoint.query)

export const CreateNote = Rpc.make("Notes.Create", {
  payload: CreateNotePayload,
  success: NotesWorkspace
}).pipe(RpcEndpoint.mutation)

export const SaveNote = Rpc.make("Notes.Save", {
  payload: SaveNotePayload,
  success: NotesWorkspace
}).pipe(RpcEndpoint.mutation)

export const DeleteNote = Rpc.make("Notes.Delete", {
  payload: DeleteNotePayload,
  success: NotesWorkspace
}).pipe(RpcEndpoint.mutation)

export const NotesRpcs = RpcGroup.make(LoadNotes, CreateNote, SaveNote, DeleteNote)

export interface NotesStoreApi {
  readonly load: Effect.Effect<NotesWorkspace, never, never>
  readonly create: (payload: CreateNotePayload) => Effect.Effect<NotesWorkspace, never, never>
  readonly save: (payload: SaveNotePayload) => Effect.Effect<NotesWorkspace, never, never>
  readonly delete: (payload: DeleteNotePayload) => Effect.Effect<NotesWorkspace, never, never>
}

export class NotesStore extends Context.Service<NotesStore, NotesStoreApi>()(
  "@effect-desktop/example-notes-common/NotesStore"
) {}

interface NotesState {
  readonly nextId: number
  readonly workspace: NotesWorkspace
}

export const makeInitialWorkspace = (): NotesWorkspace =>
  Object.freeze({
    selectedId: "note-001",
    notes: Object.freeze([
      note("note-001", "Project brief", "Draft the desktop framework examples and verify them."),
      note(
        "note-002",
        "Adapter model",
        "React uses hooks. Vue uses composables. Solid uses signals."
      ),
      note("note-003", "Desktop startup", "The app manifest opens the main Notes window on launch.")
    ])
  })

export const NotesManifest: DesktopAppManifest = Object.freeze({
  _tag: "DesktopAppManifest",
  id: "notes-example",
  windows: Object.freeze({
    main: Object.freeze({
      title: "Notes",
      width: 1120,
      height: 760,
      renderer: "/"
    })
  }),
  rpcGroups: Object.freeze([
    Object.freeze({
      _tag: "DesktopRpcGroup" as const,
      group: NotesRpcs
    })
  ])
})

export function makeNotesStore(
  initialWorkspace: NotesWorkspace
): Effect.Effect<NotesStoreApi, never, never> {
  return Effect.gen(function* () {
    const state = yield* Ref.make(makeInitialState(initialWorkspace))
    return Object.freeze({
      load: Ref.get(state).pipe(Effect.map((current) => current.workspace)),
      create: (payload: CreateNotePayload) =>
        Ref.modify(state, (current) => createInState(current, payload)),
      save: (payload: SaveNotePayload) =>
        Ref.modify(state, (current) => saveInState(current, payload)),
      delete: (payload: DeleteNotePayload) =>
        Ref.modify(state, (current) => deleteInState(current, payload))
    })
  })
}

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

export const makeNotesDemoRpcLayers = (
  initialWorkspace: NotesWorkspace = makeInitialWorkspace()
): readonly AnyDesktopRpcLayer[] =>
  Object.freeze([
    Object.freeze({
      _tag: "DesktopRpcsLayer" as const,
      group: NotesRpcs,
      layer: makeNotesRpcsLayer(initialWorkspace)
    })
  ])

const makeInitialState = (workspace: NotesWorkspace): NotesState =>
  Object.freeze({
    nextId: workspace.notes.length + 1,
    workspace
  })

const createInState = (
  state: NotesState,
  payload: CreateNotePayload
): readonly [NotesWorkspace, NotesState] => {
  const id = makeNoteId(state.nextId)
  const nextNote = note(id, normalizeTitle(payload.title), payload.body)
  const workspace = Object.freeze({
    notes: Object.freeze([nextNote, ...state.workspace.notes]),
    selectedId: id
  })
  return [
    workspace,
    Object.freeze({
      nextId: state.nextId + 1,
      workspace
    })
  ]
}

const saveInState = (
  state: NotesState,
  payload: SaveNotePayload
): readonly [NotesWorkspace, NotesState] => {
  const notes = state.workspace.notes.map((current) =>
    current.id === payload.id
      ? note(current.id, normalizeTitle(payload.title), payload.body)
      : current
  )
  const workspace = Object.freeze({
    notes: Object.freeze(notes),
    selectedId: state.workspace.selectedId
  })
  return [
    workspace,
    Object.freeze({
      ...state,
      workspace
    })
  ]
}

const deleteInState = (
  state: NotesState,
  payload: DeleteNotePayload
): readonly [NotesWorkspace, NotesState] => {
  const notes = state.workspace.notes.filter((current) => current.id !== payload.id)
  const selectedId =
    state.workspace.selectedId === payload.id ? (notes[0]?.id ?? null) : state.workspace.selectedId
  const workspace = Object.freeze({
    notes: Object.freeze(notes),
    selectedId
  })
  return [
    workspace,
    Object.freeze({
      ...state,
      workspace
    })
  ]
}

function note(id: NoteId, title: string, body: string): Note {
  return Object.freeze({
    id,
    title,
    body,
    updatedAt: new Date().toISOString()
  })
}

const makeNoteId = (nextId: number): NoteId => `note-${nextId.toString().padStart(3, "0")}`

const normalizeTitle = (title: string): string => {
  const trimmed = title.trim()
  return trimmed.length === 0 ? "Untitled Note" : trimmed
}
