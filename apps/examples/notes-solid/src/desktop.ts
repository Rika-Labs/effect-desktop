import { NotesManifest, makeNotesDemoTransport } from "@effect-desktop/example-notes-common"
import { SolidDesktop } from "@effect-desktop/solid"

export const NotesSolid = SolidDesktop.from(NotesManifest)
export const notesTransport = makeNotesDemoTransport()
