import {
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeHostProtocolInvalidOutputError,
  RpcEndpoint,
  type HostProtocolEnvelope,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { DesktopAppManifest, DesktopRendererRpcTransport } from "@effect-desktop/core/renderer"
import { Cause, Effect, Exit, Fiber, Queue, Ref, Schema, Stream } from "effect"
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

export const makeNotesDemoTransport = (
  initialWorkspace: NotesWorkspace = makeInitialWorkspace()
): DesktopRendererRpcTransport => {
  const state = Effect.runSync(Ref.make(makeInitialState(initialWorkspace)))
  return makeRpcTransport({
    "Notes.Load": () => Ref.get(state).pipe(Effect.map((current) => current.workspace)),
    "Notes.Create": (payload) =>
      Schema.decodeUnknownEffect(CreateNotePayload)(payload).pipe(
        Effect.flatMap((decoded) => Ref.modify(state, (current) => createInState(current, decoded)))
      ),
    "Notes.Save": (payload) =>
      Schema.decodeUnknownEffect(SaveNotePayload)(payload).pipe(
        Effect.flatMap((decoded) => Ref.modify(state, (current) => saveInState(current, decoded)))
      ),
    "Notes.Delete": (payload) =>
      Schema.decodeUnknownEffect(DeleteNotePayload)(payload).pipe(
        Effect.flatMap((decoded) => Ref.modify(state, (current) => deleteInState(current, decoded)))
      )
  })
}

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

type RpcTransportHandler = (
  payload: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

const makeRpcTransport = (
  handlers: Readonly<Record<string, RpcTransportHandler>>
): DesktopRendererRpcTransport => {
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const fibers = new Map<string, Fiber.Fiber<void, unknown>>()
  return {
    send: (envelope) => {
      if (envelope.kind === "cancel" && envelope.id !== undefined) {
        const fiber = fibers.get(envelope.id)
        if (fiber === undefined) {
          return Effect.void
        }
        fibers.delete(envelope.id)
        return Fiber.interrupt(fiber).pipe(Effect.asVoid)
      }
      if (envelope.kind !== "request") {
        return Effect.void
      }
      const handler = handlers[envelope.method]
      if (handler === undefined) {
        return Queue.offer(
          queue,
          responseEnvelope(envelope, {
            error: makeHostProtocolInvalidOutputError(envelope.method, "missing demo handler")
          })
        )
      }
      const result = handler(envelope.payload)
      if (Stream.isStream(result)) {
        return Effect.gen(function* () {
          const fiber = yield* Effect.forkDetach(
            Effect.exit(
              Stream.runForEach(result, (item) =>
                Queue.offer(queue, streamEnvelope(envelope, item))
              )
            ).pipe(
              Effect.flatMap((exit) => Queue.offer(queue, responseFromExit(envelope, exit))),
              Effect.asVoid
            ),
            { startImmediately: true }
          )
          fibers.set(envelope.id, fiber)
        })
      }
      return Effect.exit(result).pipe(
        Effect.flatMap((exit) => Queue.offer(queue, responseFromExit(envelope, exit)))
      )
    },
    run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
  }
}

const responseFromExit = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  exit: Exit.Exit<unknown, unknown>
): HostProtocolResponseEnvelope =>
  Exit.isSuccess(exit)
    ? responseEnvelope(request, { payload: exit.value === undefined ? null : exit.value })
    : responseEnvelope(request, { error: hostProtocolErrorFromCause(request.method, exit.cause) })

const responseEnvelope = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  fields: { readonly payload?: unknown; readonly error?: HostProtocolError }
): HostProtocolResponseEnvelope =>
  new HostProtocolResponseEnvelope({
    kind: "response",
    id: request.id,
    timestamp: Date.now(),
    traceId: request.traceId,
    ...fields
  })

const streamEnvelope = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  payload: unknown
): HostProtocolStreamByRequestEnvelope =>
  new HostProtocolStreamByRequestEnvelope({
    kind: "stream",
    id: request.id,
    timestamp: Date.now(),
    traceId: request.traceId,
    payload
  })

const hostProtocolErrorFromCause = (
  method: string,
  cause: Cause.Cause<unknown>
): HostProtocolError => {
  const failure = cause.reasons.find(Cause.isFailReason)
  return failure?.error instanceof Error || typeof failure?.error === "string"
    ? makeHostProtocolInvalidOutputError(method, String(failure.error))
    : makeHostProtocolInvalidOutputError(method, String(cause))
}
