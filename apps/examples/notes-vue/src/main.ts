import { NotesRpcs, type Note, type NotesWorkspace } from "@effect-desktop/example-notes-common"
import { Exit } from "effect"
import { computed, defineComponent, h, ref, watchEffect } from "vue"

import { NotesVue, notesRpcLayers } from "./desktop.js"
import "./styles.css"

const App = defineComponent({
  name: "NotesVueApp",
  setup() {
    const notes = NotesVue.useDesktop(NotesRpcs)
    const load = notes.load.useQuery()
    const create = notes.create.useMutation()
    const save = notes.save.useMutation()
    const deleteNote = notes.delete.useMutation()
    const workspace = ref<NotesWorkspace | null>(null)
    const selectedId = ref<string | null>(null)
    const draftTitle = ref("")
    const draftBody = ref("")
    const selectedNote = computed(
      () => workspace.value?.notes.find((note) => note.id === selectedId.value) ?? null
    )

    watchEffect(() => {
      if (load.value.status === "success") {
        workspace.value = load.value.value
        selectedId.value = selectedId.value ?? load.value.value.selectedId
      }
    })

    watchEffect(() => {
      draftTitle.value = selectedNote.value?.title ?? ""
      draftBody.value = selectedNote.value?.body ?? ""
    })

    const persistWorkspace = (next: NotesWorkspace): void => {
      workspace.value = next
      selectedId.value = next.selectedId
    }

    const createNewNote = (): void => {
      void create.runPromise({ title: "Untitled Note", body: "" }).then((exit) => {
        if (Exit.isSuccess(exit)) {
          persistWorkspace(exit.value)
        }
      })
    }

    const saveSelectedNote = (): void => {
      const current = selectedNote.value
      if (current === null) {
        return
      }
      void save
        .runPromise({ id: current.id, title: draftTitle.value, body: draftBody.value })
        .then((exit) => {
          if (Exit.isSuccess(exit)) {
            persistWorkspace(exit.value)
          }
        })
    }

    const deleteSelectedNote = (): void => {
      const current = selectedNote.value
      if (current === null) {
        return
      }
      void deleteNote.runPromise({ id: current.id }).then((exit) => {
        if (Exit.isSuccess(exit)) {
          persistWorkspace(exit.value)
        }
      })
    }

    return () =>
      h("main", { class: "notes-shell" }, [
        h("aside", { class: "sidebar" }, [
          h("div", { class: "sidebar-header" }, [
            h("div", [h("p", { class: "eyebrow" }, "Vue"), h("h1", "Notes")]),
            h(
              "button",
              {
                type: "button",
                class: "icon-button",
                "aria-label": "Create note",
                onClick: createNewNote
              },
              "+"
            )
          ]),
          h(
            "div",
            { class: "status-row" },
            statusText(
              load.value.status,
              create.state.value.status,
              save.state.value.status,
              deleteNote.state.value.status
            )
          ),
          h(
            "nav",
            { class: "note-list", "aria-label": "Notes" },
            (workspace.value?.notes ?? []).map((note) =>
              h(
                "button",
                {
                  key: note.id,
                  type: "button",
                  class: note.id === selectedId.value ? "note-row active" : "note-row",
                  onClick: () => {
                    selectedId.value = note.id
                  }
                },
                [h("span", note.title), h("small", preview(note))]
              )
            )
          )
        ]),
        h("section", { class: "editor", "aria-label": "Selected note" }, [
          h("header", { class: "editor-toolbar" }, [
            h("span", selectedNote.value === null ? "No note selected" : "Editing"),
            h("div", { class: "toolbar-actions" }, [
              h(
                "button",
                {
                  type: "button",
                  disabled: selectedNote.value === null,
                  onClick: deleteSelectedNote
                },
                "Delete"
              ),
              h(
                "button",
                {
                  type: "button",
                  disabled: selectedNote.value === null,
                  onClick: saveSelectedNote
                },
                "Save"
              )
            ])
          ]),
          h("input", {
            "aria-label": "Note title",
            class: "title-input",
            disabled: selectedNote.value === null,
            value: draftTitle.value,
            onInput: (event: Event) => {
              draftTitle.value = (event.currentTarget as HTMLInputElement).value
            }
          }),
          h("textarea", {
            "aria-label": "Note body",
            class: "body-input",
            disabled: selectedNote.value === null,
            value: draftBody.value,
            onInput: (event: Event) => {
              draftBody.value = (event.currentTarget as HTMLTextAreaElement).value
            }
          })
        ])
      ])
  }
})

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

NotesVue.createApp(App, { rpcLayers: notesRpcLayers }).mount("#root")
