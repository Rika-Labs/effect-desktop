import { NotesManifest, makeNotesDemoTransport } from "@effect-desktop/example-notes-common"
import { ReactDesktop } from "@effect-desktop/react/desktop"

export const NotesReact = ReactDesktop.from(NotesManifest)
export const notesTransport = makeNotesDemoTransport()
