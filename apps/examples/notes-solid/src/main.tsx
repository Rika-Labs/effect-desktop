import { NotesRpcs, type Note, type NotesWorkspace } from "@effect-desktop/example-notes-common"
import { Exit } from "effect"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"

import { NotesSolid, notesTransport } from "./desktop.js"
import "./styles.css"

function App() {
  const notes = NotesSolid.useDesktop(NotesRpcs)
  const load = notes.load.createQuery()
  const create = notes.create.createMutation()
  const save = notes.save.createMutation()
  const deleteNote = notes.delete.createMutation()
  const [workspace, setWorkspace] = createSignal<NotesWorkspace | null>(null)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [draftTitle, setDraftTitle] = createSignal("")
  const [draftBody, setDraftBody] = createSignal("")
  const selectedNote = createMemo(
    () => workspace()?.notes.find((note) => note.id === selectedId()) ?? null
  )

  createEffect(() => {
    const result = load()
    if (result.status === "success") {
      setWorkspace(result.value)
      setSelectedId((current) => current ?? result.value.selectedId)
    }
  })

  createEffect(() => {
    setDraftTitle(selectedNote()?.title ?? "")
    setDraftBody(selectedNote()?.body ?? "")
  })

  const persistWorkspace = (next: NotesWorkspace): void => {
    setWorkspace(next)
    setSelectedId(next.selectedId)
  }

  const createNewNote = (): void => {
    void create.runPromise({ title: "Untitled Note", body: "" }).then((exit) => {
      if (Exit.isSuccess(exit)) {
        persistWorkspace(exit.value)
      }
    })
  }

  const saveSelectedNote = (): void => {
    const current = selectedNote()
    if (current === null) {
      return
    }
    void save
      .runPromise({ id: current.id, title: draftTitle(), body: draftBody() })
      .then((exit) => {
        if (Exit.isSuccess(exit)) {
          persistWorkspace(exit.value)
        }
      })
  }

  const deleteSelectedNote = (): void => {
    const current = selectedNote()
    if (current === null) {
      return
    }
    void deleteNote.runPromise({ id: current.id }).then((exit) => {
      if (Exit.isSuccess(exit)) {
        persistWorkspace(exit.value)
      }
    })
  }

  return (
    <main class="notes-shell">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div>
            <p class="eyebrow">Solid</p>
            <h1>Notes</h1>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Create note"
            onClick={createNewNote}
          >
            +
          </button>
        </div>
        <div class="status-row">
          {statusText(
            load().status,
            create.state().status,
            save.state().status,
            deleteNote.state().status
          )}
        </div>
        <nav class="note-list" aria-label="Notes">
          <For each={workspace()?.notes ?? []}>
            {(note) => (
              <button
                type="button"
                class={note.id === selectedId() ? "note-row active" : "note-row"}
                onClick={() => setSelectedId(note.id)}
              >
                <span>{note.title}</span>
                <small>{preview(note)}</small>
              </button>
            )}
          </For>
        </nav>
      </aside>
      <section class="editor" aria-label="Selected note">
        <header class="editor-toolbar">
          <span>{selectedNote() === null ? "No note selected" : "Editing"}</span>
          <div class="toolbar-actions">
            <button type="button" disabled={selectedNote() === null} onClick={deleteSelectedNote}>
              Delete
            </button>
            <button type="button" disabled={selectedNote() === null} onClick={saveSelectedNote}>
              Save
            </button>
          </div>
        </header>
        <Show when={selectedNote() !== null}>
          <input
            aria-label="Note title"
            class="title-input"
            value={draftTitle()}
            onInput={(event) => setDraftTitle(event.currentTarget.value)}
          />
          <textarea
            aria-label="Note body"
            class="body-input"
            value={draftBody()}
            onInput={(event) => setDraftBody(event.currentTarget.value)}
          />
        </Show>
      </section>
    </main>
  )
}

const preview = (note: Note): string => {
  const text = note.body.trim()
  return text.length === 0 ? "Empty note" : text
}

const statusText = (
  loadStatus: string,
  createStatus: string,
  saveStatus: string,
  deleteStatus: string
): string => {
  if (loadStatus === "running") {
    return "Loading notes"
  }
  if (createStatus === "running") {
    return "Creating note"
  }
  if (saveStatus === "running") {
    return "Saving note"
  }
  if (deleteStatus === "running") {
    return "Deleting note"
  }
  return "Ready"
}

const root = document.querySelector("#root")

if (root instanceof HTMLElement) {
  NotesSolid.render(() => <App />, root, { transport: notesTransport })
}
