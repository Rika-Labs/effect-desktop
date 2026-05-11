import { NotesManifest, makeNotesDemoTransport } from "@effect-desktop/example-notes-common"
import { VueDesktop } from "@effect-desktop/vue"

export const NotesVue = VueDesktop.from(NotesManifest)
export const notesTransport = makeNotesDemoTransport()
