import { NotesRpcs, type Note, type NotesWorkspace } from "@effect-desktop/example-notes-common"
import type { QueryResult } from "@effect-desktop/react"
import { Exit } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { useEffect, useMemo, useState } from "react"

import { NotesReact, notesRpcLayers } from "../desktop.js"

export default function NotesIsland() {
  return (
    <NotesReact.DesktopRoot rpcLayers={notesRpcLayers}>
      <NotesView />
    </NotesReact.DesktopRoot>
  )
}

function NotesView() {
  const notes = NotesReact.useDesktop(NotesRpcs)
  const load = notes.load.useQuery()
  const create = notes.create.useMutation()
  const save = notes.save.useMutation()
  const deleteNote = notes.delete.useMutation()
  const [workspace, setWorkspace] = useState<NotesWorkspace | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftBody, setDraftBody] = useState("")

  useEffect(() => {
    if (AsyncResult.isSuccess(load)) {
      setWorkspace(load.value)
      setSelectedId((current) => current ?? load.value.selectedId)
    }
  }, [load])

  const selectedNote = useMemo(
    () => workspace?.notes.find((note) => note.id === selectedId) ?? null,
    [selectedId, workspace]
  )

  useEffect(() => {
    setDraftTitle(selectedNote?.title ?? "")
    setDraftBody(selectedNote?.body ?? "")
  }, [selectedNote])

  const persistWorkspace = (next: NotesWorkspace): void => {
    setWorkspace(next)
    setSelectedId(next.selectedId)
  }

  const createNewNote = (): void => {
    void create.runPromise({ title: "Untitled Note", body: "" }).then((exit) => {
      if (Exit.isSuccess(exit)) persistWorkspace(exit.value)
    })
  }

  const saveSelectedNote = (): void => {
    if (selectedNote === null) return
    void save
      .runPromise({ id: selectedNote.id, title: draftTitle, body: draftBody })
      .then((exit) => {
        if (Exit.isSuccess(exit)) persistWorkspace(exit.value)
      })
  }

  const deleteSelectedNote = (): void => {
    if (selectedNote === null) return
    void deleteNote.runPromise({ id: selectedNote.id }).then((exit) => {
      if (Exit.isSuccess(exit)) persistWorkspace(exit.value)
    })
  }

  return (
    <main className="notes-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Astro</p>
            <h1>Notes</h1>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Create note"
            onClick={createNewNote}
          >
            +
          </button>
        </div>
        <div className="status-row">
          {statusText(loadStatus(load), create.status, save.status, deleteNote.status)}
        </div>
        <nav className="note-list" aria-label="Notes">
          {(workspace?.notes ?? []).map((note) => (
            <button
              key={note.id}
              type="button"
              className={note.id === selectedId ? "note-row active" : "note-row"}
              onClick={() => setSelectedId(note.id)}
            >
              <span>{note.title}</span>
              <small>{preview(note)}</small>
            </button>
          ))}
        </nav>
      </aside>
      <section className="editor" aria-label="Selected note">
        <header className="editor-toolbar">
          <span>{selectedNote === null ? "No note selected" : "Editing"}</span>
          <div className="toolbar-actions">
            <button type="button" disabled={selectedNote === null} onClick={deleteSelectedNote}>
              Delete
            </button>
            <button type="button" disabled={selectedNote === null} onClick={saveSelectedNote}>
              Save
            </button>
          </div>
        </header>
        <input
          aria-label="Note title"
          className="title-input"
          disabled={selectedNote === null}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.currentTarget.value)}
        />
        <textarea
          aria-label="Note body"
          className="body-input"
          disabled={selectedNote === null}
          value={draftBody}
          onChange={(event) => setDraftBody(event.currentTarget.value)}
        />
      </section>
    </main>
  )
}

const preview = (note: Note): string => note.body.trim() || "Empty note"

const loadStatus = (load: QueryResult<NotesWorkspace, never>): string =>
  AsyncResult.isInitial(load) ? "running" : AsyncResult.isFailure(load) ? "failure" : "success"

const statusText = (
  loadStatusValue: string,
  createStatus: string,
  saveStatus: string,
  deleteStatus: string
): string => {
  if (loadStatusValue === "running") return "Loading notes"
  if (createStatus === "running") return "Creating note"
  if (saveStatus === "running") return "Saving note"
  if (deleteStatus === "running") return "Deleting note"
  return "Ready"
}
