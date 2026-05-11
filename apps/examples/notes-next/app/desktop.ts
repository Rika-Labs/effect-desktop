import { NotesManifest, makeNotesDemoTransport } from "@effect-desktop/example-notes-common"
import { NextDesktop } from "@effect-desktop/next"

export const NotesNext = NextDesktop.from(NotesManifest)
export const notesTransport = makeNotesDemoTransport()
